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
    const magnets = chart.locator('[data-dust-connection-movie]');
    const memberMagnets = chart.locator('[data-dust-member-movie]');
    const visibleRanks = async () => chart.locator('svg path').evaluateAll(paths =>
      paths.map(el => el.__data__.match.rank).sort((a,b) => a-b));
    const check = async () => {
      await chart.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const s = AnivizMain.snapshot();
        return s.displayedDust.length ? document.querySelector('[data-dust-connection-id]')
          : !document.querySelector('[data-dust-connection-id]');
      });
      const evidence = await page.evaluate(() => {
        const s = AnivizMain.snapshot();
        const dustColors = new Map([...document.querySelectorAll('#recommendation-chart .dust-node')].map(el =>
          [String(el.__data__.anime.id),getComputedStyle(el.querySelector('.dust-grain')).fill]));
        return {count:s.displayedDust.length, corpus:s.ranking.length, movieCount:s.movieIds.length,
          coverage:document.querySelector('[data-coverage="connections"]').textContent,
          cards:[...document.querySelectorAll('.dust-connection-map')].map(card => {
            const magnets = [...card.querySelectorAll('[data-dust-connection-movie]')];
            const movieIndex = magnets.findIndex(button => button.getAttribute('aria-pressed') === 'true');
            const sorted = s.displayedDust.slice().sort((a,b) =>
              b.scores[movieIndex]-a.scores[movieIndex] || a.index-b.index);
            const expected = sorted.map((row,i) => ({id:String(row.anime.id),rank:i+1,
              score:row.scores[movieIndex].toFixed(3)}));
            const actual = [...card.querySelectorAll('[data-dust-connection-id]')].map(el => {
              const match = el.__data__;
              return {id:String(match.anime.id),rank:match.rank,
                score:el.querySelector('.dust-connection-score').textContent};
            });
            const paints = [...card.querySelectorAll('[data-dust-connection-id]')].map(el => ({
              dust:dustColors.get(String(el.__data__.anime.id)),
              dot:getComputedStyle(el.querySelector('.dust-connection-dot')).backgroundColor,
              score:getComputedStyle(el.querySelector('.dust-connection-score')).color
            }));
            const lines = [...card.querySelectorAll('svg path')].map(el => ({
              dust:dustColors.get(String(el.__data__.match.anime.id)),
              color:getComputedStyle(el).stroke, width:Number(el.getAttribute('stroke-width')),
              score:el.__data__.match.similarity
            })).sort((a,b) => a.score-b.score);
            const members = card.parentElement.querySelector('.dust-member-panel');
            const memberMagnets = [...members.querySelectorAll('[data-dust-member-movie]')];
            const expectedMembers = sorted.filter(row => row.scores.indexOf(Math.max(...row.scores)) === movieIndex)
              .map((row,i) => [i+1, row.anime.title, row.scores[movieIndex].toFixed(3)]);
            const actualMembers = [...members.querySelectorAll('tbody tr')].map(row =>
              [...row.cells].map((cell,i) => i === 0 ? Number(cell.textContent) : cell.textContent));
            return {expected,actual,paints,lines,movieIndex,magnetCount:magnets.length,
              expectedMembers,actualMembers,memberMagnetCount:memberMagnets.length,
              activeMemberMagnet:memberMagnets.findIndex(button => button.getAttribute('aria-pressed') === 'true'),
              memberCount:members.querySelector('.dust-member-count').textContent,
              memberEmpty:!!members.querySelector('.dust-member-empty')};
          })};
      });
      assert.equal(evidence.corpus,1000);
      assert.match(evidence.coverage,new RegExp(`^${evidence.count} displayed anime`));
      assert.equal(evidence.cards.length, Number(evidence.count > 0));
      for (const card of evidence.cards) {
        assert.equal(card.magnetCount,evidence.movieCount);
        assert.deepEqual(card.actual,card.expected);
        assert.equal(card.memberMagnetCount,evidence.movieCount);
        assert.equal(card.activeMemberMagnet,card.movieIndex);
        assert.deepEqual(card.actualMembers,card.expectedMembers);
        assert.equal(card.memberCount,`${card.actualMembers.length} of ${evidence.count} displayed anime`);
        assert.equal(card.memberEmpty,card.actualMembers.length === 0);
        for (const paint of card.paints) {
          assert.ok(paint.dust);
          assert.equal(paint.dot,paint.dust);
          assert.equal(paint.score,paint.dust);
          colors.add(paint.dust);
        }
        card.lines.forEach((line, i) => {
          assert.equal(line.color,line.dust);
          if (i && line.score > card.lines[i-1].score) assert.ok(line.width > card.lines[i-1].width);
        });
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
    const extremes = [1,2,3,4,5,56,57,58,59,60];
    assert.deepEqual(await visibleRanks(),extremes);
    assert.ok(original.cards[0].lines.at(-1).width - original.cards[0].lines[0].width >= 7);
    const top = chart.locator('[data-dust-connection-panel="0"]');
    const bottom = chart.locator('[data-dust-connection-panel="1"]');
    await top.evaluate(el => { el.scrollTop = 10 * el.firstElementChild.offsetHeight; });
    await bottom.evaluate(el => { el.scrollTop = 0; });
    await page.waitForFunction(() => {
      const ranks = [...document.querySelectorAll('.dust-connection-lines path')].map(el => el.__data__.match.rank);
      return ranks.includes(11) && ranks.includes(31);
    });
    assert.deepEqual(await visibleRanks(),[11,12,13,14,15,31,32,33,34,35]);
    await magnets.nth(1).focus();
    await page.keyboard.press('Space');
    const second = (await check()).cards[0];
    assert.equal(second.movieIndex,1);
    assert.equal(await magnets.nth(1).evaluate(el => el === document.activeElement),true);
    assert.notDeepEqual(second.actual,original.cards[0].actual);
    assert.deepEqual(await visibleRanks(),extremes);
    await magnets.nth(2).click();
    const third = (await check()).cards[0];
    assert.equal(third.movieIndex,2);
    assert.notDeepEqual(third.actual,second.actual);
    assert.equal(original.cards[0].actualMembers.length + second.actualMembers.length + third.actualMembers.length,60);
    const map = chart.locator('.dust-connection-map');
    const members = chart.locator('.dust-member-panel');
    const [mapBounds, memberBounds] = await Promise.all([map.boundingBox(), members.boundingBox()]);
    assert.ok(memberBounds.x >= mapBounds.x + mapBounds.width, 'member ranking sits to the right of the map');
    for (const sort of [...movieIds,'average']) {
      await control('[data-dust-ranking-sort]',sort);
      assert.deepEqual((await check()).cards[0].actual,third.actual);
    }

    const selection = () => page.evaluate(() => AnivizMain.snapshot().selectedAnimeIds);
    const dust = page.locator('#recommendation-chart .dust-node');
    const [first, secondId, thirdId, fourth] = (await dust.evaluateAll(nodes =>
      nodes.slice(0, 4).map(node => node.dataset.matchId)));
    const dustById = id => dust.and(page.locator(`[data-match-id="${id}"]`));
    const titleFor = id => page.evaluate(id => AnivizMain.snapshot().lookup.get(id).anime.title, id);
    for (const id of [first, secondId, thirdId]) {
      await dustById(id).focus();
      await page.keyboard.press('Enter');
    }
    await dustById(fourth).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#dust-focus h3').innerText(), await titleFor(fourth));
    assert.deepEqual(await selection(), [first, secondId, thirdId]);
    assert.equal(await dustById(fourth).getAttribute('aria-pressed'), 'false');

    await check();
    const selectedRows = () => chart.locator('.dust-connection-row[aria-pressed="true"]').evaluateAll(rows =>
      rows.map(row => String(row.__data__.anime.id)).sort());
    assert.deepEqual(await selectedRows(), [first, secondId, thirdId].sort());
    await magnets.first().click();
    assert.deepEqual(await selectedRows(), [first, secondId, thirdId].sort());
    const row = id => chart.locator(`[data-dust-connection-id="${movieIds[0]}:${id}"]`);
    const drawer = page.locator('#detail-drawer');
    assert.notEqual(await row(first).evaluate(el => getComputedStyle(el).boxShadow), 'none');
    await row(fourth).click();
    await drawer.locator('h2').waitFor();
    assert.equal(await drawer.getAttribute('aria-hidden'), 'false');
    assert.equal(await drawer.locator('h2').innerText(), await titleFor(fourth));
    assert.deepEqual(await selection(), [first, secondId, thirdId]);
    assert.equal(await row(fourth).getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('Escape');
    await row(first).click();
    assert.equal(await drawer.getAttribute('aria-hidden'), 'true');
    assert.equal(await row(first).getAttribute('aria-pressed'), 'false');
    assert.equal(await dustById(first).getAttribute('aria-pressed'), 'false');
    await row(fourth).focus();
    await page.keyboard.press('Enter');
    assert.equal(await drawer.getAttribute('aria-hidden'), 'false');
    assert.equal(await drawer.locator('h2').innerText(), await titleFor(fourth));
    assert.deepEqual(await selection(), [secondId, thirdId, fourth]);
    assert.equal(await row(fourth).getAttribute('aria-pressed'), 'true');
    assert.equal(await dustById(fourth).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    await page.locator('[data-dust-clear]').click();
    await check();
    assert.deepEqual(await selectedRows(), []);

    const largestGroup = [original.cards[0], second, third].reduce((a,b) =>
      a.actualMembers.length >= b.actualMembers.length ? a : b).movieIndex;
    await magnets.nth((largestGroup + 1) % 3).click();
    await memberMagnets.nth(largestGroup).focus();
    await page.keyboard.press('Space');
    assert.equal((await check()).cards[0].movieIndex,largestGroup);
    assert.equal(await memberMagnets.nth(largestGroup).evaluate(el => el === document.activeElement),true);
    const memberScroll = members.locator('[data-dust-member-scroll]');
    const scrollTop = await memberScroll.evaluate(el => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    assert.ok(scrollTop > 0,'long member rankings scroll within the table');
    const member = members.locator('[data-dust-member-id]').last();
    const memberId = await member.evaluate(el => String(el.__data__.anime.id));
    const memberRow = members.locator('tbody tr').last();
    const mapRow = chart.locator(`[data-dust-connection-id="${movieIds[largestGroup]}:${memberId}"]`);
    await member.focus();
    await page.keyboard.press('Enter');
    assert.equal(await drawer.getAttribute('aria-hidden'),'false');
    assert.equal(await drawer.locator('h2').innerText(),await titleFor(memberId));
    assert.deepEqual(await selection(),[memberId]);
    assert.equal(await member.getAttribute('aria-pressed'),'true');
    assert.equal(await memberRow.evaluate(el => getComputedStyle(el).outlineStyle),'solid');
    assert.equal(await memberScroll.evaluate(el => el.scrollTop),scrollTop);
    assert.equal(await mapRow.getAttribute('aria-pressed'),'true');
    assert.equal(await dustById(memberId).getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Escape');
    await memberRow.locator('td').last().click();
    assert.equal(await drawer.getAttribute('aria-hidden'),'true');
    assert.deepEqual(await selection(),[]);
    assert.equal(await mapRow.getAttribute('aria-pressed'),'false');
    assert.equal(await dustById(memberId).getAttribute('aria-pressed'),'false');
    await dustById(memberId).focus();
    await page.keyboard.press('Enter');
    assert.equal(await member.getAttribute('aria-pressed'),'true');
    await mapRow.focus();
    await page.keyboard.press('Enter');
    assert.equal(await member.getAttribute('aria-pressed'),'false');
    await memberMagnets.nth((largestGroup + 1) % 3).click();
    await memberMagnets.nth(largestGroup).click();
    assert.equal(await memberScroll.evaluate(el => el.scrollTop),0);
    await magnets.nth(2).click();

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
    const small = await check();
    assert.ok(small.count<=10,'small filtered sets show every local rank once');
    const emptyMagnet = await page.evaluate(() => {
      const s = AnivizMain.snapshot();
      return s.movieIds.findIndex((_, index) => s.displayedDust.every(dust => dust.closest !== index));
    });
    assert.ok(emptyMagnet >= 0,'the filtered fixture leaves a magnet with no members');
    await memberMagnets.nth(emptyMagnet).click();
    assert.equal((await check()).cards[0].memberEmpty,true);
    await control('#search-input','no anime can match this title','input');
    assert.equal((await check()).count,0);
    await page.evaluate(() => document.querySelector('#reset-filters').click());
    await magnets.nth(2).click();
    await page.evaluate(() => document.querySelector('[data-remove-magnet]').click());
    assert.equal((await check()).cards[0].movieIndex,1,'keep the selected movie when an earlier magnet is removed');
    await page.evaluate(() => document.querySelectorAll('[data-remove-magnet]')[1].click());
    assert.equal((await check()).cards[0].movieIndex,0,'fall back when the selected movie is removed');
    await addMovie('Inception');
    assert.equal((await check()).cards[0].magnetCount,2);
    assert.equal(colors.size,3,'connections use all three closest-magnet colors');

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
    const [mobileMapBounds, mobileMemberBounds] = await Promise.all([map.boundingBox(), members.boundingBox()]);
    assert.ok(mobileMemberBounds.y >= mobileMapBounds.y + mobileMapBounds.height,'member ranking stacks below the map on mobile');
    const overflow = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,
      outside:[...document.querySelectorAll('body *')].filter(el => {
        const rect=el.getBoundingClientRect(); return rect.right>innerWidth && rect.width>0;
      }).slice(0,12).map(el => ({tag:el.tagName,class:el.className,id:el.id,right:el.getBoundingClientRect().right}))}));
    assert.equal(overflow.scroll>overflow.width,false,JSON.stringify(overflow));
    if (process.env.ANIVIZ_CAPTURE_DIR) await chart.screenshot({
      path:path.join(process.env.ANIVIZ_CAPTURE_DIR,'dust-connections-mobile.png'),
      style:'.site-header { visibility:hidden; }'});
    assert.deepEqual(errors,[]);
    console.log('Verified magnet switching, member rankings, scroll panels, curve widths and colors, filters, shared selection, detail access and mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
