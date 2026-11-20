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
    const connections = page.locator('[data-dust-chart="connections"]');
    const colorControl = page.getByRole('radio', { name: 'Strongest magnet' });
    await field.locator('.dust-node').first().waitFor();
    await page.waitForFunction(() => AnivizMain.snapshot().metadataStatus === 'ready');

    const selection = () => page.evaluate(() => AnivizMain.snapshot().selectedKeys);
    await scatter.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const firstPoint = scatter.locator('.reception-dot').first();
    await firstPoint.waitFor();
    const drawer = page.getByRole('dialog', { name: 'Anime details' });
    const firstTitle = await firstPoint.evaluate(el => el.__data__.title);
    const assertDrawerCover = async title => {
      assert.equal(await drawer.locator('h2').innerText(), title);
      assert.match(await drawer.locator('.detail-cover').getAttribute('src'), /^https:\/\//);
    };
    const chartTop = () => scatter.evaluate(el => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(el.getBoundingClientRect().top)));
    }));
    const restingTop = await chartTop();
    for (const count of [1, 0]) {
      await firstPoint.click();
      assert.equal((await selection()).length, count);
      await assertDrawerCover(firstTitle);
      await drawer.locator('#close-drawer').click();
      assert.ok(Math.abs(await chartTop() - restingTop) < 2, 'point clicks keep the chart in place');
      assert.equal(await page.locator('#tooltip.visible').count(), 0, 'closing details hides the point tooltip');
      assert.deepEqual(await firstPoint.evaluate(el => {
        const style = getComputedStyle(el);
        return [style.outlineStyle, style.filter];
      }), ['none', 'none'], 'pointer selection leaves no focus box or halo');
    }
    await page.keyboard.press('Tab');
    const keyboardPoint = scatter.locator('.reception-dot:focus-visible');
    assert.notEqual(await keyboardPoint.evaluate(el => getComputedStyle(el).filter), 'none');

    const search = page.locator('#movie-search');
    await search.scrollIntoViewIfNeeded();
    for (const movie of ['Interstellar', 'The Matrix']) {
      await search.fill(movie);
      await search.press('Enter');
    }
    assert.equal(await page.locator('#movie-magnets [data-remove-magnet]').count(), 3);

    const geometry = view => view.evaluate(container => [...container.querySelectorAll(
      '.dust-node, .dust-magnet, .dust-selected-link'
    )].map(el => ['transform', 'x1', 'y1', 'x2', 'y2', 'stroke'].map(attr => el.getAttribute(attr))));
    const dragFirstMagnet = async view => {
      const core = view.locator('.magnet-core').first();
      // Center the drag target so the sticky header cannot intercept the pointer.
      await core.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
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

    const grainColors = view => view.locator('.dust-grain').evaluateAll(grains => grains.map(grain => grain.getAttribute('fill')));
    const uniform = await grainColors(field);
    assert.equal(await colorControl.isChecked(), false);
    assert.equal(new Set(uniform).size, 1);
    assert.deepEqual(await grainColors(mirror), uniform);
    await colorControl.press('Space');
    assert.equal(await colorControl.isChecked(), true);
    const grouped = await grainColors(field);
    const winners = await page.evaluate(() => {
      const { displayedDust, activeMagnetKeys } = AnivizMain.snapshot();
      return displayedDust.map(match => AnivizMain.color(activeMagnetKeys[match.closest]));
    });
    assert.equal(new Set(grouped).size, 3);
    assert.deepEqual(grouped, winners);
    assert.deepEqual(await grainColors(mirror), grouped);
    assert.match(await page.locator('#dust-legend').innerText(), /M1.*M2.*M3/s);
    assert.deepEqual(await geometry(field), afterMove);
    assert.deepEqual(await selection(), [firstId]);

    const verifyConnectionColors = async () => {
      await connections.scrollIntoViewIfNeeded();
      await connections.locator('.dust-connection-row').first().waitFor();
      const matchesField = await connections.evaluate(container => {
        const fill = match => getComputedStyle(document.querySelector(
          `#recommendation-chart [data-match-id="${match.key}"] .dust-grain`
        )).fill;
        const rows = [...container.querySelectorAll('.dust-connection-dot')];
        const paths = [...container.querySelectorAll('svg path')];
        return rows.length > 0 && paths.length > 0
          && rows.every(dot => getComputedStyle(dot).backgroundColor === fill(dot.__data__))
          && paths.every(path => getComputedStyle(path).stroke === fill(path.__data__.match));
      });
      assert.ok(matchesField);
    };
    await verifyConnectionColors();
    await page.getByRole('radio', { name: 'Brushing and linking' }).check();
    assert.deepEqual(await grainColors(field), uniform);
    assert.deepEqual(await grainColors(mirror), uniform);
    assert.deepEqual(await page.locator('#dust-legend > span').allTextContents(), ['Dust', 'Brushed', 'Selected']);
    assert.deepEqual(await geometry(field), afterMove);
    assert.deepEqual(await selection(), [firstId]);
    await verifyConnectionColors();

    await scatter.scrollIntoViewIfNeeded();
    await scatter.locator('.reception-dot').first().waitFor();
    assert.match(await page.locator('[data-coverage="reception"]').innerText(), /Circle area: favourites/);
    const layout = await Promise.all([scatter.boundingBox(), mirror.boundingBox()]);
    assert.ok(layout[0].x + layout[0].width < layout[1].x);
    assert.equal(layout[0].height, 473);
    const pair = await page.locator('.dust-reception').boundingBox();
    const connectionBounds = await connections.boundingBox();
    const genres = await page.locator('#content').boundingBox();
    assert.ok(connectionBounds.y + connectionBounds.height < pair.y && pair.y + pair.height < genres.y);
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
    for (const target of targets) {
      const title = await point(target).evaluate(el => el.__data__.title);
      await point(target).click();
      await assertDrawerCover(title);
      await page.keyboard.press('Escape');
      await chartTop();
      assert.equal(await page.locator('#tooltip.visible').count(), 0, 'Escape hides the tooltip with the pointer on the chart');
    }
    const selected = [firstId, ...targets.map(target => target.id)];
    assert.deepEqual(await selection(), selected);
    assert.match(await page.locator('#recommendation-detail').innerText(), /Comparing 3 anime/);
    const rings = scatter.locator('.reception-selection-ring');
    assert.equal(await rings.count(), 3);
    assert.equal(await rings.first().evaluate(el => getComputedStyle(el).strokeDasharray), '2px, 2px');
    const fourthPoint = scatter.locator('.reception-dot[aria-pressed="false"]').first();
    const fourthTitle = await fourthPoint.evaluate(el => el.__data__.title);
    await fourthPoint.press('Enter');
    await assertDrawerCover(fourthTitle);
    await page.keyboard.press('Escape');
    assert.equal(await fourthPoint.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await selection(), selected);
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
    await page.keyboard.press('Escape');
    await point(targets[1]).press('Enter');
    await page.keyboard.press('Escape');
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

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.selectOption('#dust-limit', '90');
    await page.locator('#reset-magnets').click();
    const motion = await field.evaluate(async container => {
      const mirror = document.querySelector('#dust-mirror');
      const dots = view => Array.from(view.querySelectorAll('.dust-node'), dot => dot.getAttribute('transform'));
      const magnet = container.querySelector('.dust-magnet');
      const before = dots(container);
      const anchor = magnet.getAttribute('transform');
      magnet.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      const immediate = dots(container);
      const anchorMoved = magnet.getAttribute('transform') !== anchor;
      const immediateMirror = dots(mirror);
      // Read both views after the animation loop has integrated several frames.
      for (let frame = 0; frame < 6; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
      return { before, immediate, immediateMirror, anchorMoved, after: dots(container), afterMirror: dots(mirror) };
    });
    assert.equal(motion.before.length, 90);
    assert.ok(motion.anchorMoved);
    assert.deepEqual(motion.immediate, motion.before, 'dots lag behind a moving magnet');
    assert.deepEqual(motion.immediateMirror, motion.immediate);
    assert.notDeepEqual(motion.after, motion.before, 'dots follow the magnet on animation frames');
    assert.deepEqual(motion.afterMirror, motion.after);
    assert.deepEqual(await selection(), selected);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#reset-magnets').click();
    const reset = await geometry(field);
    await mirrorMagnet.press('ArrowDown');
    assert.notDeepEqual(await geometry(field), reset);
    await page.locator('#reset-magnets').click();
    assert.deepEqual(await geometry(field), reset, 'reset reproduces the settled reduced-motion geometry');
    assert.deepEqual(await geometry(mirror), reset);

    const hits = await field.evaluate(container => {
      container.scrollIntoView({ block: 'center', behavior: 'instant' });
      return [...container.querySelectorAll('.dust-node')].flatMap(dot => {
        const { x, y, width, height } = dot.querySelector('.dust-grain').getBoundingClientRect();
        const hit = document.elementFromPoint(x + width / 2, y + height / 2);
        return container.contains(hit) ? [hit.closest('.dust-node') === dot] : [];
      });
    });
    assert.ok(hits.length >= 80 && hits.every(Boolean), 'visible dot centers can be clicked through nearby decorations');
    assert.deepEqual(errors, []);
    console.log('Verified scatter styling, shared selection, mirror motion and reset, and desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
