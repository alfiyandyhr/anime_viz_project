// Optional real-browser regression checks. See tests/journey-verification.md for setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = (process.env.ANIVIZ_BASE_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const output = process.env.ANIVIZ_CAPTURE_DIR;
const url = route => new URL(route, base).href;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}) });
  try {
    const context = await browser.newContext({viewport:{width:1440,height:900}, reducedMotion:'reduce'});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    const dustReady = async () => {
      await page.waitForSelector('.dust-node');
      await page.waitForFunction(() => AnivizMain.snapshot().metadataStatus === 'ready');
    };
    const snapshot = () => page.evaluate(() => {
      const s=AnivizMain.snapshot();
      return {movies:s.magnetKeys, ids:s.displayedKeys, candidates:s.candidateKeys, scores:s.candidateDust.map(row=>row.scores), selection:s.selectedKeys, sort:s.rankingSortKey};
    });
    const sameEvidence = (a,b) => {
      for(const field of ['ids','candidates','scores','selection']) assert.deepEqual(b[field],a[field],field);
    };
    const addMovie = async title => {await page.locator('#movie-search').fill(title);await page.locator('#movie-search').press('Enter');};
    const goView = async label => {
      await page.locator('[data-view-menu] > summary').click();
      await page.locator('#view-destinations a').filter({hasText:label}).click();
    };
    const overflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    const assertVisibleFilters = async () => {
      assert.equal(await page.locator('#filterbar > summary').count(), 0);
      for (const id of ['search-input', 'genre-filter', 'studio-filter', 'format-filter', 'year-from', 'year-to']) {
        const control = page.locator(`#${id}`);
        assert.ok(await control.isVisible(), `${id} is visible`);
        assert.deepEqual(await control.evaluate(el => {
          const style = getComputedStyle(el);
          return [style.backgroundColor, style.borderTopWidth, style.borderLeftWidth, style.borderRightWidth];
        }), ['rgba(0, 0, 0, 0)', '0px', '0px', '0px'], `${id} has no surrounding box`);
      }
    };
    const assertChartScope = async () => {
      for(const kind of ['genres','years','studios','heatmap','reception']) {
        await page.locator(`[data-dust-chart="${kind}"]`).scrollIntoViewIfNeeded();
        await page.waitForFunction(kind=>document.querySelector(`[data-dust-chart="${kind}"] svg`),kind);
        const failures=await page.evaluate(kind=>{
          const s=AnivizMain.snapshot(),rows=s.displayedKeys.map(id=>s.lookup.get(id).record);
          const role = kind === 'reception' ? 'button' : 'img';
          return [...document.querySelectorAll(`[data-dust-chart="${kind}"] [role="${role}"]`)].flatMap(el=>{
            const d=el.__data__;
            const matching=rows.filter(a=>kind==='genres'?a.genres.includes(d.genre):kind==='years'?a.year===d.year:
              kind==='studios'?a.studio_names.includes(d.studio):kind==='heatmap'?a.studio_names.includes(d.studio)&&a.genres.includes(d.genre):a.id===String(d.id));
            const ok=kind==='reception'?matching.length===1&&Boolean(el.getAttribute('aria-label')):
              d.count===matching.length&&d.selectedCount===matching.filter(a=>s.selectedKeys.includes(`anilist:${a.id}`)).length;
            return ok?[]:[{kind,genre:d.genre,studio:d.studio,year:d.year,count:d.count,expected:matching.length}];
          });
        },kind);
        assert.deepEqual(failures,[],`${kind} marks match displayed IDs and selected contributions`);
      }
    };

    await page.goto(url(''));await dustReady();
    assert.match(await page.locator('#movie-magnets').innerText(),/Example/);
    assert.equal((await snapshot()).ids.length,60);
    assert.equal(await page.locator('#recommendation-detail').isVisible(),false);
    assert.deepEqual(await page.locator('#view-destinations a').allTextContents(),['Dust & Magnet','History','Network','Full Catalogue']);
    const menu=page.locator('[data-view-menu] > summary');await menu.focus();await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#view-destinations a').first().evaluate(el=>document.activeElement===el),true);
    await page.keyboard.press('End');await page.keyboard.press('Escape');
    assert.equal(await menu.evaluate(el=>document.activeElement===el),true);
    await addMovie('Interstellar');await addMovie('The Matrix');
    assert.equal((await snapshot()).movies.length,3);
    const fieldOptions = page.locator('[data-field-options]');
    assert.ok(await page.getByLabel('Anime dots').isVisible());
    assert.ok(await page.getByRole('button', { name: 'Reset positions' }).isVisible());
    assert.equal(await page.locator('#filterbar').isVisible(), false);
    for(const count of ['30','90','60']) {
      await page.selectOption('#dust-limit',count);
      assert.equal((await snapshot()).ids.length,Number(count));
    }
    console.log('Verified example, keyboard menu and 30/60/90 with three magnets');
    const layout = await page.evaluate(() => {
      const left=document.querySelector('.recommendation-picker').getBoundingClientRect();
      const field=document.querySelector('#recommendation-chart').getBoundingClientRect();
      const right=document.querySelector('#dust-focus').getBoundingClientRect();
      return left.right <= field.left && field.right <= right.left;
    });
    assert.equal(layout,true,'movie controls, field and focus form three columns');
    assert.equal(await fieldOptions.locator('summary').innerText(), 'Filter');
    await fieldOptions.locator('summary').click();
    await assertVisibleFilters();
    const focusTitle=()=>page.locator('#dust-focus h3').innerText();
    for(let i=0;i<3;i++) {
      const dust=page.locator('.dust-node').nth(i);
      await dust.focus();
      assert.deepEqual(await page.locator('#tooltip .dust-tooltip-score b').allTextContents(),
        await dust.evaluate(el => el.__data__.scores.map(score => score.toFixed(3))));
      await page.keyboard.press('Enter');
      const expected=await page.evaluate(()=>{const s=AnivizMain.snapshot();return s.lookup.get(s.selectedKeys.at(-1)).record.title});
      assert.equal(await focusTitle(),expected);
    }
    assert.equal(await page.locator('#dust-focus .detail-cover').count(),1);
    assert.equal(await page.locator('#dust-focus .detail-banner').count(),1);
    assert.doesNotMatch(await page.locator('#recommendation-detail').innerText(),/Storyline|Story tags|Synopsis|sampled cast|voice credits/);
    const triple=await snapshot();
    await page.locator('.magnet-core').first().click();
    sameEvidence(triple,await snapshot());
    await page.locator('.recommendation-score-note').click();
    sameEvidence(triple,await snapshot());
    for(let left=2;left>=0;left--) {
      const empty=await page.evaluate(()=>{
        const field=document.querySelector('#recommendation-chart'), r=field.getBoundingClientRect();
        for(let y=r.top+15;y<r.bottom-15;y+=20) for(let x=r.left+15;x<r.right-15;x+=20) {
          const el=document.elementFromPoint(x,y);
          if(field.contains(el)&&!el.closest('.dust-node, .dust-magnet')) return {x,y};
        }
      });
      assert.ok(empty,'an empty place in the field is available');
      await page.mouse.click(empty.x,empty.y);
      assert.deepEqual((await snapshot()).selection,triple.selection.slice(0,left));
      assert.ok(await fieldOptions.evaluate(el => el.open), 'deselecting dust keeps Filter open');
      if(left) {
        const expected=await page.evaluate(()=>{const s=AnivizMain.snapshot();return s.lookup.get(s.selectedKeys.at(-1)).record.title});
        assert.equal(await focusTitle(),expected);
      } else assert.equal(await focusTitle(),'Every dot has a story.');
    }
    await fieldOptions.locator('summary').click();
    console.log('Verified three-decimal tooltips, side panels, focus imagery and last-in-first-out deselection');

    const initial=await snapshot();
    for(let i=0;i<2;i++) {await page.locator('.dust-node').nth(i).focus();await page.keyboard.press(i?'Space':'Enter');}
    assert.equal((await snapshot()).selection.length,2);assert.equal(await page.evaluate(()=>scrollY),0);
    await page.locator('#recommendation-detail').scrollIntoViewIfNeeded();
    assert.match(await page.locator('#recommendation-detail').innerText(),/Comparing 2 anime/);
    const chosen=await snapshot();

    // A complete scroll walkthrough requires no task, show, or comparison action.
    for(const kind of ['connections','reception','genres','years','studios','heatmap']) {
      const chart=page.locator(`[data-dust-chart="${kind}"]`);
      await chart.scrollIntoViewIfNeeded();await page.waitForFunction(kind=>document.querySelector(`[data-dust-chart="${kind}"] svg`),kind);
    }
    const scoped=await page.evaluate(()=>{
      const s=AnivizMain.snapshot();
      return {dots:[...document.querySelectorAll('#recommendation-chart .dust-node')].map(el=>el.__data__.key),
        map:[...document.querySelectorAll('[data-dust-connection-id]')].map(el=>el.__data__.key),
        scatter:[...document.querySelectorAll('[data-dust-chart="reception"] circle[role="button"]')].map(el=>`anilist:${el.__data__.id}`),
        expectedScatter:s.displayedKeys.filter(id=>{const a=s.lookup.get(id).record;return a.popularity>0&&Number.isFinite(a.average_score)}),
        ranking:s.ranking.length,
        displayed:s.ranking.filter(row=>row.displayed).map(row=>row.key),
        counts:[...document.querySelectorAll('[data-dust-chart="genres"] [role="img"]')].map(el=>({genre:el.__data__.genre,count:el.__data__.count,expected:s.displayedKeys.filter(id=>s.lookup.get(id).record.genres.includes(el.__data__.genre)).length}))};
    });
    assert.deepEqual(scoped.dots.sort(),[...chosen.ids].sort());
    assert.deepEqual(scoped.map.sort(),[...chosen.ids].sort());
    assert.deepEqual(scoped.scatter.sort(),scoped.expectedScatter.sort());assert.ok(scoped.scatter.length>0);
    assert.equal(scoped.ranking,1000);assert.deepEqual(scoped.displayed.sort(),[...chosen.ids].sort());
    assert.ok(scoped.counts.length>0);for(const row of scoped.counts) assert.equal(row.count,row.expected);

    await assertChartScope();
    assert.equal(await page.evaluate(()=>['.recommendation-picker','#dust-focus'].every(selector=>document.querySelector(selector).getBoundingClientRect().bottom<0)),true,'side panels scroll away above analysis');
    for(const sort of [...chosen.movies,'average']) {
      await page.locator('[data-dust-ranking-pages] button').last().click();
      const positions=await page.evaluate(()=>recommendationState.magnetPositions);
      await page.selectOption('[data-dust-ranking-sort]',sort);
      assert.equal(await page.locator('[data-dust-ranking-body] tr td').first().innerText(),'1');
      sameEvidence(chosen,await snapshot());assert.deepEqual(await page.evaluate(()=>recommendationState.magnetPositions),positions);
      assert.equal(await page.evaluate(()=>{const s=AnivizMain.snapshot();return s.ranking.every((r,i)=>!i||s.ranking[i-1].sortScore>=r.sortScore)}),true);
    }
    await page.locator('[data-dust-page="99"]').click();
    const outside=page.locator('[data-dust-rank-id]').first();assert.equal(chosen.ids.includes(await outside.getAttribute('data-dust-rank-id')),false);
    const outsideTitle=await outside.innerText();
    await outside.click();sameEvidence(chosen,await snapshot());
    assert.equal(await page.locator('#detail-drawer.open h2').innerText(),outsideTitle);
    await page.locator('#close-drawer').click();

    await page.locator('[data-dust-chart="genres"]').scrollIntoViewIfNeeded();
    const genre=await page.locator('[data-dust-chart="genres"] [role="img"]').first().evaluate(el=>el.__data__.genre);
    await fieldOptions.locator('summary').click();
    await page.selectOption('#genre-filter',genre);
    const filtered=await snapshot();assert.ok(filtered.ids.length>0&&filtered.ids.length<60);
    assert.deepEqual(filtered.candidates,initial.candidates);
    assert.deepEqual(filtered.selection,chosen.selection.filter(id=>filtered.ids.includes(id)));
    await assertChartScope();
    await page.locator('[data-dust-chips] button').first().click();assert.deepEqual((await snapshot()).ids,initial.ids);
    await page.evaluate(()=>scrollTo(0,0));
    await page.locator('#search-input').fill('no matching anime 910');
    assert.equal((await snapshot()).ids.length,0);assert.equal((await snapshot()).selection.length,0);
    await page.locator('#reset-filters').click();assert.deepEqual((await snapshot()).ids,initial.ids);
    await page.locator('#reset-magnets').click();await page.keyboard.press('Escape');
    for(let i=0;i<2;i++){await page.locator('.dust-node').nth(i).focus();await page.keyboard.press('Enter');}
    const persisted=await snapshot();
    await page.evaluate(()=>scrollTo(0,1500));
    const scroll=await page.evaluate(()=>scrollY);
    await goView('Network');await page.waitForSelector('.network-nodes g');
    assert.equal(await page.inputValue('#network-scope'),'dust');assert.match(await page.locator('#network-summary').innerText(),/35 of 60/);
    await page.selectOption('#network-scope','catalogue');
    await goView('Full Catalogue');await page.waitForSelector('#anime-table-body tr');
    assert.equal(await page.evaluate(()=>state.cohort_ids),null);
    assert.equal(await page.evaluate(()=>state.filteredAnime.length),1000);
    await page.locator('#filter-title').click();
    await assertVisibleFilters();
    await page.locator('#search-input').fill('Paprika');
    await goView('Dust & Magnet');await dustReady();sameEvidence(persisted,await snapshot());
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scroll)<5);
    await page.reload();await dustReady();sameEvidence(persisted,await snapshot());
    await page.goBack();await page.waitForSelector('#anime-table-body tr');assert.equal(await page.inputValue('#search-input'),'Paprika');
    await page.goForward();await dustReady();sameEvidence(persisted,await snapshot());

    console.log('Verified chart scopes, sort/pagination, comparison, filters and restored navigation');
    // Removing the selected sort's movie falls back to average and retains surviving selections.
    await page.selectOption('[data-dust-ranking-sort]',persisted.movies[2]);
    await page.locator(`[data-remove-magnet="${persisted.movies[2]}"]`).click();
    assert.equal((await snapshot()).sort,'average');
    const afterRemoval=await snapshot();assert.deepEqual(afterRemoval.selection,persisted.selection.filter(id=>afterRemoval.ids.includes(id)));
    for(const id of afterRemoval.movies) await page.locator(`[data-remove-magnet="${id}"]`).click();
    assert.equal((await snapshot()).ids.length,0);assert.match(await page.locator('#recommendation-chart').innerText(),/Add a magnet to explore the anime sample/);
    await page.reload();await page.waitForFunction(()=>AnivizMain.snapshot()?.metadataStatus==='ready'&&recommendationState.data);
    assert.equal((await snapshot()).movies.length,0);
    await addMovie('Inception');await dustReady();

    // Explicit legacy links win over a previous saved scroll position.
    for(const [route,expected] of [['#recommendations','dust-magnet'],['#content','content'],['#creators','creators'],['#reception','reception'],['#dust-magnet','dust-magnet'],['#story','story'],['#explorer','explorer']]) {
      await page.goto(url(route));
      if(['content','creators','reception'].includes(expected)) {
        await dustReady();await page.waitForFunction(id=>document.getElementById(id).getBoundingClientRect().top>=48&&document.getElementById(id).getBoundingClientRect().top<180,expected);
      } else assert.ok(page.url().includes(`/frontend/${expected}/index.html`));
    }
    await page.goto(url('frontend/creators/index.html?mode=catalogue#network-chart'));await page.waitForSelector('.network-nodes g');
    assert.equal(await page.inputValue('#network-scope'),'catalogue');
    await page.goto(url('frontend/content/index.html?mode=matches'));await dustReady();
    await page.waitForFunction(()=>document.getElementById('content').getBoundingClientRect().top>=48&&document.getElementById('content').getBoundingClientRect().top<180);
    await page.evaluate(()=>scrollTo(0,2300));const anchoredScroll=await page.evaluate(()=>scrollY);
    await goView('Network');await page.waitForSelector('.network-nodes g');await page.goBack();await dustReady();
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-anchoredScroll)<5,'Back restores scroll even on anchored URLs');
    await page.goto(url('frontend/story/index.html'));await page.waitForSelector('#history-pair');
    assert.equal(await page.inputValue('#year-picker'), '1963');
    assert.equal(await page.locator('#history-anime h2').innerText(), 'Astro Boy');
    assert.ok(await page.locator('#history-connection').isVisible());
    const firstPair = await page.locator('#history-movie h2').innerText();
    await page.mouse.move(120, 150);
    await page.mouse.wheel(0, 80);
    await page.waitForFunction(() => document.querySelector('#year-picker').value === '1964');
    assert.notEqual(await page.locator('#history-movie h2').innerText(), firstPair);
    await page.selectOption('#year-picker', '1995');
    assert.equal(await page.locator('#anime-point-year').textContent(), '1995');
    assert.equal(await page.locator('#history-movie .history-card-year').textContent(),
      await page.locator('#movie-point-year').textContent());
    await page.locator('#history-movie .synopsis-button').click();
    assert.ok(await page.locator('#history-dialog').isVisible());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#history-dialog').isVisible(), false);
    assert.equal(await page.evaluate(()=>typeof AnivizMain),'undefined');

    console.log('Verified legacy bookmarks, explicit anchors and anchored Back scroll');
    // Direct entry, legacy migration, and storage/error paths use isolated sessions.
    const checkIsolated = async (setup, check) => {
      const c=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'});
      try {const p=await c.newPage();p.on('pageerror',e=>errors.push(e.stack));await setup(c,p);await check(p);} finally {await c.close();}
    };
    await checkIsolated(async(c,p)=>{await c.addInitScript(()=>sessionStorage.setItem('aniviz_seed_movie',JSON.stringify({tmdbId:'157336',title:'Interstellar'})));await p.goto(url(''));},async p=>{
      await p.waitForSelector('.dust-node');assert.deepEqual(await p.evaluate(()=>AnivizMain.snapshot().magnetKeys),['tmdb:157336']);
      assert.equal(await p.locator('#recommendation-chart .dust-node').count(),60);assert.doesNotMatch(await p.locator('#movie-magnets').innerText(),/Example/);
    });
    await checkIsolated(async(c,p)=>{await p.goto(url('frontend/network/index.html'));},async p=>{
      await p.waitForSelector('.network-nodes g');assert.equal(await p.inputValue('#network-scope'),'catalogue');
    });
    await checkIsolated(async(c,p)=>{await c.addInitScript(()=>{Object.defineProperty(window,'sessionStorage',{get(){throw new Error('disabled')}})});await p.goto(url(''));},async p=>{
      await p.waitForSelector('.dust-node');assert.match(await p.locator('[data-dust-notice]').innerText(),/unavailable/);
      await p.locator('.dust-node').first().focus();await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>AnivizMain.snapshot().selectedKeys.length),1);
    });
    for(const kind of ['metadata','matrix']) {
      await checkIsolated(async(c,p)=>{
        await c.route(kind==='metadata'?'**/data.json':'**/movie_anime_scores.bin',route=>route.fulfill({status:503,body:'Unavailable'}));
        await p.goto(url(''));
      },async p=>{
        if(kind==='metadata') {
          await p.waitForSelector('.dust-node');await p.waitForFunction(()=>AnivizMain.snapshot().metadataStatus==='unavailable');
          assert.equal(await p.evaluate(()=>AnivizMain.snapshot().ranking.length),1000);
          assert.match(await p.locator('[data-coverage="reception"]').innerText(),/unavailable/);
        } else {
          await p.waitForSelector('#dust-retry');assert.equal(await p.locator('.dust-node').count(),0);
          assert.equal(await p.evaluate(()=>AnivizMain.snapshot().ranking.length),0);
          await p.context().unroute('**/movie_anime_scores.bin');await p.locator('#dust-retry').click();await p.waitForSelector('.dust-node');
        }
      });
    }

    // Same movies/count/filters at three viewports, with document scrolling and named overflow regions.
    await page.evaluate(()=>sessionStorage.removeItem('aniviz-catalogue-filters'));
    for(const [width,height] of [[1440,900],[1280,720],[390,844]]) {
      await page.setViewportSize({width,height});await page.goto(url('frontend/dust-magnet/index.html'));await dustReady();
      await page.evaluate(()=>scrollTo(0,0));await overflow();
      await fieldOptions.locator('summary').click();await assertVisibleFilters();await overflow();
      await fieldOptions.locator('summary').click();
      if(output) {fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,`verified-dust-${width}.png`)});}
      for(const kind of ['connections','reception','genres','years','studios','heatmap']) {
        await page.locator(`[data-dust-chart="${kind}"]`).scrollIntoViewIfNeeded();await overflow();
      }
      for(const view of ['network','story','explorer']) {
        await page.goto(url(`frontend/${view}/index.html`));
        await page.waitForSelector(view==='network'?'.network-nodes g':view==='story'?'#history-pair':'#anime-table-body tr');
        await overflow();
        if(output) await page.screenshot({path:path.join(output,`verified-${view}-${width}.png`)});
      }
    }
    const touch=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    const phone=await touch.newPage();await phone.goto(url(''));await phone.waitForSelector('.dust-node');
    await phone.locator('.dust-node').first().tap();await phone.locator('.dust-node').nth(1).tap();
    assert.equal(await phone.evaluate(()=>AnivizMain.snapshot().selectedKeys.length),2);
    const box=await phone.locator('#recommendation-chart').boundingBox();
    await phone.evaluate(({x,y})=>{window.testTouchStart={x,y,scroll:scrollY}},box);
    const client=await touch.newCDPSession(phone);
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width-10,y:box.y+box.height-50}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width-10,y:box.y+box.height-250}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await phone.waitForFunction(()=>scrollY>0);assert.equal(await phone.evaluate(()=>AnivizMain.snapshot().selectedKeys.length),2);
    await touch.close();
    assert.deepEqual(errors,[]);
    console.log('Passed real-browser checks: four views, scopes, filters, ranking, selection, history/scroll restoration, legacy routes, migration, loading/storage failures, desktop/mobile layouts and touch scrolling.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
