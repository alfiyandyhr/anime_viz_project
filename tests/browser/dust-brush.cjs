// Optional browser regression. See journey-verification.md for Playwright setup.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { openAnalysisTab } = require('./dust-analysis-tab.cjs');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('frontend/dust-magnet/index.html', base).href);
    const field = page.locator('#recommendation-chart');
    const mirror = page.locator('#dust-mirror');
    const frame = field.locator('.dust-brush-frame');
    const brushBounds = () => frame.evaluate(el => el.getBoundingClientRect().toJSON());
    const strongest = page.getByRole('radio', { name: 'Strongest magnet' });
    const brushing = page.getByRole('radio', { name: 'Brushing and linking' });
    await field.locator('.dust-node').first().waitFor();
    await page.waitForFunction(() => AnivizMain.snapshot().metadataStatus === 'ready');
    assert.ok(await strongest.isChecked());
    assert.ok(await frame.isHidden());
    await brushing.check();
    assert.ok(await brushing.isChecked());
    assert.ok(await frame.isVisible());
    await openAnalysisTab(page, 'reception');
    assert.ok(await mirror.locator('.dust-brush-frame').isVisible());
    assert.equal(await field.locator('.dust-brush circle').count(), 0);
    assert.ok(await frame.evaluate(el => {
      const { x, y, width, height } = el.getBBox();
      const view = el.ownerSVGElement.viewBox.baseVal;
      return Math.abs(x + width / 2 - view.width / 2) < 0.1 && Math.abs(y + height / 2 - view.height / 2) < 0.1;
    }));
    assert.equal(await field.locator('.magnet-number').evaluate(el => getComputedStyle(el).userSelect), 'none');

    const heatmap = page.locator('[data-dust-chart="heatmap"]');
    const heatmapColors = async () => {
      await openAnalysisTab(page, 'heatmap');
      await heatmap.scrollIntoViewIfNeeded();
      const tiles = heatmap.locator('rect[role="img"]');
      await tiles.first().waitFor();
      return tiles.evaluateAll(nodes => nodes.map(node => node.getAttribute('fill')));
    };

    const drag = async (x, y, dx, dy) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 8 });
      await page.mouse.up();
    };
    const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 2, `${actual} ≈ ${expected}`);
    const frameAttributes = plot => plot.locator('.dust-brush-frame').evaluate(el =>
      ['x', 'y', 'width', 'height'].map(attribute => Number(el.getAttribute(attribute))));
    const brushGrabPoint = plot => plot.locator('.dust-brush-surface').evaluate(surface => {
      const rect = surface.getBoundingClientRect();
      for (let y = rect.top + 12; y < rect.bottom - 12; y += 4) {
        for (let x = rect.left + 12; x < rect.right - 12; x += 4) {
          if (document.elementFromPoint(x, y) === surface) return [x, y];
        }
      }
      throw new Error('No reachable point inside the brush');
    });
    const selected = field.locator('.dust-node').first();
    await selected.press('Enter');
    const selection = await page.evaluate(() => AnivizMain.snapshot().selectedKeys);
    const originalHeatmap = await heatmapColors();
    assert.ok(originalHeatmap.some(fill => fill.includes('var(--color-primary-strong)')));
    assert.ok(originalHeatmap.every(fill => fill === 'var(--bg-soft)' || fill.includes('var(--color-primary-strong)')));
    await page.evaluate(() => window.scrollTo(0, 0));
    const start = await brushBounds();
    const dot = await selected.locator('.dust-hit-area').boundingBox();
    const dx = dot.x + dot.width / 2 - start.x - start.width / 2;
    const dy = dot.y + dot.height / 2 - start.y - start.height / 2;
    const [grabX, grabY] = await brushGrabPoint(field);
    await page.mouse.click(grabX, grabY);
    const brush = field.getByRole('group', { name: 'Brush selection' });
    assert.equal(await brush.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    assert.equal(await frame.evaluate(el => getComputedStyle(el).strokeDasharray), 'none');
    await drag(grabX, grabY, dx, dy);
    const moved = await brushBounds();
    near(moved.x, start.x + dx);
    near(moved.y, start.y + dy);
    near(moved.width, start.width);
    near(moved.height, start.height);
    await drag(moved.x + moved.width, moved.y + moved.height / 2, 28, 0);
    const wider = await brushBounds();
    near(wider.width, moved.width + 28);
    near(wider.height, moved.height);
    await drag(wider.x + wider.width / 4, wider.y, 0, -24);
    const taller = await brushBounds();
    near(taller.height, wider.height + 24);
    near(taller.width, wider.width);

    const pink = 'var(--pink)', grey = 'var(--dust-uniform)';
    const verifyGeometry = () => field.evaluate((el, { pink, grey }) => {
      const rect = el.querySelector('.dust-brush-frame').getBoundingClientRect();
      return [...el.querySelectorAll('.dust-grain')].flatMap(grain => {
        const dot = grain.getBoundingClientRect();
        const x = dot.x + dot.width / 2, y = dot.y + dot.height / 2;
        const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        if (grain.getAttribute('fill') !== (inside ? pink : grey)) throw new Error('Brush colors do not match geometry');
        return inside ? [grain.__data__.key] : [];
      });
    }, { pink, grey });
    const keys = await verifyGeometry();
    assert.ok(keys.length > 0 && keys.length < await field.locator('.dust-node').count());
    assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedKeys), selection);
    assert.deepEqual(await page.locator('#dust-mirror .dust-grain[fill="var(--pink)"]').evaluateAll(grains =>
      grains.map(grain => grain.__data__.key)), keys);

    await openAnalysisTab(page, 'ranking');
    const ranking = await page.locator('[data-dust-ranking-body]').evaluate(body => {
      const grains = new Map([...document.querySelectorAll('#recommendation-chart .dust-grain')]
        .map(grain => [grain.__data__.key, getComputedStyle(grain).fill]));
      return [...body.querySelectorAll('tr')].map(row => {
        const title = row.querySelector('[data-dust-rank-id]');
        const expected = grains.get(title.dataset.dustRankId);
        return expected && [title, ...row.cells].every(cell => getComputedStyle(cell).color === expected);
      });
    });
    assert.ok(ranking.includes(true));
    assert.ok(ranking.every(match => match !== false));

    const ids = keys.map(key => key.split(':')[1]);
    for (const [kind, selector] of [
      ['connections', '.dust-connection-dot'],
      ['reception', '.reception-dot'],
      ['genres', 'rect[role="img"]'],
      ['years', 'rect[role="img"], circle'],
      ['studios', '.credit-dot']
    ]) {
      await openAnalysisTab(page, kind);
      const chart = page.locator(`[data-dust-chart="${kind}"]`);
      await chart.scrollIntoViewIfNeeded();
      const marks = chart.locator(selector);
      await marks.first().waitFor();
      const colors = await marks.evaluateAll((nodes, { kind, ids, pink, grey }) => nodes.map(node => {
        const datum = node.__data__;
        const members = datum.ids ?? [String(datum.id ?? datum.record?.id)];
        const highlighted = members.some(id => ids.includes(id));
        const fill = node.getAttribute('fill');
        const actual = kind === 'connections' ? node.parentElement.style.getPropertyValue('--dust-color')
          : fill === 'transparent' ? node.getAttribute('stroke') : fill;
        return { highlighted, correct: actual.includes(highlighted ? pink : grey) };
      }), { kind, ids, pink, grey });
      assert.ok(colors.some(mark => mark.highlighted), kind);
      assert.ok(colors.every(mark => mark.correct), kind);
    }
    assert.deepEqual(await heatmapColors(), originalHeatmap);

    await openAnalysisTab(page, 'reception');
    await strongest.check();
    assert.ok(await frame.isHidden());
    assert.ok(await mirror.locator('.dust-brush-frame').isHidden());
    assert.equal(await field.locator('.dust-grain[fill="var(--pink)"]').count(), 0);
    await brushing.check();
    assert.deepEqual(await verifyGeometry(), keys);
    const beforeKeyboard = await frame.getAttribute('width');
    await brush.press('Shift+ArrowRight');
    assert.equal(Number(await frame.getAttribute('width')), Number(beforeKeyboard) + 8);
    const beforeZoom = await brushBounds();
    const keysBeforeZoom = await verifyGeometry();
    await field.getByRole('button', { name: 'Zoom in' }).press('Enter');
    const zoomed = await brushBounds();
    near(zoomed.width, 2 * beforeZoom.width);
    near(zoomed.height, 2 * beforeZoom.height);
    assert.deepEqual(await verifyGeometry(), keysBeforeZoom);
    await field.locator('.dust-map').press('ArrowRight');
    assert.deepEqual(await verifyGeometry(), keysBeforeZoom);
    await page.evaluate(() => window.scrollTo(0, 0));
    const panned = await brushBounds();
    near(panned.x, zoomed.x - 48);
    await drag(panned.x + panned.width, panned.y + panned.height, 32, 24);
    const resized = await brushBounds();
    near(resized.width, panned.width + 32);
    near(resized.height, panned.height + 24);
    await verifyGeometry();
    await openAnalysisTab(page, 'reception');
    await mirror.scrollIntoViewIfNeeded();
    const initialMirror = await frameAttributes(mirror);
    const [mirrorX, mirrorY] = await brushGrabPoint(mirror);
    await drag(mirrorX, mirrorY, 28, 0);
    const movedMirror = await frameAttributes(mirror);
    assert.ok(movedMirror[0] > initialMirror[0]);
    assert.deepEqual(movedMirror, await frameAttributes(field));
    const mirrorBrush = mirror.getByRole('group', { name: 'Brush selection' });
    await mirrorBrush.press('Shift+ArrowDown');
    assert.equal((await frameAttributes(field))[3], movedMirror[3] + 8);
    const finalKeys = await verifyGeometry();
    assert.deepEqual(await mirror.locator('.dust-grain[fill="var(--pink)"]').evaluateAll(grains =>
      grains.map(grain => grain.__data__.key)), finalKeys);
    assert.deepEqual(errors, []);
    console.log('Verified centered brushes, pointer focus styling, shared drag and resize, and linked colors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
