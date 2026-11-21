// Optional browser regression. See journey-verification.md for Playwright setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { openAnalysisTab } = require('./dust-analysis-tab.cjs');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';

async function verifyCredits(browser, dustType, creditLabel) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const creators = dustType === 'anime-original-creators';
    if (creators) {
      await page.route('**/data/anime_credits.json', route => route.fulfill({ status: 503 }), { times: 1 });
    }
    await page.goto(new URL('frontend/dust-magnet/index.html', base).href);
    const field = page.locator('#recommendation-chart');
    const chart = kind => page.locator(`[data-dust-chart="${kind}"]`);
    await field.locator('.dust-node').first().waitFor();
    await page.getByRole('radio', { name: 'Brushing and linking' }).check();
    await page.locator('#dust-type').selectOption(dustType);
    if (creators) await field.getByRole('button', { name: 'Retry original creator credits' }).click();
    await field.locator('[data-match-id^="anilist:staff:"]').first().waitFor();

    const { first, second, filmography, selected, portrait } = await page.evaluate(() => {
      const { displayedDust, titleLookup } = AnivizMain.snapshot();
      const groups = displayedDust.map(match => match.record);
      const sharesTitle = (first, second) => first !== second && first.memberIds.some(id => second.memberIds.includes(id));
      const first = groups.find(group => group.image && group.memberIds.length > 1
        && groups.some(other => sharesTitle(group, other)));
      if (!first) throw new Error('Expected two displayed people with a shared title');
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

    const reception = chart('reception');
    const dots = reception.locator('.reception-dot');
    const ids = locator => locator.evaluateAll(nodes => nodes.map(node => node.__data__.id).sort());
    await openAnalysisTab(page, 'reception');
    await reception.scrollIntoViewIfNeeded();
    await dots.first().waitFor();
    assert.deepEqual(await ids(dots), filmography);

    await actor.press('Enter');
    const focus = page.locator('#dust-focus');
    assert.match(await focus.innerText(), creditLabel);
    assert.equal(await focus.locator('img').getAttribute('src'), portrait);
    if (creators) {
      await focus.locator('[data-creator-work]').first().click();
      assert.equal(await page.locator('#detail-drawer').getAttribute('aria-label'), 'Anime details');
      await page.keyboard.press('Escape');
    }
    const connections = chart('connections');
    await openAnalysisTab(page, 'connections');
    await connections.scrollIntoViewIfNeeded();
    await connections.locator(`[data-dust-connection-id$=":${second}"]`).press('Enter');
    assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedKeys), [first, second]);

    await openAnalysisTab(page, 'reception');
    await reception.scrollIntoViewIfNeeded();
    await dots.first().waitFor();
    assert.deepEqual(await ids(dots), selected);
    assert.ok(await dots.evaluateAll(nodes => {
      const brushedIds = new Set([...document.querySelectorAll('#recommendation-chart .dust-grain[fill="var(--pink)"]')]
        .flatMap(grain => grain.__data__.record.memberIds));
      return nodes.every(node => {
        const expected = brushedIds.has(node.__data__.id) ? 'var(--pink)' : 'var(--dust-uniform)';
        return node.__data__.favourites > 0 ? node.getAttribute('fill') === expected
          : node.getAttribute('fill') === 'transparent' && node.getAttribute('stroke') === expected;
      });
    }));
    assert.deepEqual(await ids(reception.locator('.reception-dot[stroke-width="1"]')), selected);
    assert.equal(await reception.locator('.reception-selection-ring').count(), 0);
    await dots.first().press('Enter');
    assert.equal(await page.locator('#detail-drawer').getAttribute('aria-label'), 'Anime details');
    assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedKeys), [first, second]);
    await page.keyboard.press('Escape');

    for (const kind of ['genres', 'years', 'studios', 'heatmap']) {
      await openAnalysisTab(page, kind);
      const plot = chart(kind);
      await plot.scrollIntoViewIfNeeded();
      const marks = plot.locator('[role="img"][tabindex="0"]');
      await marks.first().waitFor();
      assert.ok(await marks.evaluateAll((nodes, kind) => nodes.some(node =>
        node.__data__.selectedCount > 0 && node.getAttribute('stroke') === 'var(--text)'
        && node.getAttribute('stroke-width') === (kind === 'studios' ? '3' : '2')), kind), kind);
    }
    await actor.press('Enter');
    assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedKeys), [second]);
    await field.locator(`[data-match-id="${second}"]`).press('Enter');
    await openAnalysisTab(page, 'reception');
    await reception.scrollIntoViewIfNeeded();
    await dots.first().waitFor();
    assert.deepEqual(await ids(dots), filmography);
    assert.deepEqual(errors, []);
    console.log(`Verified ${dustType} portraits, connections, scatterplot filtering and highlights in the other charts.`);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    await verifyCredits(browser, 'anime-voice-actors', /Japanese main-role credits/);
    await verifyCredits(browser, 'anime-original-creators', /AniList original creator credits/);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
