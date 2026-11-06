const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { createContext } = require('../frontend/common/dust-context.js');
const { getDustMatches } = require('../frontend/recommendations/dust-magnet.js');
const ChartData = require('../frontend/common/chart-data.js');

function fixture() {
  const notices = [];
  const data = { movies: [{id:'a',title:'First'}, {id:'b',title:'Second'}],
    anime: Array.from({length:5}, (_, i) => ({id:String(i),title:`Title ${i}`,genres:['Action']})) };
  const context = createContext({getDustMatches, onNotice: text => notices.push(text),
    storage: {getItem: () => null, setItem() {}}});
  context.setSources(data, Float32Array.from([.5,.4,.3,.2,.1, -.1,.2,.3,.4,.5]));
  context.setMetadata([{id:0,episodes:12,duration:24,average_score:80,format:'TV',year:2000,status:'FINISHED'},
    {id:1,episodes:1,duration:90,average_score:90,format:'MOVIE',year:2001,status:'FINISHED'}]);
  context.setMovies(['a','b']);
  return {context, data, notices};
}

test('direct selection toggles, caps at three without replacement, and leaves analytical evidence unchanged', () => {
  const {context,notices} = fixture(), before = context.snapshot();
  for (const id of ['0','1','2']) context.toggleSelection(id);
  const revision = context.snapshot().revision;
  context.toggleSelection('3');
  assert.deepEqual(context.snapshot().selectedAnimeIds,['0','1','2']);
  assert.equal(context.snapshot().revision,revision);
  assert.match(notices.at(-1),/up to 3 anime/);
  context.toggleSelection('1');
  assert.deepEqual(context.snapshot().selectedAnimeIds,['0','2']);
  context.toggleSelection('3');
  assert.deepEqual(context.snapshot().selectedAnimeIds,['0','2','3']);
  context.toggleSelection('not displayed');
  context.resetPositions();
  assert.deepEqual(context.snapshot().selectedAnimeIds,['0','2','3']);
  assert.deepEqual(context.snapshot().displayedDustIds,before.displayedDustIds);
  assert.deepEqual(context.snapshot().perMovieScores,before.perMovieScores);
  assert.deepEqual(context.snapshot().ranking,before.ranking);
  context.setSelection([]);
  assert.deepEqual(context.snapshot().selectedAnimeIds,[]);
});

function renderDetails(context, data, externalId) {
  const sandbox = vm.createContext({AnivizChartData:ChartData});
  vm.runInContext(readFileSync(require.resolve('../frontend/common/dust-details.js'),'utf8'),sandbox);
  const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  return sandbox.AnivizDustDetails.render({snapshot:context.snapshot(), movies:data.movies, externalId,
    color:()=>'#fff',helpers:{escapeHTML:escape,escapeAttribute:escape,humanize:String,formatNumber:String}});
}

test('inline details omit empty panels and compare metadata and every movie on shared scales', () => {
  const {context,data} = fixture();
  assert.equal(renderDetails(context,data).html,'');
  context.toggleSelection('0');
  let result = renderDetails(context,data);
  assert.equal(result.count,1);
  assert.match(result.html,/Title 0/);
  assert.match(result.focusHtml,/Storyline/);
  assert.match(result.focusHtml,/Story tags/);
  assert.match(result.focusHtml,/Japanese sampled voice credits/);
  assert.doesNotMatch(result.html,/Synopsis|Storyline|Story tags|sampled cast|voice credits/);
  context.toggleSelection('1');
  result = renderDetails(context,data);
  assert.equal(result.count,2);
  assert.match(result.html,/Comparing 2 anime/);
  assert.match(result.focusHtml, /<h3[^>]*>Title 1<\/h3>/);
  assert.doesNotMatch(result.html,/Synopsis|Storyline|Story tags|sampled cast|voice credits/);
  assert.match(result.html,/max="288" value="288"/);
  assert.match(result.html,/max="288" value="90"/);
  assert.match(result.html,/max="100" value="80"/);
  assert.match(result.html,/max="100" value="90"/);
  assert.match(result.html,/M1 · First/); assert.match(result.html,/M2 · Second/);
  assert.match(result.html,/min="-1" max="1" value="-0\.1/);
  assert.match(result.html,/Average cosine similarity/);
  assert.doesNotMatch(result.html,/Similarity rank|single-seed/);
});

test('ranking inspection cannot add inline evidence or change the dust comparison', () => {
  const {context,data} = fixture();
  context.toggleSelection('0'); context.toggleSelection('1');
  context.setFilters({yearFrom:2000}); // Records with unknown years leave the displayed set.
  const before = context.snapshot();
  const result = renderDetails(context,data,'4');
  assert.match(result.html,/Comparing 2 anime/);
  assert.equal(result.html, renderDetails(context,data).html);
  assert.doesNotMatch(result.html,/outside the displayed dust set|Ranking anime details|Title 4/);
  assert.doesNotMatch(result.html,/Unknown min|Unknown \/ 100/);
  assert.deepEqual(context.snapshot().selectedAnimeIds,before.selectedAnimeIds);
  assert.deepEqual(context.snapshot().displayedDustIds,before.displayedDustIds);
  assert.equal(context.snapshot().revision,before.revision);
});


test('focus uses the latest selected anime with catalogue images, and falls back after removing it', () => {
  const {context, data} = fixture();
  context.setMetadata([{id:0, title:'First anime', description:'First storyline', cover:{large:'https://example.com/cover.jpg'}, banner_image:'https://example.com/banner.jpg',
    voice_actors:[{name:'Actor',characters:['Character']}]}]);
  context.toggleSelection('0');
  let result = renderDetails(context,data);
  assert.match(result.focusHtml,/src="https:\/\/example.com\/cover.jpg"/);
  assert.match(result.focusHtml,/src="https:\/\/example.com\/banner.jpg"/);
  assert.match(result.focusHtml,/First storyline/);
  assert.match(result.focusHtml,/Actor — Character/);
  context.toggleSelection('1');
  result = renderDetails(context,data);
  assert.match(result.focusHtml,/<h3[^>]*>Title 1<\/h3>/);
  assert.doesNotMatch(result.focusHtml,/First storyline|src=""/);
  context.toggleSelection('1');
  assert.match(renderDetails(context,data).focusHtml,/First storyline/);
  context.setSelection([]);
  result = renderDetails(context,data);
  assert.match(result.focusHtml,/Every dot has a story/);
  assert.equal(result.html,'');
});
