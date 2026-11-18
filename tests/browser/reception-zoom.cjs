// Optional real-browser verification. See tests/journey-verification.md for setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrfcAAAAASUVORK5CYII=', 'base64');

const button = (view, name) => view.getByRole('button', { name, exact: true });

async function verifyZoom(page, selector, movie, dust) {
  const view = page.locator(selector);
  await view.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const plot = view.locator('.reception-plot');
  const camera = () => plot.evaluate(svg => ({ ...svg.__zoom }));
  const axes = () => plot.locator('.axis .tick text').allTextContents();
  const cards = view.locator('.reception-poster');
  const dots = view.locator('.reception-dot');
  await dots.first().waitFor();
  assert.equal((await camera()).k, 1);
  const overviewAxes = await axes();
  const zoomIn = button(view, 'Zoom in');
  await zoomIn.press('Enter');
  await zoomIn.press('Enter');
  assert.equal((await camera()).k, 4);
  assert.equal(await cards.count(), 0);
  assert.notDeepEqual(await axes(), overviewAxes);
  const tabbableDots = await view.locator('.reception-dot[tabindex="0"]').count();
  assert.ok(tabbableDots > 0 && tabbableDots < await dots.count());

  await zoomIn.press('Enter');
  assert.equal((await camera()).k, 8);
  assert.ok(await cards.count() > 0, 'button zoom keeps a title in view');
  assert.equal(await dots.first().isVisible(), false);
  await page.waitForFunction(({ selector, host }) =>
    [...document.querySelectorAll(`${selector} .reception-poster img`)]
      .some(img => img.src.includes(host) && img.naturalWidth),
  { selector, host: movie ? 'image.tmdb.org' : 'anilist.co' });

  const hit = await cards.evaluateAll(posters => posters.flatMap((card, index) => {
    const { x, y, width, height } = card.getBoundingClientRect();
    const px = x + width / 2, py = y + height / 2;
    return card.contains(document.elementFromPoint(px, py)) ? [{ px, py, index }] : [];
  })[0]);
  assert.ok(hit, 'a visible poster can be clicked');
  const card = cards.nth(hit.index);
  const title = await card.locator('.dust-poster-title').textContent();
  const selectedLabel = await card.getAttribute('aria-label');
  const before = await camera();
  assert.ok(selectedLabel.startsWith(title));
  await page.mouse.move(hit.px, hit.py);
  assert.ok((await page.locator('#tooltip').innerText()).includes(title));
  if (movie) await card.press('Enter');
  else await page.mouse.click(hit.px, hit.py);
  const drawer = page.locator('#detail-drawer.open');
  assert.equal(await drawer.getAttribute('aria-label'), movie ? 'Movie details' : 'Anime details');
  assert.equal(await drawer.locator('h2').innerText(), title);
  await page.keyboard.press('Escape');
  assert.deepEqual(await camera(), before);
  if (dust) assert.equal(await view.getByRole('button', { name: selectedLabel, exact: true }).getAttribute('aria-pressed'), 'true');

  await plot.press('ArrowRight');
  if ((await camera()).x === before.x) await plot.press('ArrowLeft');
  assert.notEqual((await camera()).x, before.x);
  const beforeDrag = await camera();
  const bounds = await plot.boundingBox();
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.sign(before.x - beforeDrag.x) * 32, y, { steps: 4 });
  await page.mouse.up();
  assert.notEqual((await camera()).x, beforeDrag.x);
  assert.equal(await drawer.count(), 0);
  await button(view, 'Zoom out').click();
  assert.equal((await camera()).k, 4);
  assert.equal(await cards.count(), 0);
  await button(view, 'Reset zoom').click();
  assert.deepEqual(await axes(), overviewAxes);
  assert.equal((await camera()).k, 1);
  await plot.hover();
  await page.mouse.wheel(0, -1600);
  await plot.and(view.locator('.shows-posters')).waitFor();
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

    await page.goto(new URL('frontend/dust-magnet/index.html', base).href);
    await page.locator('#recommendation-chart .dust-node').first().waitFor();
    const dust = '[data-dust-chart="reception"]';
    await verifyZoom(page, dust, false, true);
    await page.selectOption('#dust-type', 'movie-titles');
    await page.locator('#recommendation-chart [data-match-id^="tmdb:"]').first().waitFor();
    await verifyZoom(page, dust, true, true);

    await page.goto(new URL('frontend/explorer/index.html', base).href);
    await page.locator('#anime-table-body tr').first().waitFor();
    const catalogue = '[data-catalogue-chart="reception"]';
    await verifyZoom(page, catalogue, false, false);
    await page.locator('[data-catalogue-target="movie"]').click();
    await page.locator('#movie-catalogue-status').getByText(/Loaded/).waitFor();
    await verifyZoom(page, catalogue, true, false);
    assert.deepEqual(errors, []);
    console.log('Verified poster zoom, changing axes, selection, and panning in all four reception views.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
