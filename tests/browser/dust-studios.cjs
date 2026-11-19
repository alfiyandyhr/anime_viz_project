// Optional browser regression. See journey-verification.md for Playwright setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const dustUrl = new URL('frontend/dust-magnet/index.html', base).href;

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const chart = kind => page.locator(`[data-dust-chart="${kind}"]`);
    const dot = (key, root = '#recommendation-chart') => page.locator(`${root} [data-match-id="${key}"]`);
    const selection = () => page.evaluate(() => AnivizMain.snapshot().selectedKeys);
    const waitForDust = () => page.locator('#recommendation-chart .dust-node').first().waitFor();
    await page.goto(dustUrl);
    await waitForDust();
    const picker = page.locator('#dust-type');
    await picker.selectOption('anime-studios');
    await waitForDust();
    assert.equal(await page.locator('#studio-minimum').count(), 0);
    assert.match(await page.locator('#movie-magnets').innerText(), /Inception/);

    const { pair, displayed, fullScope, titleScope } = await page.evaluate(() => {
      const { displayedDust, displayedKeys, supportingIds } = AnivizMain.snapshot();
      const groups = displayedDust.map(match => match.record);
      for (const [index, first] of groups.entries()) {
        const second = groups.slice(index + 1).find(group => group.memberIds.some(id => first.memberIds.includes(id)));
        if (second) return { pair: [first.key, second.key], displayed: displayedKeys,
          fullScope: supportingIds.length, titleScope: [...new Set([...first.memberIds, ...second.memberIds])] };
      }
      throw new Error('Expected two displayed studios with a shared title');
    });
    const reception = chart('reception');
    const marks = reception.locator('.reception-dot');
    await reception.scrollIntoViewIfNeeded();
    await marks.first().waitFor();
    assert.ok(await marks.evaluateAll(nodes => nodes.every(node => node.getAttribute('stroke-width') === '1')));
    const filled = reception.locator('.reception-dot[fill="var(--purple)"]').first();
    assert.ok(await filled.evaluate(node =>
      getComputedStyle(node).fill === d3.color(getComputedStyle(node).getPropertyValue('--purple').trim()).formatRgb()));

    await dot(pair[0]).press('Enter');
    assert.match(await page.locator('#dust-focus').innerText(), /catalogue anime scored/);
    assert.ok(await page.locator('#dust-focus [data-studio-work]').count());
    await dot(pair[1], '#dust-mirror').press('Space');
    assert.deepEqual(await selection(), pair);
    assert.match(await page.locator('#recommendation-detail').innerText(), /Comparing 2 studios/);
    assert.equal(await page.getByRole('rowheader', { name: 'AniList users', exact: true }).count(), 1);
    assert.equal(await page.locator('#recommendation-chart .dust-node').count(), displayed.length);
    assert.match(await page.locator('#dust-studio-scope').innerText(), new RegExp(`${titleScope.length} distinct catalogue anime`));

    await reception.scrollIntoViewIfNeeded();
    await marks.first().waitFor();
    const expectedMarks = await page.evaluate(ids => {
      const { titleLookup } = AnivizMain.snapshot();
      return ids.filter(id => {
        const record = titleLookup.get(`anilist:${id}`).record;
        return record.popularity > 0 && Number.isFinite(record.average_score);
      }).sort();
    }, titleScope);
    assert.deepEqual(await marks.evaluateAll(nodes => nodes.map(node => node.__data__.id).sort()), expectedMarks);
    assert.ok(await marks.evaluateAll(nodes => nodes.every(node => node.getAttribute('stroke-width') === '1')));
    assert.equal(await reception.locator('.reception-selection-ring').count(), 0);
    await marks.first().press('Enter');
    assert.equal(await page.locator('#detail-drawer').getAttribute('aria-label'), 'Anime details');
    assert.deepEqual(await selection(), pair);
    await page.keyboard.press('Escape');

    for (const kind of ['genres', 'years']) {
      await chart(kind).scrollIntoViewIfNeeded();
      const bars = chart(kind).locator('rect[role="img"]');
      await bars.first().waitFor();
      assert.ok(await bars.evaluateAll((nodes, ids) => {
        const { titleLookup } = AnivizMain.snapshot();
        const works = ids.map(id => titleLookup.get(`anilist:${id}`).record);
        return nodes.every(node => {
          const { count, year, genre } = node.__data__;
          return works.filter(record => genre ? record.genres.includes(genre) : record.year === year).length === count;
        });
      }, titleScope));
    }
    const heatmap = chart('heatmap');
    await heatmap.scrollIntoViewIfNeeded();
    const tiles = heatmap.locator('rect[role="img"]');
    await tiles.first().waitFor();
    assert.ok(await tiles.evaluateAll((nodes, keys) => {
      const { lookup, titleLookup } = AnivizMain.snapshot();
      const rows = new Set();
      const correctCounts = nodes.every(node => {
        const { studioKey, genre, count } = node.__data__;
        rows.add(studioKey);
        return lookup.get(studioKey).record.memberIds
          .filter(id => titleLookup.get(`anilist:${id}`).record.genres.includes(genre)).length === count;
      });
      return correctCounts && rows.size === keys.length && keys.every(key => rows.has(key));
    }, pair));
    await chart('studios').scrollIntoViewIfNeeded();
    await chart('studios').locator('.studio-dot').first().waitFor();
    assert.deepEqual(await chart('studios').locator('.axis-label').allTextContents(),
      ['Total popularity (log scale)', 'Average score / 100']);

    const extra = displayed.filter(key => !pair.includes(key));
    const connection = chart('connections').locator(`[data-dust-connection-id$=":${extra[0]}"]`);
    await chart('connections').scrollIntoViewIfNeeded();
    await connection.press('Enter');
    await dot(extra[1]).press('Enter');
    assert.deepEqual(await selection(), [...pair, extra[0]]);
    assert.match(await page.locator('[data-dust-notice]').innerText(), /Compare up to 3 studios/);
    await page.locator('[data-dust-clear]').click();
    assert.match(await page.locator('#dust-studio-scope').innerText(), new RegExp(`${fullScope} distinct catalogue anime`));

    const rank = page.locator('[data-dust-rank-id]').first();
    await rank.click();
    assert.equal(await page.locator('#detail-drawer').getAttribute('aria-label'), 'Studio details');
    const work = page.locator('#detail-drawer [data-studio-work]').first();
    await work.click();
    assert.equal(await page.locator('#detail-drawer').getAttribute('aria-label'), 'Anime details');
    await page.keyboard.press('Escape');
    assert.ok(await rank.evaluate(node => node === document.activeElement));
    assert.deepEqual(await selection(), []);

    await dot(pair[0]).press('Enter');
    await dot(pair[1]).press('Enter');
    await picker.selectOption('anime-titles');
    await waitForDust();
    assert.deepEqual(await selection(), []);
    await picker.selectOption('anime-studios');
    await waitForDust();
    assert.deepEqual(await selection(), pair);
    await page.reload();
    await waitForDust();
    assert.deepEqual(await selection(), pair);
    assert.equal(await picker.inputValue(), 'anime-studios');

    await page.goto(new URL('frontend/explorer/index.html?mode=catalogue', base).href);
    const catalogueChart = page.locator('[data-catalogue-chart="studios"]');
    await catalogueChart.scrollIntoViewIfNeeded();
    const catalogueBubbles = catalogueChart.locator('.studio-dot');
    await catalogueBubbles.first().waitFor();
    const leaders = await catalogueBubbles.evaluateAll(nodes => {
      const studios = nodes.map(node => node.__data__);
      return ['totalPopularity', 'averageScore'].map(field => studios.reduce((a, b) => a[field] >= b[field] ? a : b));
    });
    assert.deepEqual(leaders.map(studio => studio.studio), ['A-1 Pictures', 'TOHO animation STUDIO']);
    await page.goto(dustUrl);
    await waitForDust();
    for (const [index, kind] of ['popularity', 'score'].entries()) {
      await page.locator('[data-remove-magnet]').click();
      await page.locator(`#magnet-type input[value="${kind}"]`).check();
      await page.locator(`#add-${kind}-magnet`).click();
      await waitForDust();
      const { key, studio, totalPopularity, averageScore, count } = leaders[index];
      assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().activeMagnetKeys), [`anilist:${kind}`]);
      assert.equal((await page.locator('[data-dust-rank-id]').first().innerText()).trim(), studio);
      assert.equal(await page.locator('[data-dust-ranking-head] th:nth-last-child(2)').textContent(), 'Anime counts');
      assert.equal(await page.locator('[data-dust-ranking-body] tr').first().locator('td:nth-last-child(2)').textContent(), String(count));
      assert.equal(await dot(key).count(), 1);
      const circles = chart('studios').locator('.studio-dot');
      await chart('studios').scrollIntoViewIfNeeded();
      await circles.first().waitFor();
      assert.deepEqual(await circles.evaluateAll((nodes, key) => {
        const { popularity, score } = nodes.find(node => node.__data__.key === key).__data__;
        return [popularity, score];
      }, key), [totalPopularity, averageScore]);
      await chart('connections').scrollIntoViewIfNeeded();
      assert.equal(await chart('connections').locator('.dust-connection-rank').first().innerText(), '1');
      assert.equal(await chart('connections').locator('.dust-connection-title').first().innerText(), studio);
      const members = chart('connections').getByRole('table', { name: `Dust members for ${kind === 'score' ? 'Score' : 'Popularity'}` });
      assert.deepEqual(await members.locator('thead th').allTextContents(),
        ['Rank', 'Studio', kind === 'score' ? 'Average score' : 'AniList users', 'Attraction percentile', 'Title counts']);
      const cells = await members.locator('tbody tr').first().locator('td').allTextContents();
      assert.match(cells[3], /^\d\.\d{3}$/);
      assert.equal(cells[4], String(count));
    }
    assert.deepEqual(errors, []);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      reducedMotion: 'reduce' });
    await mobile.route('**/data.json', route => route.abort());
    await mobile.goto(dustUrl);
    await mobile.locator('#dust-type').selectOption('anime-studios');
    await mobile.locator('#studio-credits-retry').waitFor();
    await mobile.unroute('**/data.json');
    await mobile.locator('#studio-credits-retry').tap();
    const studio = mobile.locator('#recommendation-chart .dust-node').first();
    await studio.waitFor();
    await studio.press('Enter');
    assert.match(await mobile.locator('#dust-studio-scope').innerText(), /Selected studios/);
    console.log('Verified catalogue metric parity, studio selection, chart scopes, comparison, restore, and mobile metadata retry.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
