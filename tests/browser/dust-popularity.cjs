// Optional real-browser verification. See tests/journey-verification.md for setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const archive = require('../../data/movie_popularity.json');
const dashboard = require('../../data.json');
const catalogue = require('../../data/movie_recommendations.json');
const popularityIds = new Set(dashboard.anime.filter(row => Number.isFinite(row.popularity)).map(row => String(row.id)));
const animeEligible = catalogue.anime.filter(row => popularityIds.has(row.id)).length;
const { openAnalysisTab } = require('./dust-analysis-tab.cjs');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const animeTitles = 'anime-titles', movieTitles = 'movie-titles';
const anime = 'anilist:popularity', movies = 'tmdb:popularity';
const average = /Average attraction percentile/;
const dot = page => page.locator('#recommendation-chart .dust-node');
const add = page => page.locator('#add-popularity-magnet');
const rank = page => page.locator('[data-dust-ranking-body]');
const switchTo = (page, direction) => page.selectOption('#dust-type', direction);
const choosePopularity = page => page.getByRole('radio', { name: 'Popularity' }).check();
const ready = page => dot(page).first().waitFor();
const mixed = page => page.waitForFunction(() => AnivizMain.snapshot().mixed && AnivizMain.snapshot().ranking.length === 1000);
const assertTitleMemberLayout = async page => {
  const table = page.getByRole('table', { name: 'Dust members for Inception' });
  await table.waitFor();
  assert.deepEqual(await table.locator('thead th').allTextContents(), ['Rank', 'Anime', 'Similarity', 'Attraction percentile']);
  assert.match(await table.locator('.dust-member-score').first().getAttribute('title'), /Cosine to Inception/);
  assert.ok(await table.evaluate(el => el.parentElement.scrollWidth <= el.parentElement.clientWidth),
    'the member table fits within its scroll region');
};
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
    let animeFails = false, movieRequests = 0, movieResponse = 'ok', movieURL;
    await page.route('**/data.json', route => animeFails ? route.fulfill({ status: 503 }) : route.continue());
    await page.route('**/movie_popularity.json*', async route => {
      movieRequests++;
      movieURL = new URL(route.request().url());
      if (movieResponse === 'missing') return route.fulfill({ status: 404 });
      if (!movieURL.searchParams.has('snapshot') || movieResponse === 'wrong IDs') {
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
    const colorByMagnet = page.getByRole('radio', { name: 'Strongest magnet' });
    assert.ok(await colorByMagnet.isVisible());
    await page.getByRole('radio', { name: 'Movie genre' }).check();
    await page.selectOption('#genre-magnet-choice', 'tmdb:genre:Science Fiction');
    await page.locator('#add-genre-magnet').click();
    const cosine = await state(page);
    await choosePopularity(page);
    await add(page).press('Enter');
    await mixed(page);
    await colorByMagnet.check();
    assert.doesNotMatch(await page.locator('#movie-magnets').innerText(), /AniList users|eligible/);
    assert.ok(await page.locator('#popularity-magnet-source').isHidden());
    assert.equal(await page.getByRole('slider', { name: 'Popularity strength' }).inputValue(), '1');
    const combined = await state(page);
    assert.equal(combined.magnetKeys.length, 3);
    await add(page).click();
    assert.match(await page.locator('#recommendation-status').innerText(), /already a magnet/);
    assert.match(await page.locator('[data-dust-ranking-head]').textContent(), average);
    const popularityOption = page.locator(`[data-dust-ranking-sort] option[value="${anime}"]`);
    assert.equal(await popularityOption.textContent(), 'Popularity (AniList users)');
    assert.match(await page.locator('#recommendation-score-note').innerText(), /attraction percentile/);
    await assertTooltip(page, 'Inception');
    assert.match(await page.locator('#tooltip').innerText(), /AniList users: \d{1,3}(,\d{3})+\nAttraction percentile:/);
    await dot(page).first().press('Enter');
    await dot(page).nth(1).press('Space');
    await dot(page).nth(2).press('Enter');
    assert.match(await page.locator('#dust-focus').innerText(), average);
    const comparison = page.locator('.dust-comparison-table');
    const popularityRow = comparison.getByRole('row', { name: /M3 · Popularity \(AniList users\)/ });
    assert.equal(await popularityRow.getByRole('rowheader').innerText(), 'M3 · POPULARITY (ANILIST USERS)');
    assert.match(await popularityRow.locator('strong').first().innerText(), /^\d{1,3}(,\d{3})+$/);
    assert.match(await popularityRow.locator('small').first().innerText(), /^Percentile \d\.\d{3}$/);
    const values = await page.evaluate(() => {
      const { displayedDust, selectedKeys } = AnivizMain.snapshot();
      return selectedKeys.map(key => {
        const { rawScores, score } = displayedDust.find(match => match.key === key);
        return { popularity: rawScores[2], cosine: rawScores[0], average: score };
      });
    });
    assert.equal(values.length, 3);
    const meters = row => row.locator('meter').evaluateAll(nodes => nodes.map(({ min, max, value }) => [min, max, value]));
    const popularityMax = Math.max(...values.map(row => row.popularity));
    assert.deepEqual(await meters(popularityRow), values.map(row => [0, popularityMax, row.popularity]));
    assert.deepEqual(await meters(comparison.getByRole('row', { name: /M1 · Cosine to Inception/ })),
      values.map(row => [-1, 1, row.cosine]));
    assert.deepEqual(await meters(comparison.getByRole('row', { name: average })), values.map(row => [0, 1, row.average]));
    assert.match(await page.locator('#recommendation-detail').textContent(), /AniList users/);
    assert.match(await page.locator('#dust-mirror .dust-node').first().getAttribute('aria-label'), /Attraction percentile/);
    await openAnalysisTab(page, 'connections');
    await page.locator('[data-dust-chart="connections"]').scrollIntoViewIfNeeded();
    await assertTitleMemberLayout(page);
    await page.locator(`[data-dust-connection-movie="${anime}"]`).click();
    assert.match(await page.locator('[data-coverage="connections"]').innerText(), /AniList users · Attraction percentile/);
    const connectionScore = page.locator('.dust-connection-score').first();
    assert.match(await connectionScore.getAttribute('title'), /AniList users/);
    assert.match(await connectionScore.innerText(), /^\d{1,3}(,\d{3})+\nPercentile \d\.\d{3}$/);
    const popularityMembers = page.getByRole('table', { name: 'Dust members for Popularity' });
    assert.deepEqual(await popularityMembers.locator('thead th').allTextContents(),
      ['Rank', 'Anime', 'AniList users', 'Attraction percentile']);
    const [, , popularityValue, percentile] = await popularityMembers.locator('tbody tr').first().locator('td').allTextContents();
    assert.match(popularityValue, /^\d{1,3}(,\d{3})+$/);
    assert.match(percentile, /^\d\.\d{3}$/);
    assert.equal(combined.ranking.filter(row => row[3] === null).length, catalogue.anime.length - animeEligible);
    if (animeEligible < catalogue.anime.length) {
      await page.locator('[data-dust-page="99"]').click();
      const missing = rank(page).locator('tr').last();
      assert.match(await missing.locator('td').first().innerText(), /Unavailable/);
      assert.match(await missing.locator('td').nth(4).innerText(), /Unavailable/);
      assert.match(await missing.locator('td').nth(2).innerText(), /-?0\.\d+\s+Percentile Unavailable/);
    }
    await openAnalysisTab(page, 'ranking');
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
    assert.ok(await colorByMagnet.isChecked());
    assert.deepEqual((await state(page)).ranking, cosine.ranking);
    await add(page).click();
    await mixed(page);

    animeFails = true;
    await page.reload();
    await page.locator('#retry-popularity').waitFor();
    await ready(page);
    assert.match(await page.locator('#movie-magnets').innerText(), /Popularity\s+Inactive/);
    assert.deepEqual((await state(page)).ranking, cosine.ranking);
    animeFails = false;
    await page.locator('#retry-popularity').click();
    await mixed(page);
    assert.deepEqual((await state(page)).ranking, combined.ranking);
    await dot(page).first().press('Enter');
    const selectedAnime = (await state(page)).selectedKeys;

    assert.equal(movieRequests, 0, 'anime reception uses AniList data');
    movieResponse = 'missing';
    await switchTo(page, movieTitles);
    await ready(page);
    const reverseExample = await state(page);
    await choosePopularity(page);
    await page.locator('#retry-popularity').waitFor();
    assert.equal(movieURL.searchParams.get('snapshot'), catalogue.meta.catalogue_snapshot);
    assert.ok(await add(page).isDisabled());
    assert.deepEqual((await state(page)).ranking, reverseExample.ranking);
    movieResponse = 'ok';
    await page.locator('#retry-popularity').click();
    await add(page).click();
    await mixed(page);
    assert.ok(movieURL.searchParams.has('retry'));
    assert.ok(await colorByMagnet.isChecked());
    assert.equal(await page.getByRole('slider', { name: 'Popularity strength' }).inputValue(), '1');
    assert.doesNotMatch(await page.locator('#movie-magnets').innerText(), /TMDB popularity|eligible/);
    assert.ok(await page.locator('#popularity-magnet-source').isHidden());
    assert.equal(await page.locator('#recommendation-chart .dust-magnet').last().locator('title').textContent(), 'Popularity');
    await assertTooltip(page, 'Attack on Titan');
    await openAnalysisTab(page, 'connections');
    await page.locator(`[data-dust-member-movie="${movies}"]`).click();
    assert.deepEqual(await popularityMembers.locator('thead th').allTextContents(),
      ['Rank', 'Movie', 'TMDB popularity', 'Attraction percentile']);
    await dot(page).first().press('Enter');
    const movieBlend = await state(page);
    assert.deepEqual(movieBlend.magnetKeys, ['anilist:16498', movies]);
    const interstellarId = '157336';
    const interstellarKey = `tmdb:${interstellarId}`;
    const interstellar = movieBlend.ranking.find(row => row[0] === interstellarKey);
    const rawPopularity = interstellar[2][1];
    assert.equal(rawPopularity, archive.popularity[interstellarId]);
    const reception = await page.evaluate(key => AnivizMain.snapshot().lookup.get(key).record, interstellarKey);
    assert.equal(reception.vote_average, archive.vote_average[interstellarId]);
    const cataloguePage = await browser.newPage();
    await cataloguePage.goto(new URL('frontend/explorer/index.html', base).href);
    await cataloguePage.getByRole('button', { name: 'Movie', exact: true }).click();
    await cataloguePage.locator('#movie-table-body tr').first().waitFor();
    await cataloguePage.fill('#search-input', 'Interstellar');
    const cells = await cataloguePage.locator(`[data-movie-id="${interstellarId}"] td`).allTextContents();
    assert.equal(Number(cells[1]), reception.popularity_rank);
    assert.equal(Number(cells[5]), reception.vote_average);
    assert.equal(Number(cells[6]), rawPopularity);
    await cataloguePage.close();
    await switchTo(page, animeTitles);
    assert.deepEqual((await state(page)).selectedKeys, selectedAnime);
    await switchTo(page, movieTitles);
    assert.deepEqual(await state(page), movieBlend);

    movieResponse = 'wrong IDs';
    await page.reload();
    await page.locator('#retry-popularity').waitFor();
    await ready(page);
    assert.deepEqual((await state(page)).activeMagnetKeys, ['anilist:16498']);
    assert.deepEqual((await state(page)).ranking, reverseExample.ranking);
    movieResponse = 'ok';
    await page.locator('#retry-popularity').click();
    await mixed(page);
    assert.deepEqual((await state(page)).ranking, movieBlend.ranking);

    await switchTo(page, 'movie-writers');
    await choosePopularity(page);
    await add(page).click();
    await page.waitForFunction(() => AnivizMain.snapshot().mixed);
    await page.locator('[data-dust-member-movie="anilist:16498"]').click();
    const similarityMembers = page.getByRole('table', { name: 'Dust members for Attack on Titan' });
    await similarityMembers.waitFor();
    assert.deepEqual(await similarityMembers.locator('thead th').allTextContents(),
      ['Rank', 'Movie writer', 'Similarity', 'Attraction percentile']);
    await page.locator(`[data-dust-member-movie="${movies}"]`).click();
    assert.deepEqual(await popularityMembers.locator('thead th').allTextContents(),
      ['Rank', 'Movie writer', 'TMDB popularity', 'Attraction percentile', 'Title counts']);
    for (const index of [0, 1, 2]) await dot(page).nth(index).press('Enter');
    assert.equal(await page.locator('#recommendation-detail h3').innerText(), 'Comparing 3 movie writers');
    assert.equal(await comparison.getByRole('rowheader', { name: 'TMDB popularity', exact: true }).count(), 1);
    assert.equal(await comparison.getByRole('rowheader', { name: 'M2 · TMDB popularity', exact: true }).count(), 1);
    assert.deepEqual(errors, []);

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await phone.goto(base);
    await ready(phone);
    await choosePopularity(phone);
    await add(phone).tap();
    await mixed(phone);
    assert.ok(await phone.getByRole('radio', { name: 'Strongest magnet' }).isVisible());
    await dot(phone).first().press('Enter');
    assert.match(await phone.locator('#dust-focus').innerText(), /AniList users/);
    await phone.locator('[data-dust-chart="connections"]').scrollIntoViewIfNeeded();
    await assertTitleMemberLayout(phone);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log('Popularity browser checks passed for both directions, retry, and mobile.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
