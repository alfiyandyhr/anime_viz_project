// Optional browser regression: run with the Playwright setup in journey-verification.md.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('frontend/dust-magnet/index.html', base).href);
    const field = page.locator('#recommendation-chart');
    const mirror = page.locator('#dust-mirror');
    const scatter = page.locator('[data-dust-chart="reception"]');
    await field.locator('.dust-node').first().waitFor();
    await page.waitForFunction(() => AnivizMain.snapshot().metadataStatus === 'ready');

    const selection = () => page.evaluate(() => AnivizMain.snapshot().selectedKeys);
    await scatter.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const firstPoint = scatter.locator('.reception-dot').first();
    await firstPoint.waitFor();
    const chartTop = () => scatter.evaluate(el => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(el.getBoundingClientRect().top)));
    }));
    const restingTop = await chartTop();
    for (const count of [1, 0]) {
      await firstPoint.click();
      assert.equal((await selection()).length, count);
      assert.ok(Math.abs(await chartTop() - restingTop) < 2, 'point clicks keep the chart in place');
      assert.deepEqual(await firstPoint.evaluate(el => {
        const style = getComputedStyle(el);
        return [style.outlineStyle, style.filter];
      }), ['none', 'none'], 'pointer selection leaves no focus box or halo');
    }
    await page.keyboard.press('Tab');
    const keyboardPoint = scatter.locator('.reception-dot:focus-visible');
    assert.notEqual(await keyboardPoint.evaluate(el => getComputedStyle(el).filter), 'none');

    for (const movie of ['Interstellar', 'The Matrix']) {
      await page.locator('#movie-search').fill(movie);
      await page.locator('#movie-search').press('Enter');
    }

    const geometry = view => view.evaluate(container => [...container.querySelectorAll(
      '.dust-node, .dust-magnet, .dust-selected-link'
    )].map(el => ['transform', 'x1', 'y1', 'x2', 'y2', 'stroke'].map(attr => el.getAttribute(attr))));
    const dragFirstMagnet = async view => {
      const core = view.locator('.magnet-core').first();
      await core.scrollIntoViewIfNeeded();
      const { x, y, width, height } = await core.boundingBox();
      const centerX = x + width / 2, centerY = y + height / 2;
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + 60, centerY + 20, { steps: 5 });
      await page.mouse.up();
    };
    const firstDust = field.locator('.dust-node').first();
    const firstId = await firstDust.getAttribute('data-match-id');
    await firstDust.press('Enter');
    const beforeMove = await geometry(field);
    await dragFirstMagnet(field);
    const afterMove = await geometry(field);
    assert.notDeepEqual(afterMove, beforeMove);
    assert.deepEqual(await geometry(mirror), afterMove);

    await scatter.scrollIntoViewIfNeeded();
    await scatter.locator('.reception-dot').first().waitFor();
    assert.match(await page.locator('[data-coverage="reception"]').innerText(), /Circle area: favourites/);
    const layout = await Promise.all([scatter.boundingBox(), mirror.boundingBox()]);
    assert.ok(layout[0].x + layout[0].width < layout[1].x);
    assert.equal(layout[0].height, 473);
    const pair = await page.locator('.dust-reception').boundingBox();
    const connections = await page.locator('[data-dust-chart="connections"]').boundingBox();
    const genres = await page.locator('#content').boundingBox();
    assert.ok(connections.y + connections.height < pair.y && pair.y + pair.height < genres.y);
    const evidence = await scatter.evaluate(container => {
      const points = [...container.querySelectorAll('.reception-dot')];
      const dust = document.querySelector('#recommendation-chart');
      const colorMatches = points.every(point => {
        const grain = dust.querySelector(`[data-match-id="anilist:${point.__data__.id}"] .dust-grain`);
        return grain.getAttribute('fill') === point.getAttribute('fill');
      });
      const areaRatios = points.map(point => Number(point.getAttribute('r')) ** 2 / point.__data__.favourites);
      const targets = points.flatMap((point, index) => {
        const { x, y, width, height } = point.getBoundingClientRect();
        const hit = document.elementFromPoint(x + width / 2, y + height / 2);
        return hit === point && point.__data__.genres.length > 1
          ? [{ index, id: `anilist:${point.__data__.id}`, genres: point.__data__.genres.join(', ') }] : [];
      });
      return { colorMatches, areaRatios, targets };
    });
    assert.ok(evidence.colorMatches);
    assert.ok(evidence.areaRatios.length > 1);
    assert.ok(evidence.areaRatios.every(value => Math.abs(value - evidence.areaRatios[0]) < 1e-12));
    assert.equal(await scatter.locator('.reception-selection-ring').count(), 1);

    const targets = evidence.targets.filter(point => point.id !== firstId).slice(0, 2);
    assert.equal(targets.length, 2);
    const point = target => scatter.locator('.reception-dot').nth(target.index);
    await point(targets[0]).hover();
    assert.ok((await page.locator('#tooltip').innerText()).includes(targets[0].genres));
    for (const target of targets) await point(target).click();
    const selected = [firstId, ...targets.map(target => target.id)];
    assert.deepEqual(await selection(), selected);
    assert.match(await page.locator('#recommendation-detail').innerText(), /Comparing 3 anime/);
    const rings = scatter.locator('.reception-selection-ring');
    assert.equal(await rings.count(), 3);
    assert.equal(await rings.first().evaluate(el => getComputedStyle(el).strokeDasharray), '2px, 2px');
    assert.equal(await mirror.locator('.dust-selected-link').count(), 9);
    const selectedGeometry = await geometry(field);
    assert.deepEqual(await geometry(mirror), selectedGeometry);

    const mirrorDust = mirror.locator(`[data-match-id="${targets[1].id}"]`);
    await mirrorDust.hover();
    assert.equal(await page.locator('#tooltip .dust-tooltip-score').count(), 3);
    await mirrorDust.click();
    assert.deepEqual(await selection(), selected.slice(0, 2));
    assert.equal(await mirrorDust.getAttribute('aria-pressed'), 'false');
    assert.equal(await rings.count(), 2);
    await mirrorDust.press('Space');
    assert.deepEqual(await selection(), selected);
    assert.equal(await mirrorDust.getAttribute('aria-pressed'), 'true');
    assert.equal(await field.locator(`[data-match-id="${targets[1].id}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(await rings.count(), 3);

    const mirrorMagnet = mirror.locator('.dust-magnet').first();
    const magnetPosition = () => mirrorMagnet.getAttribute('transform');
    const beforeDrag = await magnetPosition();
    await dragFirstMagnet(mirror);
    assert.notEqual(await magnetPosition(), beforeDrag);
    assert.deepEqual(await geometry(mirror), await geometry(field));
    assert.deepEqual(await selection(), selected);
    const beforeArrow = await magnetPosition();
    await mirrorMagnet.press('ArrowLeft');
    assert.notEqual(await magnetPosition(), beforeArrow);
    assert.deepEqual(await geometry(mirror), await geometry(field));
    await mirrorMagnet.locator('.magnet-core').click();
    assert.deepEqual(await selection(), selected);

    for (const count of [2, 1]) {
      await mirror.click({ position: { x: 5, y: 5 } });
      assert.deepEqual(await selection(), selected.slice(0, count));
      assert.equal(await rings.count(), count);
      assert.equal(await field.locator('.dust-node.is-selected').count(), count);
      assert.equal(await mirror.locator('.dust-selected-link').count(), count * 3);
    }
    await point(targets[0]).click();
    await point(targets[1]).press('Enter');
    assert.deepEqual(await selection(), selected);
    await scatter.click({ position: { x: 5, y: 5 } });
    assert.deepEqual(await selection(), selected);
    assert.match(await page.locator('#recommendation-detail').innerText(), /Comparing 3 anime/);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const scatter = document.querySelector('[data-dust-chart="reception"]');
      const mirror = document.querySelector('#dust-mirror');
      return mirror.getBoundingClientRect().top > scatter.getBoundingClientRect().bottom
        && document.documentElement.scrollWidth === innerWidth;
    });
    assert.deepEqual(errors, []);
    console.log('Verified scatter styling, shared selection, mirror dragging and keyboard controls, and desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
