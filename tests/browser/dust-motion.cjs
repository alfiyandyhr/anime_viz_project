// Optional browser regression: run with the Playwright setup in journey-verification.md.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const field = '#recommendation-chart';
const mirror = '#dust-mirror';

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const maxTravel = (a, b) => Math.max(...a.map((point, i) => pointDistance(point, b[i])));
const drawn = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const geometry = (page, selector = field) => page.locator(selector).evaluate(container => {
  const points = selector => Array.from(container.querySelectorAll(selector), node => {
    const { e: x, f: y } = node.transform.baseVal.getItem(0).matrix;
    return { x, y };
  });
  return { dust: points('.dust-node'), magnets: points('.dust-magnet') };
});

async function dragInput(page, touch) {
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const touchEvent = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
  const svg = page.locator(`${field} svg`);
  const screen = (x, y) => svg.evaluate((node, { x, y }) => {
    const point = new DOMPoint(x, y).matrixTransform(node.getScreenCTM());
    return { x: point.x, y: point.y };
  }, { x, y });
  let offset;
  return {
    async start() {
      const core = page.locator(`${field} .magnet-core`).first();
      await core.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const { magnets: [anchor] } = await geometry(page);
      const origin = await screen(anchor.x, anchor.y);
      const point = touch ? origin : { x: Math.round(origin.x), y: Math.round(origin.y) };
      offset = { x: point.x - origin.x, y: point.y - origin.y };
      if (touch) await touchEvent('touchStart', point);
      else {
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
      }
    },
    async move(x, y) {
      const point = await screen(x, y);
      if (touch) await touchEvent('touchMove', point);
      else await page.mouse.move(Math.round(point.x + offset.x), Math.round(point.y + offset.y));
      await drawn(page);
    },
    async end() {
      if (touch) await touchEvent('touchEnd');
      else await page.mouse.up();
    }
  };
}

async function run(browser, touch) {
  const page = await browser.newPage(touch
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'no-preference' }
    : { viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  try {
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    const ready = async () => {
      await page.locator(`${field} .dust-node`).first().waitFor();
      await page.waitForFunction(() => AnivizMain.snapshot().metadataStatus === 'ready');
      await drawn(page);
    };
    await page.goto(new URL('frontend/dust-magnet/', base).href, { waitUntil: 'domcontentloaded' });
    await ready();
    for (const title of ['Interstellar', 'The Matrix']) {
      await page.locator('#movie-suggestions').getByRole('button', { name: title, exact: true }).click();
    }
    // Put the outer magnets on one line, including in the narrow touch field.
    await page.evaluate(() => {
      const { width, height } = dustChart;
      const margin = Math.min(76, width * .22);
      const line = Math.round(height * .63);
      const points = [[width / 2, Math.round(height * .23)], [margin, line], [width - margin, line]];
      AnivizMain.snapshot().activeMagnetKeys.forEach((key, i) => {
        const [x, y] = points[i];
        recommendationState.magnetPositions[`3:${key}`] = { x: x / width, y: y / height };
      });
      AnivizMain.saveLayout();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();

    const input = await dragInput(page, touch);
    for (const limit of [30, 60, 90]) {
      await page.selectOption('#dust-limit', String(limit));
      const start = await geometry(page);
      const [, left, right] = start.magnets;
      const x = start.magnets[0].x, line = left.y;
      assert.equal(start.dust.length, limit);
      assert.equal(line, right.y);
      await input.start();
      let previous = start;
      let below = false, above = false;
      // Touch coordinates can be quantized by the browser. Sweep across the
      // line in one-unit increments and check the rendered positions.
      const offsets = touch ? [-3, -2, -1, 0, 1, 2, 3] : [-2, -1, 0, 1, 2];
      for (const offset of offsets) {
        const y = line + offset;
        await input.move(x, y);
        const current = await geometry(page);
        assert.ok(Math.abs(current.magnets[0].y - y) < (touch ? 2 : 1.1),
          `missed line crossing at ${limit} dots: got ${current.magnets[0].y}, wanted ${y}`);
        below ||= current.magnets[0].y < line;
        above ||= current.magnets[0].y > line;
        const travel = maxTravel(current.dust, previous.dust);
        const magnetTravel = pointDistance(current.magnets[0], previous.magnets[0]);
        assert.equal(travel > 0, magnetTravel > 0, `dust travel ${travel}, magnet travel ${magnetTravel} at y=${y}`);
        assert.ok(travel <= 3 + 1e-4, `travel ${travel} at ${limit} dots`);
        assert.deepEqual(await geometry(page, mirror), current);
        previous = current;
      }
      assert.ok(below && above, 'the middle magnet crosses both sides of the line');
      await page.waitForTimeout(120);
      assert.deepEqual(await geometry(page), previous, 'a stationary hold leaves the field still');
      await input.move(x, 54);
      const swept = await geometry(page);
      const travel = maxTravel(swept.dust, previous.dust);
      assert.ok(travel > 0 && travel <= 3 + 1e-4, `fast sweep travel ${travel}`);
      await input.end();
      await page.waitForTimeout(120);
      assert.deepEqual(await geometry(page), swept, 'release leaves the field still');
    }

    for (const title of ['Interstellar', 'The Matrix']) {
      await page.getByRole('slider', { name: `Strength for ${title}` }).press('Home');
    }
    const expected = await page.evaluate(() => {
      const { positions, anchors, width, height } = dustChart;
      const nodes = AnivizMain.snapshot().displayedKeys.map(key => {
        const node = positions.get(key);
        return { ...node, scores: [node.scores[0]] };
      });
      return dragDustStep(nodes, [anchors[0]], width, height);
    });
    await page.getByRole('button', { name: 'Attract dust' }).click();
    assert.ok(maxTravel((await geometry(page)).dust, expected) < 1e-4);

    const anchors = (await geometry(page)).magnets;
    await page.getByRole('button', { name: 'Spread dust' }).click();
    const spread = await geometry(page);
    assert.deepEqual(spread.magnets, anchors);
    assert.ok(spread.dust.every((point, index) => spread.dust.slice(index + 1)
      .every(other => pointDistance(point, other) >= 18 - 1e-8)));
    assert.ok(spread.dust.every(point => anchors.every(anchor => pointDistance(point, anchor) >= 38 - 1e-8)));
    assert.deepEqual(await geometry(page, mirror), spread);
    await page.getByRole('button', { name: 'Center dust' }).click();
    const centered = await geometry(page);
    assert.deepEqual(centered.magnets, anchors);
    assert.notDeepEqual(centered.dust, spread.dust);
    await page.getByRole('button', { name: 'Reset positions' }).click();
    const reset = await geometry(page);
    assert.notDeepEqual(reset.magnets, anchors);
    assert.deepEqual(reset.dust, centered.dust);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    assert.deepEqual(await geometry(page), reset);
    assert.equal(await page.getByRole('slider', { name: 'Strength for The Matrix' }).inputValue(), '0');
    console.log(`${touch ? 'Mobile touch' : 'Desktop pointer'} motion verified at 30, 60 and 90 dots.`);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    await run(browser, false);
    await run(browser, true);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
