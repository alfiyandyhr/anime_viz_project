// Optional real-browser verification. See tests/journey-verification.md for setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const forward = 'movie-to-anime', reverse = 'anime-to-movies';
const anime = 'anilist:popularity', movies = 'tmdb:popularity';
const average = /Average attraction percentile/;
const dot = page => page.locator('#recommendation-chart .dust-node');
const add = page => page.locator('#add-popularity-magnet');
const rank = page => page.locator('[data-dust-ranking-body]');
const switchTo = (page, direction) => page.selectOption('#dust-direction', direction);
const choosePopularity = page => page.getByRole('radio', { name: 'High popularity' }).check();
const ready = page => dot(page).first().waitFor();
const mixed = page => page.waitForFunction(() => AnivizMain.snapshot().mixed && AnivizMain.snapshot().ranking.length === 1000);
const assertTooltip = async (page, title) => {
  await dot(page).first().locator('.dust-hit-area').hover({ force: true });
  const tooltip = page.locator('#tooltip');
  assert.ok(await tooltip.isVisible());
  const scores = await tooltip.locator('.dust-tooltip-score').allInnerTexts();
  for (const score of scores) assert.match(score, /^.+\nAttraction percentile: \d\.\d{3}$/);
  assert.match(scores[0], new RegExp(`^Cosine to ${title}: -?\\d+\\.\\d{3}\\n`));
  assert.match(await tooltip.innerText(), /Average attraction percentile: \d\.\d{3}\nClick to toggle selection$/);
};
const state = page => page.evaluate(() => {
  const { ranking, magnetKeys, activeMagnetKeys, selectedKeys, candidateKeys } = AnivizMain.snapshot();
  return { magnetKeys, activeMagnetKeys, selectedKeys, candidateKeys, ranking: ranking.map(row => [row.key, row.scores, row.rawScores, row.rank]) };
});

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    let animeFails = false, movieRequests = 0, movieResponse = 'ok';
    await page.route('**/data.json', route => animeFails ? route.fulfill({ status: 503 }) : route.continue());
    await page.route('**/movie_popularity.json', async route => {
      movieRequests++;
      if (movieResponse === 'missing') return route.fulfill({ status: 404 });
      if (movieResponse === 'wrong IDs') {
        const response = await route.fetch();
        const payload = await response.json();
        delete payload.popularity[Object.keys(payload.popularity)[0]];
        payload.popularity.wrong = 10;
        return route.fulfill({ response, json: payload });
      }
      await route.continue();
    });
    await page.goto(base);
    await ready(page);
    await page.getByRole('radio', { name: 'Genre cohort' }).check();
    await page.selectOption('#genre-magnet-choice', 'tmdb:genre:Science Fiction');
    await page.locator('#add-genre-magnet').click();
    const cosine = await state(page);
    await choosePopularity(page);
    await add(page).press('Enter');
    await mixed(page);
    assert.match(await page.locator('#movie-magnets').innerText(), /AniList list users · 2026-09-29 UTC · 997 of 1000 eligible/);
    const combined = await state(page);
    assert.equal(combined.magnetKeys.length, 3);
    await add(page).click();
    assert.match(await page.locator('#recommendation-status').innerText(), /already a magnet/);
    assert.match(await page.locator('[data-dust-ranking-head]').textContent(), average);
    assert.match(await page.locator('#recommendation-score-note').innerText(), /attraction percentile/);
    await assertTooltip(page, 'Inception');
    assert.match(await page.locator('#tooltip').innerText(), /AniList list users: \d+\nAttraction percentile:/);
    await dot(page).first().press('Enter');
    await dot(page).nth(1).press('Space');
    assert.match(await page.locator('#dust-focus').innerText(), average);
    assert.match(await page.locator('#recommendation-detail').textContent(), /AniList list users/);
    assert.match(await page.locator('#dust-mirror .dust-node').first().getAttribute('aria-label'), /Attraction percentile/);
    await page.locator('[data-dust-chart="connections"]').scrollIntoViewIfNeeded();
    await page.locator(`[data-dust-connection-movie="${anime}"]`).click();
    assert.match(await page.locator('[data-coverage="connections"]').innerText(), /Attraction percentile · AniList list users/);
    assert.match(await page.locator('.dust-connection-score').first().getAttribute('title'), /AniList list users/);
    assert.match(await page.locator('.dust-member-score').first().innerText(), /Raw/);
    await page.locator('[data-dust-page="99"]').click();
    const missing = rank(page).locator('tr').last();
    assert.match(await missing.locator('td').first().innerText(), /Unavailable/);
    assert.match(await missing.locator('td').nth(4).innerText(), /Unavailable/);
    assert.match(await missing.locator('td').nth(2).innerText(), /-?0\.\d+\s+Percentile Unavailable/);
    await page.locator('[data-dust-ranking-sort]').selectOption('tmdb:27205');
    assert.equal((await state(page)).ranking.filter(row => row[3] === null).length, 0);
    await page.locator('[data-dust-ranking-sort]').selectOption('average');
    await page.locator('[data-field-options] summary').click();
    await page.selectOption('#dust-limit', '30');
    await page.fill('#search-input', 'no known title xyz');
    assert.equal(await dot(page).count(), 0);
    assert.deepEqual((await state(page)).ranking, combined.ranking);
    await page.locator('#reset-filters').click();
    await page.selectOption('#dust-limit', '60');
    await ready(page);
    await page.locator('#recommendation-chart .dust-magnet').last().press('ArrowRight');
    assert.deepEqual((await state(page)).ranking, combined.ranking);
    await page.locator(`[data-remove-magnet="${anime}"]`).click();
    assert.deepEqual((await state(page)).ranking, cosine.ranking);
    await add(page).click();
    await mixed(page);

    animeFails = true;
    await page.reload();
    await page.locator('#retry-popularity').waitFor();
    await ready(page);
    assert.match(await page.locator('#movie-magnets').innerText(), /High anime popularity\s+Inactive/);
    assert.deepEqual((await state(page)).ranking, cosine.ranking);
    animeFails = false;
    await page.locator('#retry-popularity').click();
    await mixed(page);
    assert.deepEqual((await state(page)).ranking, combined.ranking);
    await dot(page).first().press('Enter');
    const selectedAnime = (await state(page)).selectedKeys;

    await switchTo(page, reverse);
    await ready(page);
    assert.equal(movieRequests, 0, 'the sidecar loads only for the picker or a saved magnet');
    const cowboy = await state(page);
    movieResponse = 'missing';
    await choosePopularity(page);
    await page.locator('#retry-popularity').waitFor();
    assert.ok(await add(page).isDisabled());
    assert.deepEqual((await state(page)).ranking, cowboy.ranking);
    movieResponse = 'ok';
    await page.locator('#retry-popularity').click();
    await add(page).click();
    await mixed(page);
    assert.match(await page.locator('#movie-magnets').innerText(), /TMDB popularity · 2026-10-11 UTC · 1000 of 1000 eligible/);
    await assertTooltip(page, 'Cowboy Bebop');
    await dot(page).first().press('Enter');
    const movieBlend = await state(page);
    assert.deepEqual(movieBlend.magnetKeys, ['anilist:1', movies]);
    await switchTo(page, forward);
    assert.deepEqual((await state(page)).selectedKeys, selectedAnime);
    await switchTo(page, reverse);
    assert.deepEqual(await state(page), movieBlend);

    movieResponse = 'wrong IDs';
    await page.reload();
    await page.locator('#retry-popularity').waitFor();
    await ready(page);
    assert.deepEqual((await state(page)).activeMagnetKeys, ['anilist:1']);
    assert.deepEqual((await state(page)).ranking, cowboy.ranking);
    movieResponse = 'ok';
    await page.locator('#retry-popularity').click();
    await mixed(page);
    assert.deepEqual((await state(page)).ranking, movieBlend.ranking);
    assert.deepEqual(errors, []);

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await phone.goto(base);
    await ready(phone);
    await choosePopularity(phone);
    await add(phone).tap();
    await mixed(phone);
    await dot(phone).first().press('Enter');
    assert.match(await phone.locator('#dust-focus').innerText(), /AniList list users/);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log('Popularity browser checks passed for both directions, retry, and mobile.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
