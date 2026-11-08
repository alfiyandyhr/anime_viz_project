// Optional browser regression. See journey-verification.md for Playwright setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(new URL('frontend/dust-magnet/index.html', base).href);
    await page.locator('#recommendation-chart .dust-node').first().waitFor();
    await page.waitForFunction(() => AnivizMain.snapshot().metadataStatus === 'ready');
    await page.locator('#movie-search').fill('Interstellar');
    await page.locator('#movie-search').press('Enter');
    await page.waitForFunction(() => AnivizMain.snapshot().movieIds.length === 2);

    const chart = kind => page.locator(`[data-dust-chart="${kind}"]`);
    const tooltip = page.locator('#tooltip.visible');
    const filters = () => page.evaluate(() => AnivizMain.snapshot().filters);
    const initialFilters = await filters();
    for (const kind of ['reception', 'genres', 'years', 'studios', 'heatmap']) {
      await chart(kind).scrollIntoViewIfNeeded();
      const selectable = kind === 'reception';
      const marks = chart(kind).locator(`svg [role="${selectable ? 'button' : 'img'}"]`);
      await marks.first().waitFor();
      const index = selectable ? 0 : await marks.evaluateAll(nodes => nodes.findIndex(node => node.__data__.count > 0));
      assert.ok(index >= 0);
      const mark = marks.nth(index);
      await mark.focus();
      assert.ok(await mark.getAttribute('aria-label'));
      assert.ok(await tooltip.isVisible());
      assert.equal(await chart(kind).locator('svg title').count(), 0);
      await mark.evaluate(el => el.blur());
      assert.equal(await tooltip.count(), 0);
      if (!selectable) {
        assert.equal(await chart(kind).getByRole('button').count(), 0);
        await mark.dispatchEvent('click');
        await mark.press('Enter');
        assert.deepEqual(await filters(), initialFilters, `${kind} marks leave filters unchanged`);
      }
    }

    const barFills = await chart('genres').locator('rect[role="img"]')
      .evaluateAll(bars => bars.map(bar => getComputedStyle(bar).fill));
    assert.ok(barFills.length > 1);
    assert.equal(new Set(barFills).size, 1);

    const studioMarks = chart('studios').locator('.studio-dot');
    await chart('studios').scrollIntoViewIfNeeded();
    await studioMarks.first().waitFor();
    assert.equal(await page.locator('#creators select').count(), 0);
    assert.deepEqual(await chart('studios').locator('.axis-label').allTextContents(),
      ['Total popularity (log scale)', 'Average score / 100']);
    const { studios, expected } = await studioMarks.evaluateAll(marks => {
      const snapshot = AnivizMain.snapshot();
      const rows = snapshot.displayedDustIds.map(id => snapshot.lookup.get(id).anime);
      const aggregates = AnivizChartData.studios(rows)
        .filter(studio => studio.totalPopularity > 0 && Number.isFinite(studio.averageScore));
      return {
        studios: marks.map(mark => {
          const { studio, count } = mark.__data__;
          const titles = rows.filter(row => row.studio_names.includes(studio));
          return {
            studio, count,
            popularity: titles.reduce((sum, row) => sum + (row.popularity ?? 0), 0),
            score: d3.mean(titles, row => row.average_score),
            x: Number(mark.getAttribute('cx')),
            y: Number(mark.getAttribute('cy')),
            areaPerTitle: Math.PI * Number(mark.getAttribute('r')) ** 2 / count,
            fill: getComputedStyle(mark).fill
          };
        }),
        expected: aggregates.map(studio => studio.studio)
      };
    });
    assert.ok(expected.length > 15);
    assert.deepEqual(studios.map(studio => studio.studio).sort(), expected.sort());
    assert.ok(new Set(studios.map(studio => studio.count)).size > 1);
    assert.ok(studios.every(studio => Math.abs(studio.areaPerTitle - studios[0].areaPerTitle) < 1e-9));
    assert.equal(new Set(studios.map(studio => studio.fill)).size, 1);
    const checkAxis = (value, coordinate, direction) => {
      const sorted = studios.toSorted((a, b) => value(a) - value(b));
      const first = sorted[0], last = sorted.at(-1);
      const slope = (last[coordinate] - first[coordinate]) / (value(last) - value(first));
      assert.ok(direction * slope > 0);
      for (const studio of studios) {
        const position = first[coordinate] + slope * (value(studio) - value(first));
        assert.ok(Math.abs(studio[coordinate] - position) < 1e-6);
      }
    };
    checkAxis(studio => Math.log10(studio.popularity), 'x', 1);
    checkAxis(studio => studio.score, 'y', -1);
    const bubble = studioMarks.last();
    const studio = await bubble.evaluate(mark => mark.__data__);
    await bubble.hover();
    assert.deepEqual((await tooltip.innerText()).trim().split('\n'), [
      studio.studio, `Total popularity: ${studio.totalPopularity.toLocaleString('en-US')}`,
      `Average score: ${studio.averageScore.toFixed(1)}/100`, `Matching titles: ${studio.count}`
    ]);
    for (const kind of ['studios', 'reception']) {
      await chart(kind).scrollIntoViewIfNeeded();
      const value = chart(kind).locator('.chart-correlation');
      await value.waitFor();
      const expected = await chart(kind).evaluate((container, kind) => {
        const studios = kind === 'studios';
        const points = [...container.querySelectorAll(studios ? '.studio-dot' : '.reception-dot')].map(node => {
          const row = node.__data__;
          return [Math.log10(studios ? row.totalPopularity : row.popularity), studios ? row.averageScore : row.average_score];
        });
        return AnivizChartData.correlation(points).toFixed(3);
      }, kind);
      assert.equal(await value.textContent(), `Pearson r = ${expected}`);
      assert.equal(await chart(kind).locator('.chart-trendline').count(), 1);
    }

    await chart('heatmap').scrollIntoViewIfNeeded();
    const heatmapCells = chart('heatmap').locator('rect[role="img"]');
    await heatmapCells.first().waitFor();
    const heatmapStudios = await heatmapCells.evaluateAll(nodes => [...new Set(nodes.map(node => node.__data__.studio))]);
    assert.equal(heatmapStudios.length, 15);

    const rankOrder = page.locator('[data-dust-ranking-order]');
    const rankNote = page.locator('[data-dust-ranking-note]');
    const heading = page.locator('[data-dust-ranking-head] th').first();
    const visibleRanks = () => page.locator('[data-dust-ranking-body] td:first-child').allTextContents();
    const visibleIds = () => page.locator('[data-dust-rank-id]')
      .evaluateAll(titles => titles.map(title => title.dataset.dustRankId));
    const magnet = await page.evaluate(() => AnivizMain.snapshot().movieIds[0]);
    assert.equal(await rankOrder.inputValue(), 'ascending');
    assert.equal((await visibleRanks())[0], '1');
    for (const basis of ['average', magnet]) {
      await page.selectOption('[data-dust-ranking-sort]', basis);
      const rankedIds = await page.evaluate(() => AnivizMain.snapshot().ranking.map(row => String(row.anime.id)));
      await page.getByRole('button', { name: 'Next ranking page' }).click();
      await rankOrder.selectOption('descending');
      assert.equal(await heading.getAttribute('aria-sort'), 'descending');
      assert.equal((await visibleRanks())[0], String(rankedIds.length));
      assert.ok((await rankNote.innerText()).endsWith(`ranks ${rankedIds.length}–${rankedIds.length - 9}`));
      assert.deepEqual(await visibleIds(), rankedIds.slice(-10).reverse());
      await page.getByRole('button', { name: 'Next ranking page' }).click();
      assert.equal((await visibleRanks())[0], String(rankedIds.length - 10));
      assert.deepEqual(await visibleIds(), rankedIds.slice(-20, -10).reverse());
      await rankOrder.selectOption('ascending');
      assert.equal(await heading.getAttribute('aria-sort'), 'ascending');
      assert.deepEqual(await visibleIds(), rankedIds.slice(0, 10));
    }
    console.log('Verified chart tooltips, read-only marks, studio axes and bubble areas, both correlations and trendlines, 15 heatmap studios, and ranking directions.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
