// Run with the same external Playwright setup as tests/browser/verify.cjs.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = (process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const formatSpan = span => `${span} ${span === 1 ? 'year' : 'years'}`;

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('frontend/story/index.html', base).href);
    assert.equal(await page.locator('#history-match-span > summary').innerText(), 'Match year span');
    await page.locator('#history-match-span > summary').click();
    await page.locator('.history-span-genres > summary').click();
    for (const direction of ['anime', 'movie']) {
      await page.locator(`label:has([name="history-span-direction"][value="${direction}"])`).click();
      await page.waitForFunction(direction =>
        document.querySelector('#history-match-span').dataset.direction === direction, direction);
      for (const year of ['2000', '2010', '2024']) {
        await page.selectOption('#history-span-year', year);
        const matches = await page.locator('.history-span-genres tbody tr').evaluateAll(rows => rows.map(row => ({
          year: Number(row.children[1].textContent), title: row.children[0].textContent
        })).sort((a, b) => b.year - a.year));
        const years = matches.map(match => match.year);
        assert.equal(years.length, 5, 'all five original matches remain visible');
        const central = years.slice(1, -1), span = central[0] - central[2];
        assert.equal(await page.locator('#history-span-value').innerText(), formatSpan(span));
        assert.deepEqual(await page.locator('.history-span-match-year > strong').allTextContents(),
          central.map(String));
        assert.deepEqual(await page.locator('.history-span-match-year > span').allTextContents(),
          matches.slice(1, -1).map(match => match.title), 'each central year identifies its corresponding match, including tied years');
        assert.match(await page.locator('.history-span-equation').innerText(),
          new RegExp(`Q3 − Q1: ${central[0]} − ${central[2]} = ${formatSpan(span)}$`));
        assert.match(await page.locator('#history-span-caption').innerText(), /Interquartile range \(IQR\)/);
        const current = page.locator('.history-span-bars [aria-current="true"]');
        assert.equal(await current.locator('.history-span-bar-range').innerText(), `${central[2]}–${central[0]}`);
        assert.equal(await current.locator('.history-span-bar-length').innerText(), formatSpan(span));
        const comparisons = await page.locator('.history-span-bars li').evaluateAll(rows => rows.map(row => ({
          span: Number.parseInt(row.querySelector('.history-span-bar-length').textContent, 10),
          width: Number.parseFloat(row.querySelector('.history-span-track > span').style.width)
        })));
        const max = Math.max(1, ...comparisons.map(row => row.span));
        for (const row of comparisons) assert.ok(Math.abs(row.width - 100 * row.span / max) < 0.001);
      }
      const availableYears = await page.locator('#history-span-year option').evaluateAll(options => options.map(option => option.value));
      const assertYear = async year => {
        assert.equal(await page.locator('#history-span-year').inputValue(), year);
        assert.equal(await page.locator('#year-picker').inputValue(), year);
        assert.equal(await page.locator('.history-span-bars [aria-current="true"] .history-span-bar-title > span').innerText(), year);
      };
      await page.selectOption('#history-span-year', availableYears[0]);
      assert.ok(await page.locator('#history-span-previous-year').isDisabled());
      await page.locator('#history-span-next-year').click();
      await assertYear(availableYears[1]);
      await page.locator('#history-span-previous-year').click();
      await assertYear(availableYears[0]);
      await page.selectOption('#history-span-year', availableYears.at(-1));
      assert.ok(await page.locator('#history-span-next-year').isDisabled());
      await page.locator('#history-span-previous-year').click();
      await assertYear(availableYears.at(-2));
      // Movie years can have gaps: arrows follow the same available years as the frame.
      const gap = availableYears.findIndex((year, i) => i && Number(year) - Number(availableYears[i - 1]) > 1);
      if (gap > 0) {
        await page.selectOption('#history-span-year', availableYears[gap - 1]);
        await page.locator('#history-span-next-year').click();
        await assertYear(availableYears[gap]);
      }
      await page.selectOption('#year-picker', '2000');
      await assertYear('2000');
    }
    assert.equal(await page.locator('#history-match-span').evaluate(root =>
      getComputedStyle(root, '::details-content').transitionDuration), '0s', 'reduced motion disables expansion transitions');
    assert.equal(await page.locator('.history-span-bars-previous').count(), 0, 'reduced motion skips the chart roll');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const year of [2001, 2000]) {
      const roll = await page.evaluate(year => {
        const picker = document.querySelector('#history-span-year');
        picker.value = year;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
        const outgoing = document.querySelector('.history-span-bars-previous');
        const incoming = document.querySelector('.history-span-bars');
        const lists = [outgoing, incoming];
        for (const list of lists) for (const animation of list.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 90;
        }
        return {
          labels: lists.map(list => [...list.querySelectorAll('.history-span-bar-title > span')].map(label => label.textContent)),
          transforms: lists.map(list => {
            const transform = new DOMMatrix(getComputedStyle(list).transform);
            return { y: transform.m42, rotation: transform.m23 };
          }),
          curvedRows: lists.flatMap(list => [...list.children]).filter(row =>
            Math.abs(new DOMMatrix(getComputedStyle(row).transform).m23) > 0).length,
          hidden: outgoing.getAttribute('aria-hidden'),
          inert: outgoing.inert,
          controlAnimations: document.querySelector('.history-span-year-control').getAnimations({ subtree: true }).length,
          resultAnimations: document.querySelector('.history-span-results').getAnimations().length,
          current: picker.value,
          frameYear: document.querySelector('#year-picker').value
        };
      }, year);
      assert.deepEqual(roll.labels, year === 2001
        ? [['1999', '2000', '2001'], ['2000', '2001', '2002']]
        : [['2000', '2001', '2002'], ['1999', '2000', '2001']]);
      assert.equal(roll.current, String(year));
      assert.equal(roll.frameYear, String(year));
      assert.equal(roll.hidden, 'true', 'outgoing chart stays out of the accessibility tree');
      assert.ok(roll.inert);
      assert.equal(roll.controlAnimations, 0, 'year controls keep their original behavior');
      assert.equal(roll.resultAnimations, 0, 'motion is confined to the comparison chart');
      const step = year === 2001 ? 1 : -1;
      assert.ok(roll.transforms[0].y * step < 0 && roll.transforms[1].y * step > 0,
        'chart rows roll vertically, reversing for previous-year navigation');
      assert.ok(roll.curvedRows > 0, 'entering and leaving rows curve around the wheel');
      if (process.env.ANIVIZ_CAPTURE_DIR) await page.locator('.history-span-comparison').screenshot({
        path: `${process.env.ANIVIZ_CAPTURE_DIR}/history-chart-roll-${year}.png`, animations: 'allow'
      });
      await page.locator('.history-span-bars, .history-span-bars-previous').evaluateAll(lists => {
        for (const list of lists) for (const animation of list.getAnimations({ subtree: true })) animation.finish();
      });
      await page.waitForFunction(() => !document.querySelector('.history-span-bars-previous'));
    }
    await page.evaluate(() => {
      const picker = document.querySelector('#history-span-year');
      for (const year of [2001, 2002, 2001]) {
        picker.value = year;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    assert.equal(await page.locator('.history-span-bars-previous').count(), 1, 'rapid changes replace the previous animation');
    assert.deepEqual(await page.locator('.history-span-bars .history-span-bar-title > span').allTextContents(), ['2000', '2001', '2002']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => !document.querySelector('.history-span-bars-previous'));
    assert.equal(await page.locator('#history-span-year').inputValue(), '2001', 'cancelling motion retains the latest selected year');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const opening of [false, true]) {
      const transition = await page.locator('#history-match-span').evaluate(async root => {
        const from = root.getBoundingClientRect().height;
        root.querySelector('summary').click();
        // Observe actual layout: native ::details-content transitions are not
        // exposed by getAnimations() in every browser.
        const samples = [], start = performance.now();
        do {
          await new Promise(resolve => requestAnimationFrame(resolve));
          samples.push(root.getBoundingClientRect().height);
        } while (performance.now() - start < 350);
        return { from, samples, to: samples.at(-1), open: root.open };
      });
      assert.equal(transition.open, opening);
      assert.ok(opening ? transition.from < transition.to : transition.from > transition.to);
      assert.ok(transition.samples.some(height =>
        height > Math.min(transition.from, transition.to) + 1 && height < Math.max(transition.from, transition.to) - 1),
      'height passes through an intermediate size when opening and closing');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#history-span-calculation').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.ANIVIZ_CAPTURE_DIR) await page.locator('#history-span-calculation').screenshot({
      path: `${process.env.ANIVIZ_CAPTURE_DIR}/history-match-titles-mobile.png`
    });
    assert.deepEqual(errors, []);
    console.log('Passed History IQR evidence, navigation, wheel animation in both directions, rapid changes, expand/collapse, reduced motion and mobile layout.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
