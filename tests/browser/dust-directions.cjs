// Optional real-browser verification. See tests/journey-verification.md for setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { movies: movieDetails } = require('../../data/movie_details.json');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const url = path => new URL(path, base).href;
const forward = 'movie-to-anime', reverse = 'anime-to-movies';

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const field = page.locator('#recommendation-chart');
    const dot = index => field.locator('.dust-node').nth(index);
    const ready = () => dot(0).waitFor();
    const direction = value => page.selectOption('#dust-direction', value);
    const ranking = page.locator('[data-dust-rank-id]');
    const fieldOptions = page.locator('[data-field-options]');
    const evidence = () => page.evaluate(() => {
      const { direction, magnetKeys, displayedKeys, candidateKeys, selectedKeys, rankingSortKey, rankingOrder, filters } = AnivizMain.snapshot();
      return { direction, magnetKeys, displayedKeys, candidateKeys, selectedKeys, rankingSortKey, rankingOrder, filters };
    });
    const positions = () => page.evaluate(() => dustChart.anchors.map(anchor =>
      [(anchor.x / dustChart.width).toFixed(6), (anchor.y / dustChart.height).toFixed(6)]));
    const assertScope = async () => {
      for (const kind of ['connections', 'genres', 'years']) {
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
        return sameKeys(keysAt('#recommendation-chart .dust-node'))
          && sameKeys(keysAt('#dust-mirror .dust-node'))
          && sameKeys(keysAt('.dust-connection-row'))
          && sameKeys(snapshot.ranking.filter(row => row.displayed).map(row => row.key))
          && snapshot.ranking.length === 1000
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
    assert.match(await page.locator('#movie-magnets').innerText(), /Inception.*Example/);
    const inception = await evidence();
    const receptionChart = page.locator('[data-dust-chart="reception"]');
    await receptionChart.scrollIntoViewIfNeeded();
    await receptionChart.locator('svg').waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await direction(reverse);
    assert.equal(await page.locator('[data-anime-chart] svg').count(), 0);
    await ready();
    assert.match(await page.locator('#movie-magnets').innerText(), /Attack on Titan.*Example/);
    const firstFavorite = page.locator('#movie-suggestions button').first();
    assert.equal(await firstFavorite.innerText(), 'Attack on Titan');
    assert.equal(await firstFavorite.getAttribute('aria-pressed'), 'true');
    assert.equal(await ranking.first().innerText(), 'Pacific Rim');
    await dot(0).focus();
    assert.equal(await page.locator('#tooltip .dust-tooltip-score b').textContent(), '0.549');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#dust-focus h3').innerText(), 'Pacific Rim');
    assert.match(await page.locator('#dust-focus').innerText(), /Keywords/);
    const focusScore = page.locator('#dust-focus .dust-detail-scores strong');
    assert.equal(await focusScore.textContent(), '0.549');
    assert.equal(await focusScore.getAttribute('title'), 'Cosine 0.549');
    assert.equal(await focusScore.getAttribute('aria-label'), 'Cosine 0.549');
    assert.equal(await page.locator('#dust-focus a').getAttribute('href'), 'https://www.themoviedb.org/movie/68726');
    const focusPoster = page.getByRole('img', { name: 'Poster for Pacific Rim' });
    await focusPoster.waitFor();
    assert.equal(await focusPoster.getAttribute('src'), `https://image.tmdb.org/t/p/w185${movieDetails['68726'].poster_path}`);

    await page.locator('#movie-search').fill('進撃の巨人 2013');
    await page.locator('#movie-search').press('ArrowDown');
    assert.match(await page.locator('#movie-search-results button:focus').innerText(), /Attack on Titan[\s\S]*2013 · TV/);
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#recommendation-status').innerText(), /already a magnet/);
    await page.locator('#movie-search').fill('No matching show 1973');
    assert.match(await page.locator('#recommendation-status').innerText(), /No anime match/);
    for (const title of ['Steins;Gate', 'Death Note', 'Neon Genesis Evangelion']) {
      await page.locator('#movie-search').fill(title);
      await page.locator('#movie-search').press('Enter');
    }
    assert.match(await page.locator('#recommendation-status').innerText(), /Three magnets/);
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
    const comparedMovies = selected.map(key => movieDetails[key.split(':')[1]]);
    const comparison = page.locator('.dust-comparison-table');
    assert.deepEqual(await comparison.locator('thead img').evaluateAll(images => images.map(img => img.src)),
      comparedMovies.map(movie => `https://image.tmdb.org/t/p/w92${movie.poster_path}`));
    assert.deepEqual(await comparison.getByRole('row', { name: /^Runtime/ }).locator('meter').evaluateAll(meters => meters.map(meter => meter.value)),
      comparedMovies.map(movie => movie.runtime));
    assert.deepEqual(await comparison.getByRole('row', { name: /^TMDB score/ }).locator('meter').evaluateAll(meters => meters.map(meter => [meter.value, meter.max])),
      comparedMovies.map(movie => [movie.vote_average, 10]));
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
    const drawer = page.getByRole('dialog', { name: 'Movie details' });
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
      await page.keyboard.press('Escape');
    }
    await page.selectOption('[data-dust-ranking-order]', 'descending');
    const outside = ranking.first();
    const outsideTitle = await outside.innerText();
    assert.equal(await outside.locator('../..').locator('td').last().innerText(), '—');
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
    const switchWithoutScrolling = value => page.evaluate(direction => {
      const select = document.querySelector('#dust-direction');
      select.value = direction;
      select.dispatchEvent(new Event('change'));
    }, value);
    await switchWithoutScrolling(forward);
    assert.deepEqual(await evidence(), inception);
    await switchWithoutScrolling(reverse);
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
    assert.match(await page.locator('#reception').innerText(), /compare TMDB scores.*archived TMDB popularity snapshot/);
    assert.match(await page.locator('#creators').innerText(), /no production company or cast credits/);
    await page.evaluate(() => {
      sessionStorage.setItem('aniviz-dust-session-v1', JSON.stringify({ version: 1, state: {
        version: 1, movieIds: ['27205'], candidateDustIds: ['1'], displayedDustIds: ['1']
      } }));
    });
    await page.goto(url('frontend/creators/index.html?mode=matches#network-chart'));
    assert.equal(await page.inputValue('#network-scope'), 'catalogue');
    assert.match(await page.locator('#network-dust-note').innerText(), /Current dust is available.*anime/);
    await page.goBack();
    await ready();
    assert.deepEqual(await evidence(), savedReverse);
    await page.goForward();
    assert.equal(await page.inputValue('#network-scope'), 'catalogue');
    await page.goBack();
    await ready();
    await page.reload();
    await ready();
    assert.deepEqual(await evidence(), savedReverse);

    await page.locator(`[data-remove-magnet="${savedReverse.magnetKeys[1]}"]`).click();
    assert.equal((await evidence()).rankingSortKey, 'average');
    for (const key of (await evidence()).magnetKeys) await page.locator(`[data-remove-magnet="${key}"]`).click();
    await direction(forward);
    assert.deepEqual(await evidence(), inception);
    await direction(reverse);
    assert.deepEqual((await evidence()).magnetKeys, []);
    await direction(forward);
    if (!(await fieldOptions.evaluate(node => node.open))) await fieldOptions.locator('summary').click();
    await page.locator('#search-input').fill('No anime matches this string 2562');
    await page.goto(url('frontend/network/index.html?scope=dust'));
    await page.waitForFunction(() => state.networkScopeInfo?.total === 0);
    assert.equal(await page.inputValue('#network-scope'), 'dust');

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
      hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const mobile = await phone.newPage();
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(url(''));
    await mobile.selectOption('#dust-direction', reverse);
    const mobileDot = mobile.locator('#recommendation-chart .dust-node');
    await mobileDot.first().waitFor();
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
    assert.equal(await mobile.inputValue('#dust-direction'), reverse);
    assert.match(await mobile.locator('#recommendation-detail').innerText(), /Comparing 2 movies/);
    const fallback = await browser.newContext({ reducedMotion: 'reduce' });
    await fallback.route('**/data.json', route => route.fulfill({ status: 503 }));
    await fallback.route('**/movie_anime_scores.bin', route => route.fulfill({ status: 503 }));
    const retry = await fallback.newPage();
    retry.on('pageerror', error => errors.push(error.message));
    await retry.goto(url(''));
    await retry.locator('#dust-retry').waitFor();
    await retry.selectOption('#dust-direction', reverse);
    assert.equal(await retry.locator('.dust-node').count(), 0);
    await fallback.unroute('**/movie_anime_scores.bin');
    await retry.locator('#dust-retry').click();
    await retry.locator('.dust-node').first().waitFor();
    assert.equal(await retry.locator('[data-dust-rank-id]').first().innerText(), 'Pacific Rim');
    assert.deepEqual(errors, []);
    console.log('Verified Attack on Titan in both layouts, three-decimal scores, movie charts, ranking drawer, direction sessions and Network fallback.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
