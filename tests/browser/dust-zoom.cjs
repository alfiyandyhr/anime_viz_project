// Optional real-browser verification. See tests/journey-verification.md for setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const url = new URL('frontend/dust-magnet/', base).href;
const field = '#recommendation-chart';
const mirror = '#dust-mirror';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrfcAAAAASUVORK5CYII=', 'base64');

const button = (view, name) => view.getByRole('button', { name, exact: true });
const camera = view => view.locator('.dust-map').evaluate(svg => ({ ...svg.__zoom }));

async function zoomToPosters(view) {
  const zoomIn = button(view, 'Zoom in');
  await zoomIn.press('Enter');
  await zoomIn.press('Enter');
  assert.equal(await view.locator('.dust-poster').count(), 0);
  await zoomIn.press('Enter');
  assert.equal(await view.locator('.dust-map.shows-posters').count(), 1);
}

async function assertPosters(page, selector, host) {
  const view = page.locator(selector);
  await page.waitForFunction(({ selector, host }) =>
    [...document.querySelectorAll(`${selector} .dust-poster img`)].some(img => img.src.includes(host) && img.naturalWidth),
  { selector, host });
  const cards = await view.locator('.dust-node').evaluateAll(nodes => nodes.map(node => {
    const grain = node.querySelector('.dust-grain');
    const caption = node.querySelector('.dust-poster-title');
    return [getComputedStyle(grain).display, getComputedStyle(grain).fill, getComputedStyle(caption).color,
      caption.textContent, node.__data__.record.title];
  }));
  for (const [display, dustColor, titleColor, title, fullTitle] of cards) {
    assert.equal(display, 'none');
    assert.equal(titleColor, dustColor);
    assert.equal(title, fullTitle);
  }
}

async function assertPosterSelectionAndPan(page, view) {
  await view.scrollIntoViewIfNeeded();
  const hit = await view.locator('.dust-poster-card').evaluateAll(cards => {
    for (const card of cards) {
      const { x, y, width, height } = card.getBoundingClientRect();
      const point = { x: x + width / 2, y: y + height / 2 };
      if (card.contains(document.elementFromPoint(point.x, point.y))) {
        return { ...point, key: card.closest('.dust-node').dataset.matchId };
      }
    }
  });
  assert.ok(hit);
  await page.mouse.click(hit.x, hit.y);
  const selected = () => page.evaluate(() => AnivizMain.snapshot().selectedKeys);
  assert.deepEqual(await selected(), [hit.key]);
  assert.equal(await page.locator(`${mirror} [data-match-id="${hit.key}"]`).getAttribute('aria-pressed'), 'true');
  const before = await camera(view);
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.down();
  await page.mouse.move(hit.x + 32, hit.y + 16, { steps: 5 });
  await page.mouse.up();
  assert.notDeepEqual(await camera(view), before);
  assert.deepEqual(await selected(), [hit.key]);
  await button(view, 'Reset zoom').click();
  assert.equal((await camera(view)).k, 1);
  assert.equal(await view.locator('.dust-grain').first().isVisible(), true);
  assert.deepEqual(await selected(), [hit.key]);
}

async function assertTouchZoom(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await page.goto(url);
  const map = page.locator(`${field} .dust-map`);
  await map.scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  const send = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

  const opening = await map.boundingBox();
  const start = { x: Math.round(opening.x + opening.width / 3), y: Math.round(opening.y + opening.height * .6), id: 0 };
  const before = await page.evaluate(() => scrollY);
  await send('touchStart', [start]);
  for (const delta of [20, 45, 75, 100]) await send('touchMove', [{ ...start, y: start.y - delta }]);
  await send('touchEnd');
  await page.waitForFunction(before => scrollY > before, before);

  await map.scrollIntoViewIfNeeded();
  const { x, y, width, height } = await map.boundingBox();
  const center = { x: Math.round(x + width / 2), y: Math.round(y + height / 3) };
  const points = span => [-span, span].map((offset, id) => ({ x: center.x + offset, y: center.y, id }));
  await send('touchStart', points(12));
  for (const span of [30, 55, 85, 110]) await send('touchMove', points(span));
  await send('touchEnd');
  assert.equal(await map.evaluate(svg => svg.classList.contains('shows-posters')), true);
  await button(page.locator(field), 'Reset zoom').tap();
  assert.equal(await map.evaluate(svg => svg.__zoom.k), 1);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https:\/\/(?:s4\.anilist\.co|image\.tmdb\.org)\//,
      route => route.fulfill({ contentType: 'image/png', body: pixel }));
    let releaseMovieDetails;
    const movieDetails = new Promise(resolve => { releaseMovieDetails = resolve; });
    await page.route('**/data/movie_details.json', async route => {
      await movieDetails;
      await route.continue();
    });
    await page.goto(url);
    const mainView = page.locator(field);
    const mirrorView = page.locator(mirror);
    const colorControl = page.locator('#dust-color-by-magnet');
    await zoomToPosters(mainView);
    await colorControl.check();
    await assertPosters(page, field, 'anilist.co');
    assert.equal((await camera(mirrorView)).k, 1);
    await page.selectOption('#dust-limit', '30');
    assert.equal((await camera(mainView)).k, 8);
    await assertPosterSelectionAndPan(page, mainView);

    const map = mainView.locator('.dust-map');
    await map.hover();
    await page.mouse.wheel(0, -1600);
    await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('shows-posters'), `${field} .dust-map`);
    await button(mainView, 'Zoom out').click();
    assert.equal(await mainView.locator('.dust-grain').first().isVisible(), true);

    await page.selectOption('#dust-type', 'movie-titles');
    assert.equal((await camera(mainView)).k, 1);
    await zoomToPosters(mirrorView);
    assert.equal(await mirrorView.locator('.dust-poster img[src]').count(), 0);
    releaseMovieDetails();
    await assertPosters(page, mirror, 'image.tmdb.org');
    await zoomToPosters(mainView);
    await assertPosters(page, field, 'image.tmdb.org');
    await assertPosterSelectionAndPan(page, mainView);
    assert.equal((await camera(mirrorView)).k, 8);
    assert.deepEqual(errors, []);
    await assertTouchZoom(browser);
    console.log('Verified poster zoom, colors, selection, panning, late artwork, and touch zoom.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
