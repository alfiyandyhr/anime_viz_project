const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const slider = (page, title) => page.getByRole('slider', { name: `Strength for ${title}` });
const field = page => page.locator('#recommendation-chart');
const ready = page => field(page).locator('.dust-node').first().waitFor();
const layout = page => page.evaluate(() => {
  const { direction, sessions } = JSON.parse(sessionStorage.getItem(AnivizDust.STORAGE_KEY));
  return sessions[direction].layout;
});
const evidence = page => page.evaluate(() => {
  const { revision, candidateKeys, selectedKeys, ranking } = AnivizMain.snapshot();
  return { revision, candidateKeys, selectedKeys, ranking: ranking.map(row => [row.key, row.rank, row.rawScores]) };
});

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(base);
    await ready(page);
    await page.getByRole('radio', { name: 'Genre cohort' }).check();
    await page.selectOption('#genre-magnet-choice', 'tmdb:genre:Science Fiction');
    await page.locator('#add-genre-magnet').click();
    await page.getByRole('radio', { name: 'High popularity' }).check();
    await page.locator('#add-popularity-magnet').click();
    await page.waitForFunction(() => AnivizMain.snapshot().mixed && AnivizMain.snapshot().ranking.length === 1000);
    await field(page).locator('.dust-node').first().press('Enter');
    const before = await evidence(page);

    const title = slider(page, 'Inception');
    await title.press('Home');
    assert.equal(await title.inputValue(), '0');
    assert.equal(await title.getAttribute('aria-valuetext'), '0× · Muted');
    assert.equal(await title.evaluate(input => input === document.activeElement), true);
    for (const view of [field(page), page.locator('#dust-mirror')]) {
      assert.match(await view.locator('.dust-magnet').first().getAttribute('class'), /is-muted/);
      assert.equal(await view.locator('.magnet-core').first().evaluate(core => getComputedStyle(core).strokeDasharray), '3px, 3px');
    }

    const genre = slider(page, 'Science Fiction movies');
    await genre.press('ArrowRight');
    const genreStrength = Number(await genre.inputValue());
    assert.ok(genreStrength > 1 && genreStrength < 2);
    const popularity = slider(page, 'High anime popularity');
    await popularity.scrollIntoViewIfNeeded();
    const box = await popularity.boundingBox();
    await page.mouse.move(box.x + box.width * .6, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2);
    const popularityStrength = Number(await popularity.inputValue());
    assert.ok(popularityStrength > 1.4);
    assert.equal(await popularity.evaluate(input => input === document.activeElement), true);
    assert.equal((await layout(page)).magnetStrengths['anilist:popularity'], undefined);
    await page.mouse.up();
    assert.equal((await layout(page)).magnetStrengths['anilist:popularity'], popularityStrength);
    assert.deepEqual(await evidence(page), before);

    await page.selectOption('#dust-direction', 'anime-to-movies');
    const anime = slider(page, 'Attack on Titan');
    await anime.press('End');
    assert.equal(await anime.inputValue(), '2');
    await page.reload();
    await ready(page);
    assert.equal(await anime.inputValue(), '2');
    await page.selectOption('#dust-direction', 'movie-to-anime');
    await page.waitForFunction(() => AnivizMain.snapshot().mixed);
    assert.equal(await title.inputValue(), '0');
    assert.equal(Number(await genre.inputValue()), genreStrength);
    assert.equal(Number(await popularity.inputValue()), popularityStrength);
    const magnet = field(page).locator('.dust-magnet').first();
    const defaultPosition = await magnet.getAttribute('transform');
    await magnet.press('ArrowRight');
    await page.waitForFunction(initial => document.querySelector('#recommendation-chart .dust-magnet').getAttribute('transform') !== initial, defaultPosition);
    const moved = await magnet.getAttribute('transform');
    await page.getByRole('button', { name: 'Reset strengths' }).click();
    assert.equal(await magnet.getAttribute('transform'), moved);
    assert.equal(await title.inputValue(), '1');
    assert.equal(await genre.inputValue(), '1');
    assert.equal(await popularity.inputValue(), '1');
    await title.press('Home');
    await page.getByRole('button', { name: 'Reset positions' }).click();
    assert.equal(await magnet.getAttribute('transform'), defaultPosition);
    assert.equal(await title.inputValue(), '0');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true,
      hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await mobile.goto(base);
    await ready(mobile);
    const touch = slider(mobile, 'Inception');
    await touch.scrollIntoViewIfNeeded();
    const range = await touch.boundingBox();
    await touch.tap({ position: { x: range.width * .8, y: range.height / 2 } });
    const strength = Number(await touch.inputValue());
    assert.ok(strength > 1);
    assert.equal(Object.values((await layout(mobile)).magnetStrengths)[0], strength);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
    console.log('Dust strengths passed for pointer, keyboard, mobile touch, both directions and reloads.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
