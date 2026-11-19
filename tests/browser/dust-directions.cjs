// Optional real-browser verification. See tests/journey-verification.md for setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { movies, anime } = require('../../data/movie_recommendations.json');
const { popularity, vote_average: ratings } = require('../../data/movie_popularity.json');
const { movies: details } = require('../../data/movie_details.json');
const popularityOrder = movies.map(movie => movie.id)
  .filter(id => Number.isFinite(popularity[id]))
  .sort((a, b) => popularity[b] - popularity[a]);
const matrix = readFileSync(require.resolve('../../data/movie_anime_scores.bin'));
const attackOnTitanColumn = anime.findIndex(record => record.id === '16498');
const reverseRanks = movies.map((movie, row) => ({
  movie, score: matrix.readFloatLE((row * anime.length + attackOnTitanColumn) * 4)
})).sort((a, b) => b.score - a.score);
const { movie: reverseLeader, score: reverseScore } = reverseRanks[0];
const reverseKey = `tmdb:${reverseLeader.id}`;
const leaderScore = reverseScore.toFixed(3);
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const url = path => new URL(path, base).href;
const animeTitles = 'anime-titles', movieTitles = 'movie-titles';

async function assertMagnetSearchFocus(page) {
  const search = page.locator('#movie-search');
  const popup = page.locator('#movie-search-popup');
  const favorites = page.locator('#movie-suggestions button');
  const example = favorites.first();
  const favorite = favorites.nth(1);
  const removals = page.locator('#movie-magnets [data-remove-magnet]');
  const assertSearchInactive = async () => {
    assert.equal(await page.locator('#movie-search:focus').count(), 0);
    assert.equal(await popup.isVisible(), false);
  };

  for (const dustType of [animeTitles, movieTitles]) {
    await page.selectOption('#dust-type', dustType);
    assert.equal(await example.getAttribute('aria-pressed'), 'true');
    await example.click();
    assert.equal(await example.getAttribute('aria-pressed'), 'false');
    assert.equal(await removals.count(), 0);
    await example.press('Space');
    assert.equal(await example.getAttribute('aria-pressed'), 'true');
    assert.equal(await removals.count(), 1);

    await search.click();
    assert.equal(await popup.isVisible(), true);
    await search.press('Escape');
    await favorite.click();
    assert.equal(await favorite.getAttribute('aria-pressed'), 'true');
    await assertSearchInactive();

    await favorite.click();
    assert.equal(await favorite.getAttribute('aria-pressed'), 'false');
    assert.equal(await example.getAttribute('aria-pressed'), 'true');
    assert.equal(await removals.count(), 1);
    await assertSearchInactive();

    await favorite.click();
    await removals.last().press('Enter');
    assert.equal(await favorite.getAttribute('aria-pressed'), 'false');
    await assertSearchInactive();
    assert.equal(await removals.first().evaluate(node => node === document.activeElement), true);
    await removals.first().click();
    assert.equal(await removals.count(), 0);
    await assertSearchInactive();
  }
}

