const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('../frontend/common/redirect.js');
const vm=require('node:vm');

test('all legacy aliases resolve directly to four valid destinations and main scroll sections',()=>{
  const expected={intro:'dust-magnet',recommendations:'dust-magnet','dust-magnet':'dust-magnet',
    content:'dust-magnet/index.html#content',creators:'dust-magnet/index.html#creators',
    reception:'dust-magnet/index.html#reception',story:'story',history:'story',explorer:'explorer',catalogue:'explorer',network:'network'};
  for(const [alias,route] of Object.entries(expected)) {
    const target=route.includes('/')?`../${route}`:`../${route}/index.html${['explorer','catalogue'].includes(alias)?'?mode=catalogue':''}`;
    assert.equal(resolve(null,'',`#${alias}`),target,alias);
    assert.equal(resolve(alias),target,alias);
  }
  assert.equal(resolve(null,'','#unknown'),'../dust-magnet/index.html');
  assert.equal(resolve(null),'../dust-magnet/index.html');
  for(const hash of ['#network','#network-chart','#tab-network','#collaboration','#collaboration-structure'])
    assert.equal(resolve('creators','',hash),'../network/index.html');
});

test('legacy modes resolve to new scopes, with unrelated query parameters preserved',()=>{
  for(const mode of ['matches','catalogue','invalid']) {
    assert.equal(resolve('explorer',`?mode=${mode}&shared=1`),'../explorer/index.html?shared=1&mode=catalogue');
    assert.equal(resolve('content',`?mode=${mode}&shared=1`),'../dust-magnet/index.html?shared=1#content');
  }
  assert.equal(resolve('creators','?mode=catalogue','#network'),'../network/index.html?scope=catalogue');
  assert.equal(resolve('creators','?mode=matches','#network'),'../network/index.html?scope=dust');
});

test('browser redirects retain project subpaths and never target another redirect stub',()=>{
  const source=readFileSync(require.resolve('../frontend/common/redirect.js'),'utf8');
  for(const prefix of ['/','/anime_viz_project/']) for(const entry of [undefined,'content','creators','reception','recommendations']) {
    let target;
    vm.runInNewContext(source,{URL,URLSearchParams,
      location:{hash:entry?'#network':'#content',search:'?shared=1',replace:url=>target=url.href},
      document:{currentScript:{src:`https://example.com${prefix}frontend/common/redirect.js`,dataset:{route:entry}}}});
    const relative=resolve(entry,'?shared=1',entry?'#network':'#content');
    assert.equal(target,new URL(relative,`https://example.com${prefix}frontend/common/redirect.js`).href);
    assert.match(target,/frontend\/(?:dust-magnet|network)\/index.html/);
  }
});

test('root and old static pages provide relative no-JavaScript fallbacks',()=>{
  for(const [page,anchor] of [['intro',''],['recommendations',''],['content','#content'],['creators','#creators'],['reception','#reception']]) {
    const html=readFileSync(require.resolve(`../frontend/${page}/index.html`),'utf8');
    assert.ok(html.includes(`<noscript><meta http-equiv="refresh" content="0; url=../dust-magnet/index.html${anchor}"></noscript>`));
    assert.ok(html.includes(`href="../dust-magnet/index.html${anchor}"`));
    assert.doesNotMatch(html,/data-view-menu|id="filterbar"|src="app.js"/);
  }
  assert.match(readFileSync(require.resolve('../index.html'),'utf8'),/<noscript><meta http-equiv="refresh" content="0; url=frontend\/dust-magnet\/index.html"><\/noscript>/);
  const main=readFileSync(require.resolve('../frontend/dust-magnet/index.html'),'utf8');
  for(const id of ['content','creators','reception']) assert.ok(main.includes(`id="${id}"`));
});
