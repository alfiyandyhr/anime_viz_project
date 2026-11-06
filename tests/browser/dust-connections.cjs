// Optional browser regression: run with the Playwright setup in journey-verification.md.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch({ headless:true,
    ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}) });
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const errors = [], colors = new Set();
    page.on('pageerror', error => errors.push(error.stack));
    await page.goto(new URL('frontend/dust-magnet/index.html',base).href);
    await page.waitForSelector('.dust-node');
    await page.waitForFunction(() => AnivizMain.snapshot().metadataStatus === 'ready');
    const chart = page.locator('[data-dust-chart="connections"]');
    const check = async () => {
      await chart.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const s = AnivizMain.snapshot();
        return s.displayedDust.length ? document.querySelector('[data-dust-connection-id]')
          : !document.querySelector('[data-dust-connection-id]');
      });
      const evidence = await page.evaluate(() => {
        const s = AnivizMain.snapshot();
        const dustColors = new Map([...document.querySelectorAll('.dust-node')].map(el =>
          [String(el.__data__.anime.id),getComputedStyle(el.querySelector('.dust-grain')).fill]));
        return {count:s.displayedDust.length, corpus:s.ranking.length,
          coverage:document.querySelector('[data-coverage="connections"]').textContent,
          cards:[...document.querySelectorAll('.dust-connection-map')].map((card,movieIndex) => {
            const sorted = s.displayedDust.slice().sort((a,b) =>
              b.scores[movieIndex]-a.scores[movieIndex] || a.index-b.index);
            const topCount = Math.min(5,sorted.length), bottomStart = Math.max(topCount,sorted.length-5);
            const expected = sorted.map((row,i) => ({id:String(row.anime.id),rank:i+1,
              score:row.scores[movieIndex].toFixed(3)})).filter((_,i) => i<topCount || i>=bottomStart);
            const actual = [...card.querySelectorAll('[data-dust-connection-id]')].map(el => {
              const match = el.__data__;
              return {id:String(match.anime.id),rank:match.rank,
                score:el.querySelector('.recommendation-chart-score').textContent};
            });
            const paints = [...card.querySelectorAll('[data-dust-connection-id]')].map(el => ({
              dust:dustColors.get(String(el.__data__.anime.id)),
              line:getComputedStyle(el.querySelector('.connection-line')).stroke,
              dot:getComputedStyle(el.querySelector('.recommendation-dot')).fill,
              score:getComputedStyle(el.querySelector('.recommendation-chart-score')).fill
            }));
            return {expected,actual,paints,text:card.textContent};
          })};
      });
      assert.equal(evidence.corpus,1000);
      assert.match(evidence.coverage,new RegExp(`^${evidence.count} displayed anime`));
      for (const card of evidence.cards) {
        assert.deepEqual(card.actual,card.expected);
        assert.doesNotMatch(card.text,/GLOBAL RANK/);
        for (const paint of card.paints) {
          assert.ok(paint.dust);
          assert.equal(paint.line,paint.dust);
          assert.equal(paint.dot,paint.dust);
          assert.equal(paint.score,paint.dust);
          colors.add(paint.dust);
        }
      }
      if (!evidence.count) {
        assert.equal(evidence.cards.length,0);
        assert.match(await chart.innerText(),/Broaden or reset filters/);
      }
      return evidence;
    };
    const control = async (selector,value,event='change') => page.locator(selector).evaluate((el,{value,event}) => {
      el.value = value; el.dispatchEvent(new Event(event,{bubbles:true}));
    },{value,event});
    const addMovie = async title => {
      await page.locator('#movie-search').fill(title);
      await page.locator('#movie-search').press('Enter');
    };
    assert.equal((await check()).count,60);
    for (const title of ['Interstellar','The Matrix']) {
      await addMovie(title);
      assert.equal((await check()).count,60);
    }
    for (const count of [30,90,60]) {
      await control('#dust-limit',String(count));
      assert.equal((await check()).count,count);
    }
    const movieIds = await page.evaluate(() => AnivizMain.snapshot().movieIds);
    const original = await check();
    assert.deepEqual(original.cards[0].actual.map(row=>row.rank),[1,2,3,4,5,56,57,58,59,60]);
    for (const sort of [...movieIds,'average']) {
      await control('[data-dust-ranking-sort]',sort);
      assert.deepEqual((await check()).cards.map(card=>card.actual),original.cards.map(card=>card.actual));
    }
    const genre = await page.evaluate(() => {
      const s = AnivizMain.snapshot();
      return s.lookup.get(s.displayedDustIds[0]).anime.genres[0];
    });
    await control('#genre-filter',genre,'input');
    const filtered = await check();
    assert.ok(filtered.count>0 && filtered.count<60);
    await page.evaluate(() => document.querySelector('#reset-filters').click());
    const title = await page.evaluate(() => {
      const s = AnivizMain.snapshot(); return s.lookup.get(s.displayedDustIds[0]).anime.title;
    });
    await control('#search-input',title,'input');
    assert.ok((await check()).count<=10,'small filtered sets show every local rank once');
    await control('#search-input','no anime can match this title','input');
    assert.equal((await check()).count,0);
    await page.evaluate(() => document.querySelector('#reset-filters').click());
    await page.evaluate(() => document.querySelector('[data-remove-magnet]').click());
    assert.equal((await check()).cards.length,2);
    await addMovie('Inception');
    assert.equal((await check()).cards.length,3);
    assert.equal(colors.size,3,'connections use all three closest-magnet colors');

    // Inspect a mapped anime without changing the dust selection.
    const row = page.locator('[data-dust-connection-id]').first();
    await row.focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('#detail-drawer.open');
    assert.deepEqual(await page.evaluate(() => AnivizMain.snapshot().selectedAnimeIds),[]);
    await page.keyboard.press('Escape');
    if (process.env.ANIVIZ_CAPTURE_DIR) {
      fs.mkdirSync(process.env.ANIVIZ_CAPTURE_DIR,{recursive:true});
      await chart.screenshot({path:path.join(process.env.ANIVIZ_CAPTURE_DIR,'dust-connections-desktop.png'),
        style:'.site-header { visibility:hidden; }'});
    }
    await page.setViewportSize({width:390,height:844});
    await page.reload();
    await page.waitForSelector('.dust-node');
    await page.waitForFunction(() => AnivizMain.snapshot().metadataStatus === 'ready');
    await check();
    const overflow = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,
      outside:[...document.querySelectorAll('body *')].filter(el => {
        const rect=el.getBoundingClientRect(); return rect.right>innerWidth && rect.width>0;
      }).slice(0,12).map(el => ({tag:el.tagName,class:el.className,id:el.id,right:el.getBoundingClientRect().right}))}));
    assert.equal(overflow.scroll>overflow.width,false,JSON.stringify(overflow));
    if (process.env.ANIVIZ_CAPTURE_DIR) await chart.screenshot({
      path:path.join(process.env.ANIVIZ_CAPTURE_DIR,'dust-connections-mobile.png'),
      style:'.site-header { visibility:hidden; }'});
    assert.deepEqual(errors,[]);
    console.log('Verified local ranks, 30/60/90 dots, filters, empty/small sets, all dust colors, movie changes, detail access and mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
