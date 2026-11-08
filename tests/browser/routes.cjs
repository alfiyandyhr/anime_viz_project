const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=(process.env.ANIVIZ_BASE_URL||'http://127.0.0.1:8765/').replace(/\/?$/,'/');
const url=route=>new URL(route,base).href;
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    for(const [route,section] of [['#content','content'],['frontend/reception/index.html?mode=catalogue','reception'],['frontend/creators/index.html?mode=matches','creators']]) {
      await page.goto(url(route));await page.waitForSelector('.dust-node');
      assert.equal(await page.locator('#recommendation-chart .dust-node').count(),60);
      assert.equal(new URL(page.url()).pathname,new URL(`frontend/dust-magnet/index.html`,base).pathname);
      assert.equal(new URL(page.url()).hash,`#${section}`);
      await page.waitForFunction(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.top>=48&&r.top<innerHeight/2},section);
    }
    await page.goto(url('frontend/creators/index.html?mode=catalogue#network-chart'));await page.waitForSelector('.network-nodes g');
    assert.equal(await page.inputValue('#network-scope'),'catalogue');
    await page.goto(url('frontend/explorer/index.html?mode=matches'));await page.waitForSelector('#anime-table-body tr');
    assert.equal(await page.evaluate(()=>state.filteredAnime.length),1000);
    await page.goto(url('frontend/story/index.html'));await page.waitForSelector('.poster-card');
    const nojs=await browser.newContext({javaScriptEnabled:false});const fallback=await nojs.newPage();
    await fallback.goto(url(''));await fallback.waitForURL('**/frontend/dust-magnet/index.html');
    await fallback.goto(url('frontend/content/index.html'));await fallback.waitForURL('**/frontend/dust-magnet/index.html#content');
    await nojs.close();
    if(process.env.ANIVIZ_FLASK==='1') {
      for(const route of ['content?mode=matches','creators?mode=catalogue#network-chart','history','catalogue?mode=matches']) {
        await page.goto(url(route));
        await page.waitForSelector(route.startsWith('content')?'.dust-node':route.startsWith('creators')?'.network-nodes g':route==='history'?'.poster-card':'#anime-table-body tr');
      }
    }
    assert.deepEqual(errors,[]);console.log(`Passed relative assets, legacy routes, independent direct views and no-JavaScript fallbacks at ${base}`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
