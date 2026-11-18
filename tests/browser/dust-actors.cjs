// Optional browser regression. See journey-verification.md for Playwright setup.
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
    const chart = kind => page.locator(`[data-dust-chart="${kind}"]`);
    await field.locator('.dust-node').first().waitFor();
    await page.locator('#dust-type').selectOption('anime-voice-actors');
    await field.locator('[data-match-id^="anilist:staff:"]').first().waitFor();

    const { first, second, filmography, selected, portrait } = await page.evaluate(() => {
      const { displayedDust, titleLookup } = AnivizMain.snapshot();
      const groups = displayedDust.map(match => match.record);
      const sharesTitle = (first, second) => first !== second && first.memberIds.some(id => second.memberIds.includes(id));
      const first = groups.find(group => group.image && group.memberIds.length > 1
        && groups.some(other => sharesTitle(group, other)));
      if (!first) throw new Error('Expected two displayed voice actors with a shared title');
      const second = groups.find(group => sharesTitle(first, group));
      const receptionIds = groups => [...new Set(groups.flatMap(group => group.memberIds))].filter(id => {
        const anime = titleLookup.get(`anilist:${id}`).record;
        return anime.popularity > 0 && Number.isFinite(anime.average_score);
      }).sort();
      return {
        first: first.key, second: second.key, portrait: first.image,
        filmography: receptionIds(groups), selected: receptionIds([first, second])
      };
    });
    const actor = field.locator(`[data-match-id="${first}"]`);
    const zoom = field.getByRole('button', { name: 'Zoom in', exact: true });
    for (let step = 0; step < 3; step++) await zoom.click();
    assert.equal(await actor.locator('img').getAttribute('src'), portrait);
    await field.getByRole('button', { name: 'Reset zoom', exact: true }).click();
    await actor.press('Enter');
    assert.match(await page.locator('#dust-focus').innerText(), /Japanese main-role credits/);
    await chart('connections').locator(`[data-dust-connection-id$=":${second}"]`).press('Enter');
    assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedKeys), [first, second]);

    const reception = chart('reception');
    await reception.scrollIntoViewIfNeeded();
    const dots = reception.locator('.reception-dot');
    const rings = reception.locator('.reception-selection-ring');
    const ids = locator => locator.evaluateAll(nodes => nodes.map(node => node.__data__.id).sort());
    await rings.first().waitFor();
    assert.deepEqual(await ids(dots), filmography);
    assert.deepEqual(await ids(rings), selected);
    await dots.first().press('Enter');
    assert.equal(await page.locator('#detail-drawer').getAttribute('aria-label'), 'Anime details');
    assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedKeys), [first, second]);
    await page.keyboard.press('Escape');

    for (const kind of ['genres', 'years', 'studios', 'heatmap']) {
      const plot = chart(kind);
      await plot.scrollIntoViewIfNeeded();
      const marks = plot.locator('[role="img"][tabindex="0"]');
      await marks.first().waitFor();
      assert.ok(await marks.evaluateAll(nodes => nodes.some(node =>
        node.__data__.selectedCount > 0 && node.getAttribute('stroke') === 'white')), kind);
    }
    await actor.press('Enter');
    assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedKeys), [second]);
    assert.deepEqual(errors, []);
    console.log('Voice actor portraits, connections, selection rings and chart highlights passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