async function assertTitleBrowse(page, noun, records, namespace, touch = false) {
  const search = page.locator('#movie-search');
  const popup = page.locator('#movie-search-popup');
  const results = popup.locator('#movie-search-results');
  const rows = results.locator('button');
  const sidebar = page.locator('.recommendation-picker');
  const filter = page.locator('[data-field-options]');
  await filter.evaluate(node => { node.open = true; });
  await search.scrollIntoViewIfNeeded();
  const geometry = () => sidebar.evaluate(node => ({
    height: node.offsetHeight, scrollHeight: node.scrollHeight,
    filterTop: node.querySelector('[data-field-options]').offsetTop
  }));
  const before = await geometry();
  if (touch) await search.tap();
  else await search.click();
  assert.equal(await rows.count(), records.length);
  assert.match(await popup.innerText(), new RegExp(`All ${noun} · A–Z`));
  assert.deepEqual(await geometry(), before);
  assert.ok(await results.evaluate(node => node.scrollHeight > node.clientHeight));
  assert.ok(await popup.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
      && node.contains(document.elementFromPoint(rect.left + 16, rect.bottom - 8));
  }));
  if (!touch) {
    await search.fill('a');
    assert.ok(await rows.count() > 30 && await rows.count() < records.length);
    assert.deepEqual(await geometry(), before);
    await search.fill('');
    assert.equal(await rows.count(), records.length);
    await search.press('ArrowDown');
    await page.keyboard.press('End');
    assert.equal(await rows.last().evaluate(node => node === document.activeElement), true);
    assert.ok(await results.evaluate(node => node.scrollTop > 0));
    assert.ok((await rows.last().getAttribute('data-magnet-key')).startsWith(`${namespace}:`));
    await page.keyboard.press('Escape');
    assert.equal(await search.evaluate(node => node === document.activeElement), true);
    assert.equal(await popup.isVisible(), false);
    await search.click();
    await search.press('Tab');
  } else {
    await page.getByText('Dust type', { exact: true }).tap();
  }
  assert.equal(await popup.isVisible(), false);
  await filter.evaluate(node => { node.open = false; });
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const pickerPage = await browser.newPage({ reducedMotion: 'reduce' });
    await pickerPage.goto(url('frontend/dust-magnet/'));
    await assertMagnetSearchFocus(pickerPage);
    await pickerPage.close();
    console.log('Verified favorite and removal focus in both directions.');

    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const field = page.locator('#recommendation-chart');
    const dot = index => field.locator('.dust-node').nth(index);
    const ready = () => dot(0).waitFor();
    const dustTypePicker = page.getByRole('combobox', { name: 'Dust type', exact: true });
    const ranking = page.locator('[data-dust-rank-id]');
    const fieldOptions = page.locator('[data-field-options]');
    const evidence = () => page.evaluate(() => {
      const { direction, magnetKeys, displayedKeys, candidateKeys, selectedKeys, rankingSortKey, rankingOrder, filters } = AnivizMain.snapshot();
      return { direction, magnetKeys, displayedKeys, candidateKeys, selectedKeys, rankingSortKey, rankingOrder, filters };
    });
    const positions = () => page.evaluate(() => dustChart.anchors.map(anchor =>
      [(anchor.x / dustChart.width).toFixed(6), (anchor.y / dustChart.height).toFixed(6)]));
    const assertScope = async () => {
      for (const kind of ['connections', 'reception', 'genres', 'years']) {
        const chart = page.locator(`[data-dust-chart="${kind}"]`);
        await chart.scrollIntoViewIfNeeded();
        await chart.locator('svg').first().waitFor();
      }
      const consistent = await page.evaluate(() => {
        const snapshot = AnivizMain.snapshot();
        const displayed = snapshot.displayedDust;
        const sort = keys => [...keys].sort();
        const sameKeys = keys => JSON.stringify(sort(keys)) === JSON.stringify(sort(snapshot.displayedKeys));
        const keysAt = selector => [...document.querySelectorAll(selector)].map(node => node.__data__.key);
        const scored = displayed.filter(({ key }) => AnivizChartData.hasMovieReception(snapshot.lookup.get(key).record));
        const points = [...document.querySelectorAll('.reception-dot')];
        const plotted = points.map(node => `tmdb:${node.__data__.id}`);
        return sameKeys(keysAt('#recommendation-chart .dust-node'))
          && sameKeys(keysAt('#dust-mirror .dust-node'))
          && sameKeys(keysAt('.dust-connection-row'))
          && sameKeys(snapshot.ranking.filter(row => row.displayed).map(row => row.key))
          && snapshot.ranking.length === 1000
          && JSON.stringify(sort(plotted)) === JSON.stringify(sort(scored.map(row => row.key)))
          && points.every((node, index) => {
            const key = plotted[index], { vote_average, popularity_rank } = snapshot.lookup.get(key).record;
            const { closest } = scored.find(row => row.key === key);
            const bounds = node.ownerSVGElement.querySelector('clipPath rect');
            const { x, y, width, height } = bounds.getBBox();
            return node.getAttribute('r') === '5'
              && node.getAttribute('fill') === AnivizMain.color(snapshot.activeMagnetKeys[closest])
              && Math.abs(+node.getAttribute('cx') - (x + (1000 - popularity_rank) / 999 * width)) < .001
              && Math.abs(+node.getAttribute('cy') - (y + (1 - vote_average / 10) * height)) < .001;
          })
          && ['genres', 'years'].every(kind => [...document.querySelectorAll(`[data-dust-chart="${kind}"] [role="img"]`)]
            .every(node => {
              const mark = node.__data__;
              const matches = displayed.filter(row => kind === 'years' ? row.record.year === mark.year : row.record.genres.includes(mark.genre));
              return mark.count === matches.length && mark.selectedCount === matches.filter(row => snapshot.selectedKeys.includes(row.key)).length;
            }));
      });
      assert.ok(consistent, 'field, mirror, connections, ranking flags and chart counts agree');
    };

    await page.goto(url(''));
    await ready();
    assert.deepEqual(await dustTypePicker.locator('option').allTextContents(),
      ['Anime titles', 'Anime studios', 'Anime voice actors', 'Movie titles', 'Movie actors']);
    assert.equal(await dustTypePicker.inputValue(), animeTitles);
    assert.equal(await page.getByRole('radio', { name: 'Movie', exact: true }).isChecked(), true);
    const radioTextStyle = locator => locator.evaluate(node => {
      const { color, fontSize, fontWeight, marginBottom } = getComputedStyle(node);
      return { color, fontSize, fontWeight, marginBottom };
    });
    assert.deepEqual(await radioTextStyle(page.locator('#title-magnet-label')),
      await radioTextStyle(page.locator('#magnet-type label').filter({ hasText: 'Genre cohort' })));
    await page.getByRole('checkbox', { name: 'Color dust by strongest attraction' }).check();
    await ranking.first().locator('img').waitFor();
    assert.match(await ranking.first().locator('img').getAttribute('src'), /^https:\/\/s4\.anilist\.co\//);
    assert.match(await page.locator('#movie-magnets').innerText(), /Inception.*Example/);
    const inception = await evidence();
    await assertTitleBrowse(page, 'movies', movies, 'tmdb');
    await field.locator('.magnet-core').first().click();
    assert.equal(await page.locator('#dust-focus h3').innerText(), 'Inception');
    assert.equal(await page.locator('#dust-focus').getAttribute('aria-label'), 'Movie in focus');
    const magnetPoster = page.getByRole('img', { name: 'Poster for Inception' });
    await magnetPoster.waitFor();
    assert.equal(await magnetPoster.getAttribute('src'), `https://image.tmdb.org/t/p/w185${details['27205'].poster_path}`);
    assert.deepEqual(await evidence(), inception);
    const receptionChart = page.locator('[data-dust-chart="reception"]');
    await receptionChart.scrollIntoViewIfNeeded();
    await receptionChart.locator('svg').waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await dustTypePicker.selectOption(movieTitles);
    assert.equal(await page.getByRole('radio', { name: 'Anime', exact: true }).isChecked(), true);
    assert.equal(await page.locator('[data-anime-chart] svg').count(), 0);
    await ready();
    assert.match(await page.locator('#movie-magnets').innerText(), /Attack on Titan.*Example/);
    const firstFavorite = page.locator('#movie-suggestions button').first();
    assert.equal(await firstFavorite.innerText(), 'Attack on Titan');
    assert.equal(await firstFavorite.getAttribute('aria-pressed'), 'true');
    assert.equal(await ranking.first().innerText(), reverseLeader.title);
    await dot(0).focus();
    assert.equal(await page.locator('#tooltip .dust-tooltip-score b').textContent(), leaderScore);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#dust-focus h3').innerText(), reverseLeader.title);
    const focusPoster = page.getByRole('img', { name: `Poster for ${reverseLeader.title}` });
    await focusPoster.waitFor();
    assert.equal(await focusPoster.getAttribute('src'), `https://image.tmdb.org/t/p/w185${details[reverseLeader.id].poster_path}`);
    assert.equal(await ranking.first().locator('img').getAttribute('src'), `https://image.tmdb.org/t/p/w92${details[reverseLeader.id].poster_path}`);
    const drawer = page.getByRole('dialog', { name: 'Movie details' });
    const posterSrc = (id, size) => `https://image.tmdb.org/t/p/${size}${details[id].poster_path}`;
    const assertDrawerPoster = async key => {
      assert.equal(await drawer.locator('.detail-cover').getAttribute('src'), posterSrc(key.split(':')[1], 'w185'));
    };
    assert.match(await page.locator('#dust-focus').innerText(), /Keywords/);
    const focusScore = page.locator('#dust-focus .dust-detail-scores strong');
    assert.equal(await focusScore.textContent(), leaderScore);
    assert.equal(await focusScore.getAttribute('title'), `Cosine ${leaderScore}`);
    assert.equal(await focusScore.getAttribute('aria-label'), `Cosine ${leaderScore}`);
    assert.equal(await page.locator('#dust-focus a').getAttribute('href'), reverseLeader.url);
    const magnet = field.getByRole('button', { name: /^Attack on Titan magnet/ });
    const core = await magnet.locator('.magnet-core').boundingBox();
    const x = core.x + core.width / 2, y = core.y + core.height / 2;
    const beforeDrag = await positions();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 35, y, { steps: 5 });
    await page.mouse.up();
    assert.notDeepEqual(await positions(), beforeDrag);
    assert.equal(await page.locator('#dust-focus h3').innerText(), reverseLeader.title);
    await magnet.press('Space');
    assert.equal(await page.locator('#dust-focus h3').innerText(), 'Attack on Titan');
    assert.equal(await page.locator('#dust-focus').getAttribute('aria-label'), 'Anime in focus');
    assert.deepEqual((await evidence()).selectedKeys, [reverseKey]);
    await receptionChart.scrollIntoViewIfNeeded();
    const leaderRank = popularityOrder.indexOf(reverseLeader.id) + 1;
    const receptionLabel = `${reverseLeader.title}: TMDB score ${ratings[reverseLeader.id]} / 10; TMDB popularity rank #${leaderRank}; genres ${reverseLeader.genres.join(', ')}`;
    const moviePoint = receptionChart.getByRole('button', { name: receptionLabel, exact: true });
    await moviePoint.waitFor();
    assert.ok(await receptionChart.getByText('TMDB popularity rank', { exact: true }).isVisible());
    await moviePoint.focus();
    assert.ok((await page.locator('#tooltip').innerText()).includes(`TMDB popularity rank: #${leaderRank}`));
    assert.equal(await moviePoint.getAttribute('aria-pressed'), 'true');
    await moviePoint.press('Enter');
    assert.deepEqual((await evidence()).selectedKeys, []);
    await assertDrawerPoster(reverseKey);
    await page.keyboard.press('Escape');
    assert.equal(await moviePoint.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.locator('#tooltip.visible').count(), 0, 'restoring movie point focus leaves its tooltip hidden');
    await moviePoint.press('Space');
    await assertDrawerPoster(reverseKey);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#dust-focus h3').innerText(), reverseLeader.title);
    assert.equal(await receptionChart.locator('.reception-selection-ring').count(), 1);

    await assertTitleBrowse(page, 'anime', anime, 'anilist');
    await page.locator('#movie-search').fill('進撃の巨人 2013');
    await page.locator('#movie-search').press('ArrowDown');
    assert.match(await page.locator('#movie-search-results button:focus').innerText(), /Attack on Titan[\s\S]*2013 · TV/);
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#movie-search-feedback').innerText(), /already a magnet/);
    await page.locator('#movie-search').fill('No matching show 1973');
    assert.match(await page.locator('#movie-search-heading').innerText(), /No anime match/);
    await page.locator('#movie-search').fill('Steins;Gate');
    await page.locator('#movie-search-results button').first().click();
    assert.equal(await page.locator('#movie-search-popup').isVisible(), false);
    for (const title of ['Death Note', 'Neon Genesis Evangelion']) {
      await page.locator('#movie-search').fill(title);
      await page.locator('#movie-search').press('Enter');
    }
    assert.match(await page.locator('#movie-search-feedback').innerText(), /Three magnets/);
    assert.equal((await evidence()).magnetKeys.length, 3);
    assert.equal(await field.locator('.dust-magnet').count(), 3);

    assert.ok(await page.getByLabel('Movie dots').isVisible());
    assert.ok(await page.getByRole('button', { name: 'Reset positions' }).isVisible());
    assert.equal(await page.locator('#filterbar').isVisible(), false);
    for (const budget of [30, 90, 60]) {
      await page.selectOption('#dust-limit', String(budget));
      assert.equal(await field.locator('.dust-node').count(), budget);
    }
    await fieldOptions.locator('summary').click();
    assert.ok(await page.locator('#filterbar').isVisible());
    for (const id of ['studio-filter', 'format-filter', 'score-filter']) assert.equal(await page.locator(`#${id}`).isVisible(), false);
    if ((await evidence()).selectedKeys.length) await page.locator('[data-dust-clear]').click();
    for (let i = 0; i < 4; i++) await dot(i).press('Enter');
    const selected = (await evidence()).selectedKeys;
    assert.equal(selected.length, 3);
    assert.match(await page.locator('[data-dust-notice]').innerText(), /Compare up to 3 movies/);
    assert.match(await page.locator('#recommendation-detail').innerText(), /Comparing 3 movies[\s\S]*Release year[\s\S]*Genres/i);
    const comparison = page.locator('.dust-comparison-table');
    const runtimes = selected.map(key => details[key.split(':')[1]].runtime);
    assert.deepEqual(await comparison.getByRole('row', { name: /^Runtime/ }).locator('meter').evaluateAll(meters => meters.map(meter => [meter.value, meter.max])),
      runtimes.map(runtime => [runtime, Math.max(...runtimes)]));
    assert.deepEqual(await comparison.getByRole('row', { name: /^TMDB score/ }).locator('meter').evaluateAll(meters => meters.map(meter => [meter.value, meter.max])),
      selected.map(key => [ratings[key.split(':')[1]], 10]));
    const colors = () => field.locator('.dust-grain').evaluateAll(nodes => nodes.map(node => node.getAttribute('fill')));
    const beforeResetColors = await colors();
    await page.locator('#reset-magnets').click();
    assert.deepEqual(await colors(), beforeResetColors);
    assert.deepEqual((await evidence()).selectedKeys, selected);
    const originalPositions = await positions();
    await field.locator('.dust-magnet').first().press('ArrowRight');
    assert.notDeepEqual(await positions(), originalPositions);
    const moved = await positions();

    await assertScope();
    const fourthPoint = receptionChart.locator('.reception-dot[aria-pressed="false"]').first();
    const fourthMovieId = await fourthPoint.evaluate(node => node.__data__.id);
    await fourthPoint.press('Enter');
    await assertDrawerPoster(`tmdb:${fourthMovieId}`);
    assert.deepEqual((await evidence()).selectedKeys, selected);
    assert.equal(await fourthPoint.getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('Escape');
    const assertDrawerScores = async key => {
      const expected = await page.evaluate(key =>
        AnivizMain.snapshot().ranking.find(row => row.key === key).scores.map(score => score.toFixed(3)), key);
      const scores = await drawer.locator('.dust-detail-scores strong').evaluateAll(nodes =>
        nodes.map(node => [node.textContent, node.title, node.getAttribute('aria-label')]));
      assert.deepEqual(scores, expected.map(score => [score, `Cosine ${score}`, `Cosine ${score}`]));
    };
    for (const selector of ['[data-dust-connection-id]', '[data-dust-member-id]']) {
      const entry = page.locator(`${selector}[aria-pressed="false"]`).first();
      const key = await entry.evaluate(node => node.__data__.key);
      await entry.click();
      await assertDrawerScores(key);
      await assertDrawerPoster(key);
      await page.keyboard.press('Escape');
    }
    await page.selectOption('[data-dust-ranking-order]', 'descending');
    const outside = ranking.first();
    const outsideTitle = await outside.innerText();
    assert.equal(await outside.locator('../..').locator('td').last().innerText(), '—');
    await outside.locator('../..').locator('td').last().click();
    await assertDrawerPoster(await outside.getAttribute('data-dust-rank-id'));
    await page.keyboard.press('Escape');
    await outside.press('Enter');
    assert.equal(await drawer.locator('h2').innerText(), outsideTitle);
    await assertDrawerScores(await outside.getAttribute('data-dust-rank-id'));
    assert.equal(await drawer.locator('#close-drawer').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await outside.evaluate(node => node === document.activeElement), true);
    assert.deepEqual((await evidence()).selectedKeys, selected);

    await page.selectOption('#genre-filter', 'Science Fiction');
    const narrowed = await evidence();
    assert.ok(narrowed.displayedKeys.length > 0 && narrowed.displayedKeys.length < 60);
    await assertScope();
    await page.locator('#search-input').fill('No movie matches this string 2562');
    assert.equal(await field.locator('.dust-node').count(), 0);
    assert.equal((await evidence()).candidateKeys.length, 60);
    await page.locator('#reset-filters').click();
    assert.equal(await field.locator('.dust-node').count(), 60);
    await page.selectOption('#genre-filter', 'Science Fiction');
    await page.locator('[data-dust-ranking-sort]').selectOption(narrowed.magnetKeys[1]);
    await dot(0).press('Enter');
    const savedReverse = await evidence();
    await page.evaluate(() => scrollTo(0, 620));
    const reverseScroll = await page.evaluate(() => scrollY);
    const switchWithoutScrolling = value => page.evaluate(dustType => {
      const select = document.querySelector('#dust-type');
      select.value = dustType;
      select.dispatchEvent(new Event('change'));
    }, value);
    await switchWithoutScrolling(animeTitles);
    assert.deepEqual(await evidence(), inception);
    await switchWithoutScrolling(movieTitles);
    assert.deepEqual(await evidence(), savedReverse);
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - reverseScroll) < 5);
    assert.deepEqual(await positions(), moved);
    assert.equal(await page.locator('[data-anime-chart] svg').count(), 0);

    for (const anchor of ['content', 'reception', 'creators']) {
      await page.goto(url(`#${anchor}`));
      await ready();
      await page.waitForFunction(id => {
        const top = document.getElementById(id).getBoundingClientRect().top;
        return top >= 48 && top < 180;
      }, anchor);
    }
    assert.match(await page.locator('#reception').innerText(), /Rank #1 is most popular in the movie sample/);
    assert.match(await page.locator('#creators').innerText(), /Movie cast credits appear in the movie details/);
    await page.goto(url('frontend/story/index.html'));
    await page.waitForSelector('#history-pair');
    await page.goBack();
    await ready();
    assert.deepEqual(await evidence(), savedReverse);
    await page.goForward();
    await page.waitForSelector('#history-pair');
    await page.goBack();
    await ready();
    await page.reload();
    await ready();
    assert.deepEqual(await evidence(), savedReverse);

    await page.locator(`[data-remove-magnet="${savedReverse.magnetKeys[1]}"]`).click();
    assert.equal((await evidence()).rankingSortKey, 'average');
    for (const key of (await evidence()).magnetKeys) await page.locator(`[data-remove-magnet="${key}"]`).click();
    await dustTypePicker.selectOption(animeTitles);
    assert.deepEqual(await evidence(), inception);
    await dustTypePicker.selectOption(movieTitles);
    assert.deepEqual((await evidence()).magnetKeys, []);

    await page.goto(url('frontend/explorer/index.html?mode=catalogue'));
    await page.locator('[data-catalogue-target="movie"]').click();
    const catalogueRow = page.locator('#movie-table-body tr').first();
    await catalogueRow.waitFor();
    const catalogueId = await catalogueRow.getAttribute('data-movie-id');
    assert.equal(await catalogueRow.locator('img').getAttribute('src'), posterSrc(catalogueId, 'w92'));
    await catalogueRow.press('Enter');
    assert.equal(await page.locator('#detail-drawer .detail-cover').getAttribute('src'), posterSrc(catalogueId, 'w185'));

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
      hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const mobile = await phone.newPage();
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(url(''));
    await mobile.selectOption('#dust-type', movieTitles);
    const mobileDot = mobile.locator('#recommendation-chart .dust-node');
    await mobileDot.first().waitFor();
    await assertTitleBrowse(mobile, 'anime', anime, 'anilist', true);
    await mobile.locator('#recommendation-chart .magnet-core').first().tap();
    assert.equal(await mobile.locator('#dust-focus h3').innerText(), 'Attack on Titan');
    await mobileDot.nth(0).tap();
    await mobileDot.nth(1).press('Space');
    assert.match(await mobile.locator('#recommendation-detail').innerText(), /Comparing 2 movies/);
    assert.equal(await mobile.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      return box('.recommendation-picker').bottom < box('#recommendation-chart').top
        && box('#recommendation-chart').bottom < box('#dust-focus').top
        && box('#dust-focus').bottom < box('#recommendation-detail').top
        && box('#recommendation-detail').bottom < box('#dust-analysis').top
        && document.documentElement.scrollWidth === innerWidth;
    }), true);
    await mobile.reload();
    await mobileDot.first().waitFor();
    assert.equal(await mobile.inputValue('#dust-type'), movieTitles);
    assert.equal(await mobile.getByRole('radio', { name: 'Anime', exact: true }).isChecked(), true);
    assert.match(await mobile.locator('#recommendation-detail').innerText(), /Comparing 2 movies/);
    const fallback = await browser.newContext({ reducedMotion: 'reduce' });
    await fallback.route('**/data.json', route => route.fulfill({ status: 503 }));
    await fallback.route('**/movie_anime_scores.bin', route => route.fulfill({ status: 503 }));
    const retry = await fallback.newPage();
    retry.on('pageerror', error => errors.push(error.message));
    await retry.goto(url(''));
    await retry.locator('#dust-retry').waitFor();
    await retry.selectOption('#dust-type', movieTitles);
    assert.equal(await retry.locator('.dust-node').count(), 0);
    await fallback.unroute('**/movie_anime_scores.bin');
    await retry.locator('#dust-retry').click();
    await retry.locator('.dust-node').first().waitFor();
    assert.equal(await retry.locator('[data-dust-rank-id]').first().innerText(), reverseLeader.title);
    assert.deepEqual(errors, []);
    console.log('Verified Attack on Titan in both layouts, three-decimal scores, movie charts, ranking drawer and dust type sessions.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
