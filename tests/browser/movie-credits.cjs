// Optional browser regression. See journey-verification.md for Playwright setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { movies } = require('../../data/movie_details.json');
const { anime } = require('../../data.json');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const field = page.locator('#recommendation-chart');
    const drawer = page.locator('#detail-drawer');
    const chart = kind => page.locator(`[data-dust-chart="${kind}"]`);
    const type = page.locator('#dust-type');
    const node = key => field.locator(`[data-match-id="${key}"]`);
    const pointIds = points => points.evaluateAll(nodes => nodes.map(dot => String(dot.__data__.id)).sort());
    async function assertCredits(panel, movieId) {
      const { cast, writers } = movies[movieId];
      const credits = panel.locator('.movie-credits');
      const labels = (people, role) => people.map(person => person.name
        + (person[role].length ? ` — ${person[role].join(', ')}` : ''));
      assert.deepEqual(await credits.getByRole('heading').allTextContents(), ['Cast', 'Writers']);
      assert.deepEqual(await credits.locator('section').nth(0).locator('li').allTextContents(), labels(cast, 'characters'));
      assert.deepEqual(await credits.locator('section').nth(1).locator('li').allTextContents(), labels(writers, 'jobs'));
    }
    async function pressMoviePoint(plot) {
      await plot.scrollIntoViewIfNeeded();
      const dots = plot.locator('.reception-dot');
      await dots.first().waitFor();
      const ids = await pointIds(dots);
      const movieId = ids.find(id => movies[id].cast.length && movies[id].writers.length);
      assert.ok(movieId);
      const index = await dots.evaluateAll((nodes, id) => nodes.findIndex(dot => String(dot.__data__.id) === id), movieId);
      await dots.nth(index).press('Enter');
      await assertCredits(drawer, movieId);
      await page.keyboard.press('Escape');
    }

    await page.goto(new URL('frontend/dust-magnet/index.html', base).href);
    await field.locator('.dust-node').first().waitFor();
    await type.selectOption('movie-actors');
    await field.locator('[data-match-id^="tmdb:person:"]').first().waitFor();
    assert.equal(await page.locator('#title-magnet-label').textContent(), 'Anime');
    const { first, second, allMovies, selectedMovies, portrait } = await page.evaluate(() => {
      const { displayedDust, titleLookup } = AnivizMain.snapshot();
      const groups = displayedDust.map(({ record }) => record);
      const overlap = (a, b) => a !== b && a.memberIds.some(id => b.memberIds.includes(id));
      const first = groups.find(a => a.profile_path && groups.some(b => overlap(a, b)));
      const second = groups.find(b => overlap(first, b));
      const ids = actors => [...new Set(actors.flatMap(actor => actor.memberIds))]
        .filter(id => AnivizChartData.hasMovieReception(titleLookup.get(`tmdb:${id}`).record)).sort();
      return { first: first.key, second: second.key, allMovies: ids(groups),
        selectedMovies: ids([first, second]), portrait: first.profile_path };
    });
    for (const plot of [field, page.locator('#dust-mirror')]) {
      for (let step = 0; step < 3; step++) await plot.getByRole('button', { name: 'Zoom in', exact: true }).click();
      const image = plot.locator(`[data-match-id="${first}"] img`);
      assert.equal(await image.getAttribute('src'), `https://image.tmdb.org/t/p/w185${portrait}`);
      await plot.getByRole('button', { name: 'Reset zoom', exact: true }).click();
    }
    const reception = chart('reception');
    const points = reception.locator('.filmography-dot');
    async function assertFilmography(ids) {
      await reception.scrollIntoViewIfNeeded();
      await points.first().waitFor();
      assert.deepEqual(await pointIds(points), ids);
    }
    await assertFilmography(allMovies);
    await node(first).press('Enter');
    assert.match(await page.locator('#dust-focus').innerText(), /Sampled TMDB cast credits/);
    await chart('connections').locator(`[data-dust-connection-id$=":${second}"]`).press('Enter');
    await assertFilmography(selectedMovies);
    await pressMoviePoint(reception);
    assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedKeys), [first, second]);
    for (const kind of ['genres', 'years']) {
      const plot = chart(kind);
      await plot.scrollIntoViewIfNeeded();
      const marks = plot.locator('[role="img"][tabindex="0"]');
      await marks.first().waitFor();
      assert.ok(await marks.evaluateAll(nodes => nodes.some(mark =>
        mark.__data__.selectedCount > 0 && mark.getAttribute('stroke') === 'var(--text)')), kind);
    }
    await node(first).press('Enter');
    await node(second).press('Enter');
    await assertFilmography(allMovies);

    await type.selectOption('movie-titles');
    const titleDot = field.locator('.dust-node').first();
    await titleDot.waitFor();
    const movieId = (await titleDot.getAttribute('data-match-id')).split(':').at(-1);
    await titleDot.press('Enter');
    await assertCredits(page.locator('#dust-focus'), movieId);
    const rankButton = page.locator(`[data-dust-rank-id="tmdb:${movieId}"]`);
    await rankButton.click();
    await assertCredits(drawer, movieId);
    await page.keyboard.press('Escape');
    await pressMoviePoint(reception);

    await page.goto(new URL('frontend/explorer/index.html', base).href);
    const summary = page.locator('#catalogue-kpis');
    async function assertKpi(label, value) {
      const card = summary.locator('.kpi-card').filter({ hasText: label });
      await card.waitFor();
      assert.equal(await card.locator('strong').textContent(), value.toLocaleString('en-US'));
    }
    await assertKpi('Genres represented', new Set(anime.flatMap(title => title.genres)).size);
    await page.locator('[data-catalogue-target="movie"]').click();
    for (const [label, field] of [['actor', 'cast'], ['writer', 'writers']]) {
      const credits = new Map();
      for (const movie of Object.values(movies)) {
        for (const { id, name } of movie[field]) {
          if (!credits.has(id)) credits.set(id, { name, titles: 0 });
          credits.get(id).titles++;
        }
      }
      await assertKpi(`${label[0].toUpperCase()}${label.slice(1)}s represented`, credits.size);
      const max = Math.max(...[...credits.values()].map(person => person.titles));
      const leaders = [...credits.values()].filter(person => person.titles === max);
      const fact = page.locator('.insight-card').filter({ hasText: `Most represented ${label}` });
      assert.match(await fact.innerText(), new RegExp(`${max} matching movies`));
      if (leaders.length <= 2) {
        for (const { name } of leaders) assert.ok((await fact.innerText()).includes(name));
      }
    }
    const rows = page.locator('#movie-table-body tr[data-movie-id]');
    const row = rows.first();
    await row.waitFor();
    const rowId = await row.getAttribute('data-movie-id');
    await row.locator('.anime-cell').click();
    await assertCredits(drawer, rowId);
    await page.keyboard.press('Escape');
    await pressMoviePoint(page.locator('[data-catalogue-chart="reception"]'));
    assert.deepEqual(errors, []);
    console.log('Verified movie actor portraits, linked chart filtering, catalogue counts, and movie credits across entry points.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
