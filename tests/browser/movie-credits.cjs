// Optional browser regression. See journey-verification.md for Playwright setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { movies } = require('../../data/movie_details.json');
const { popularity, vote_average } = require('../../data/movie_popularity.json');
const { movies: recommendations } = require('../../data/movie_recommendations.json');
const { anime } = require('../../data.json');
const { openAnalysisTab } = require('./dust-analysis-tab.cjs');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const movieGenres = new Map(recommendations.map(movie => [String(movie.id), movie.genres]));

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
    async function assertMovieCharts(ids, modes, plot, heatmap) {
      for (const [mode, field, label] of [['movieActors', 'cast', 'Actors'], ['movieWriters', 'writers', 'Writers']]) {
        const credits = new Map();
        for (const id of ids) {
          for (const { id: personId } of movies[id][field]) {
            const key = String(personId);
            if (!credits.has(key)) credits.set(key, new Set());
            credits.get(key).add(id);
          }
        }
        await modes.credit.selectOption(mode);
        await plot.scrollIntoViewIfNeeded();
        const dots = plot.locator('.credit-dot');
        await dots.first().waitFor();
        assert.equal(await plot.locator('svg').getAttribute('aria-label'), `Score vs. popularity · ${label}`);
        assert.deepEqual(await plot.locator('.axis-label').allTextContents(),
          ['Total TMDB popularity score (log scale)', 'TMDB score / 10']);
        const expected = [...credits].flatMap(([personId, works]) => {
          const titles = [...works].sort();
          const scores = titles.map(id => vote_average[id]).filter(Number.isFinite);
          const total = titles.map(id => popularity[id]).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
          return scores.length && total > 0 ? [[personId, titles, scores.reduce((sum, score) => sum + score, 0) / scores.length, total]] : [];
        }).sort();
        const actual = await dots.evaluateAll(nodes => nodes.map(({ __data__: item }) =>
          [item.id, item.ids.slice().sort(), item.score, item.popularity]).sort());
        assert.equal(actual.length, expected.length);
        actual.forEach(([id, titles, score, reach], i) => {
          const [expectedId, expectedTitles, expectedScore, expectedReach] = expected[i];
          assert.equal(id, expectedId);
          assert.deepEqual(titles, expectedTitles);
          assert.ok(Math.abs(score - expectedScore) < 1e-9);
          assert.ok(Math.abs(reach - expectedReach) < 1e-9);
        });

        await modes.heatmap.selectOption(`${mode}:genres`);
        await heatmap.scrollIntoViewIfNeeded();
        const cells = heatmap.locator('rect[role="img"]');
        await cells.first().waitFor();
        const grid = await cells.evaluateAll(nodes => nodes.map(({ __data__: item }) => [item.row.id, item.column.title, item.count]));
        const genres = new Set(ids.flatMap(id => movieGenres.get(id)));
        assert.equal(grid.length, Math.min(15, credits.size) * Math.min(10, genres.size));
        for (const [personId, genre, count] of grid) {
          assert.equal(count, [...credits.get(personId)].filter(id => movieGenres.get(id).includes(genre)).length);
        }
      }
    }
    const dustChartModes = {
      credit: page.locator('[data-dust-movie-credit-mode]'), heatmap: page.locator('[data-dust-movie-heatmap-mode]')
    };
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

    const reception = chart('reception');
    const points = reception.locator('.filmography-dot');
    async function assertFilmography(ids) {
      await openAnalysisTab(page, 'reception');
      await reception.scrollIntoViewIfNeeded();
      await points.first().waitFor();
      assert.deepEqual(await pointIds(points), ids);
    }

    await page.goto(new URL('frontend/dust-magnet/index.html', base).href);
    await field.locator('.dust-node').first().waitFor();
    for (const [dustType, creditsField, creditLabel] of [
      ['movie-actors', 'cast', /Sampled TMDB cast credits/],
      ['movie-writers', 'writers', /TMDB Writing department credits/]
    ]) {
      await type.selectOption(dustType);
      await field.locator('[data-match-id^="tmdb:person:"]').first().waitFor();
      assert.equal(await page.locator('#title-magnet-label').textContent(), 'Anime');
      const groups = await page.evaluate(() => AnivizMain.snapshot().displayedDust.map(({ record }) => record));
      const overlap = (a, b) => a !== b && a.memberIds.some(id => b.memberIds.includes(id));
      const lead = groups.find(a => a.profile_path && groups.some(b => overlap(a, b)));
      assert.ok(lead, `Expected two displayed ${dustType} with a shared title and a portrait`);
      const first = lead.key;
      const partner = groups.find(b => overlap(lead, b));
      const second = partner.key;
      const credits = Object.entries(movies).filter(([, movie]) => movie[creditsField].some(credit => credit.id === lead.id));
      assert.deepEqual([...lead.memberIds].sort(), credits.map(([id]) => id).sort());
      assert.ok(credits.some(([, movie]) => movie[creditsField].some(credit =>
        credit.id === lead.id && credit.profile_path === lead.profile_path)));
      const ids = people => [...new Set(people.flatMap(person => person.memberIds))]
        .filter(id => Number.isFinite(vote_average[id]) && Number.isFinite(popularity[id])).sort();
      const allMovies = ids(groups);
      const selectedMovies = ids([lead, partner]);
      assert.ok(selectedMovies.length > 0 && selectedMovies.length < allMovies.length);
      await openAnalysisTab(page, 'reception');
      for (const plot of [field, page.locator('#dust-mirror')]) {
        for (let step = 0; step < 3; step++) await plot.getByRole('button', { name: 'Zoom in', exact: true }).click();
        const image = plot.locator(`[data-match-id="${first}"] img`);
        assert.equal(await image.getAttribute('src'), `https://image.tmdb.org/t/p/w185${lead.profile_path}`);
        await plot.getByRole('button', { name: 'Reset zoom', exact: true }).click();
      }
      await assertFilmography(allMovies);
      await node(first).press('Enter');
      const focus = page.locator('#dust-focus');
      assert.match(await focus.innerText(), creditLabel);
      const workAttribute = creditsField === 'writers' ? 'data-writer-work' : 'data-actor-work';
      const work = focus.locator(`[${workAttribute}]`).first();
      const movieKey = await work.getAttribute(workAttribute);
      await work.click();
      await assertCredits(drawer, movieKey.split(':').at(-1));
      await page.keyboard.press('Escape');
      await openAnalysisTab(page, 'connections');
      await page.locator('#dust-connection-title').scrollIntoViewIfNeeded();
      await chart('connections').locator(`[data-dust-connection-id$=":${second}"]`).press('Enter');
      await assertFilmography(selectedMovies);
      await pressMoviePoint(reception);
      assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedKeys), [first, second]);
      for (const kind of ['genres', 'years']) {
        await openAnalysisTab(page, kind);
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
      await openAnalysisTab(page, 'studios');
      await assertMovieCharts([...new Set(groups.flatMap(group => group.memberIds))], dustChartModes, chart('studios'), chart('heatmap'));
    }

    await type.selectOption('movie-titles');
    const titleDot = field.locator('.dust-node').first();
    await titleDot.waitFor();
    const movieId = (await titleDot.getAttribute('data-match-id')).split(':').at(-1);
    await titleDot.press('Enter');
    await assertCredits(page.locator('#dust-focus'), movieId);
    const rankButton = page.locator(`[data-dust-rank-id="tmdb:${movieId}"]`);
    await openAnalysisTab(page, 'ranking');
    await rankButton.click();
    await assertCredits(drawer, movieId);
    await page.keyboard.press('Escape');
    await openAnalysisTab(page, 'reception');
    await pressMoviePoint(reception);
    const dustIds = await page.evaluate(() => AnivizMain.snapshot().displayedDust.map(({ record }) => String(record.id)));
    await openAnalysisTab(page, 'studios');
    await assertMovieCharts(dustIds, dustChartModes, chart('studios'), chart('heatmap'));

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
    const catalogueModes = {
      credit: page.locator('#catalogue-movie-credit-mode'), heatmap: page.locator('#catalogue-movie-heatmap-mode')
    };
    assert.deepEqual(await catalogueModes.credit.locator('option').allTextContents(), ['Actors', 'Writers']);
    assert.deepEqual(await catalogueModes.heatmap.locator('option').allTextContents(), ['Actors × genre', 'Writers × genre']);
    const creditPlot = page.locator('[data-catalogue-chart="studios"]');
    const heatmap = page.getByRole('region', { name: 'Movie credit heatmap', exact: true });
    await assertMovieCharts(Object.keys(movies), catalogueModes, creditPlot, heatmap);
    await page.locator('#genre-filter').selectOption('Science Fiction');
    await assertMovieCharts(recommendations.filter(movie => movie.genres.includes('Science Fiction')).map(movie => String(movie.id)),
      catalogueModes, creditPlot, heatmap);
    assert.deepEqual(errors, []);
    console.log('Verified movie credit scatterplots and heatmaps in every dust type and the filtered catalogue, plus portraits and credits.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
