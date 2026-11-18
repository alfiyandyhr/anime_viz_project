// Optional real-browser verification. See tests/journey-verification.md for setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';
const titles = ['tmdb:27205', 'tmdb:157336', 'tmdb:603'];
const field = page => page.locator('#recommendation-chart');
const dots = page => field(page).locator('.dust-node');
const transforms = (page, selector = '.dust-node') => page.evaluate(selector => {
  const positions = id => {
    const nodes = [...document.querySelectorAll(`#${id} ${selector}`)];
    if (selector === '.dust-magnet') nodes.sort((a, b) => a.__data__.magnet.key.localeCompare(b.__data__.magnet.key));
    return nodes.map(node => node.getAttribute('transform'));
  };
  return [positions('recommendation-chart'), positions('dust-mirror')];
}, selector);
const colors = page => dots(page).locator('.dust-grain').evaluateAll(nodes => nodes.map(node => node.getAttribute('fill')));
const settings = page => page.evaluate(() => [...document.querySelectorAll('[data-magnet-strength]')].map(input =>
  [input.valueAsNumber, input.getAttribute('aria-valuetext'), document.querySelector(`output[for="${input.id}"]`).value]));
const defaultStrength = [1, '1.0 times', '1.0×'];
const defaults = [defaultStrength, defaultStrength, defaultStrength];
const custom = [[0, '0.0 times', '0.0×'], [2, '2.0 times', '2.0×'], defaultStrength];
const evidence = page => page.evaluate(() => {
  const { candidateKeys, displayedKeys, filters, selectedKeys, ranking, rankingSortKey, rankingOrder } = AnivizMain.snapshot();
  return { candidateKeys, displayedKeys, filters, selectedKeys, rankingSortKey, rankingOrder,
    ranking: ranking.map(({ key, scores, rawScores, score, displayed }) => [key, scores, rawScores, score, displayed]) };
});
async function assertCenters(page, count) {
  await field(page).scrollIntoViewIfNeeded();
  const hits = await dots(page).evaluateAll(nodes => nodes.filter(node => {
    const circle = node.querySelector('.dust-hit-area').getBoundingClientRect();
    return document.elementFromPoint(circle.x + circle.width / 2, circle.y + circle.height / 2)?.closest('.dust-node') === node;
  }).length);
  assert.equal(hits, count);
}
async function setup(page, errors) {
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await dots(page).first().waitFor();
  assert.deepEqual(await settings(page), [defaultStrength]);
  await page.evaluate(titles => AnivizMain.setMagnets(titles), titles);
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await setup(page, errors);
    const inception = page.getByRole('slider', { name: 'Inception strength' });
    const interstellar = page.getByRole('slider', { name: 'Interstellar strength' });
    const reset = page.getByRole('button', { name: 'Reset strengths' });
    const color = page.getByLabel('Color dust by strongest attraction');
    const positions = page.getByRole('button', { name: 'Reset positions' });
    assert.deepEqual(await settings(page), defaults);
    assert.equal(await page.getByRole('group', { name: 'Magnet strength', exact: true }).getByRole('slider').count(), 3);
    assert.equal(await color.isChecked(), false);
    for (const count of [30, 90, 60]) {
      await page.selectOption('#dust-limit', String(count));
      await assertCenters(page, count);
    }
    const uncolored = await transforms(page);
    await color.check();
    assert.ok(new Set(await colors(page)).size > 1);
    assert.deepEqual(await transforms(page), uncolored);
    await color.uncheck();
    assert.equal(new Set(await colors(page)).size, 1);
    assert.deepEqual(await transforms(page), uncolored);

    const nearTieIndex = await dots(page).evaluateAll(nodes => nodes.findIndex(node => {
      const [best, next, third] = node.__data__.scores.slice().sort((a, b) => b - a);
      return best - next < .01 && next - third > .03;
    }));
    assert.ok(nearTieIndex >= 0);
    const nearTie = dots(page).nth(nearTieIndex);
    const previewLinks = field(page).locator('.dust-preview-link');
    await nearTie.focus();
    const widths = await previewLinks.evaluateAll(lines =>
      lines.map(line => Number(line.getAttribute('stroke-width'))).sort((a, b) => b - a));
    assert.equal(widths.length, 3);
    assert.ok(widths[0] - widths[1] < .2 && widths[1] - widths[2] > .3);
    await nearTie.press('Escape');
    assert.equal(await previewLinks.count(), 0);
    await nearTie.locator('.dust-hit-area').hover();
    assert.equal(await previewLinks.count(), 3);
    await nearTie.press('Enter');
    assert.equal(await previewLinks.count(), 0);
    assert.equal(await field(page).locator('.dust-selected-link').count(), 3);
    assert.equal(await page.locator('#dust-mirror .dust-selected-link').count(), 3);
    await nearTie.press('Enter');
    await page.mouse.move(0, 0);

    await page.locator('[data-field-options] summary').click();
    await page.selectOption('#genre-filter', 'Action');
    await dots(page).first().press('Enter');
    await page.selectOption('[data-dust-ranking-sort]', titles[1]);
    const before = await evidence(page);
    const beforeTable = await page.locator('[data-dust-ranking-body]').innerText();
    assert.ok(before.displayedKeys.length > 0 && before.displayedKeys.length < 60);
    assert.equal(before.selectedKeys.length, 1);
    const firstDot = dots(page).first();
    const beforeDot = await firstDot.elementHandle();
    const gathered = await transforms(page);
    await inception.press('Home');
    assert.deepEqual((await settings(page))[0], custom[0]);
    const muted = await transforms(page);
    assert.notDeepEqual(muted, gathered);
    assert.deepEqual(...muted);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await transforms(page), muted);
    assert.equal(await field(page).locator('.dust-magnet.is-muted').count(), 1);
    assert.equal(await field(page).locator('.dust-selected-link').count(), 2);
    await interstellar.press('End');
    assert.deepEqual(await settings(page), custom);
    assert.deepEqual(await evidence(page), before);
    assert.equal(await page.locator('[data-dust-ranking-body]').innerText(), beforeTable);
    assert.equal(await firstDot.evaluate((node, prior) => node === prior, beforeDot), true);

    const expectedScores = await firstDot.evaluate(node => node.__data__.scores.map(score => score.toFixed(3)));
    await firstDot.locator('.dust-hit-area').hover();
    for (const score of expectedScores) assert.ok((await page.locator('#tooltip.visible').innerText()).includes(score));
    await page.mouse.move(0, 0);
    await firstDot.focus();
    for (const score of expectedScores) assert.ok((await page.locator('#tooltip.visible').innerText()).includes(score));

    const initialMagnets = await transforms(page, '.dust-magnet');
    await page.locator('#dust-mirror .dust-magnet').filter({ hasText: 'M2' }).press('ArrowRight');
    const movedMagnets = await transforms(page, '.dust-magnet');
    assert.notDeepEqual(movedMagnets, initialMagnets);
    assert.deepEqual(...movedMagnets);
    assert.deepEqual(...await transforms(page));
    await color.check();
    await reset.press('Enter');
    assert.deepEqual(await settings(page), defaults);
    assert.deepEqual(await transforms(page, '.dust-magnet'), movedMagnets);
    assert.deepEqual(await evidence(page), before);
    assert.equal(await color.isChecked(), true);

    await inception.press('Home');
    await interstellar.press('End');
    await positions.click();
    const resetField = await transforms(page);
    await positions.click();
    assert.deepEqual(await transforms(page), resetField);
    assert.deepEqual(await evidence(page), before);
    assert.deepEqual(await settings(page), custom);
    await page.selectOption('#dust-type', 'movie-titles');
    assert.deepEqual(await settings(page), [defaultStrength]);
    await page.selectOption('#dust-type', 'anime-titles');
    await page.reload();
    await dots(page).first().waitFor();
    assert.deepEqual(await settings(page), custom);
    assert.deepEqual(await evidence(page), before);
    assert.equal(await color.isChecked(), true);
    await page.locator('[data-field-options] summary').click();
    await page.locator('#reset-filters').click();
    assert.equal(await dots(page).count(), 60);
    assert.deepEqual(await settings(page), custom);
    await page.evaluate(() => AnivizMain.setMagnets([]));
    assert.deepEqual(await settings(page), []);
    assert.equal(await page.locator('.dust-motion-controls').isHidden(), true);

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await setup(phone, errors);
    await phone.getByRole('slider', { name: 'Inception strength' }).press('Home');
    await phone.getByRole('slider', { name: 'Interstellar strength' }).press('End');
    for (const count of [30, 60, 90]) {
      await phone.selectOption('#dust-limit', String(count));
      await assertCenters(phone, count);
    }
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth === innerWidth), true);
    const narrowPositions = await transforms(phone);
    await phone.getByLabel('Color dust by strongest attraction').check();
    assert.deepEqual(await transforms(phone), narrowPositions);

    const animated = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await setup(animated, errors);
    const transition = await animated.evaluate(() => {
      const state = () => [...dustChart.positions.values()].map(({ x, y, vx, vy }) => [x, y, vx, vy]);
      const input = document.querySelector('#dust-magnet-strength-1');
      const before = state();
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const after = state();
      return new Promise(resolve => requestAnimationFrame(() => {
        const moved = state();
        const maxTravel = Math.max(...moved.map(([x, y], i) => Math.hypot(x - before[i][0], y - before[i][1])));
        resolve({ before, after, maxTravel });
      }));
    });
    assert.deepEqual(transition.before, transition.after);
    assert.ok(transition.maxTravel > 0 && transition.maxTravel <= 4.84, transition.maxTravel);
    assert.deepEqual(...await transforms(animated));
    const magnet = field(animated).locator('.dust-magnet:not(.is-muted) .magnet-core').first();
    const box = await magnet.boundingBox();
    const oldAnchors = await transforms(animated, '.dust-magnet');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await animated.mouse.move(x, y);
    await animated.mouse.down();
    await animated.mouse.move(x + 60, y + 20, { steps: 6 });
    await animated.mouse.up();
    const movedAnchors = await transforms(animated, '.dust-magnet');
    assert.notDeepEqual(movedAnchors, oldAnchors);
    assert.deepEqual(...movedAnchors);
    assert.deepEqual(...await transforms(animated));
    assert.deepEqual(errors, []);
    console.log('Verified motion controls, score evidence, independent resets, reduced motion, the mirror, and desktop/mobile hit testing.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
