const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createContext, joinRecords, rankCorpus, STORAGE_KEY } = require('../frontend/common/dust-context.js');
const ChartData = require('../frontend/common/chart-data.js');
const { getDustMatches } = require('../frontend/recommendations/dust-magnet.js');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(readFileSync(path.join(root, 'data/movie_recommendations.json')));
const dashboard = JSON.parse(readFileSync(path.join(root, 'data.json')));
const bytes = readFileSync(path.join(root, 'data/movie_anime_scores.bin'));
const scores = Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
const movies = ['Inception', 'Interstellar', 'The Matrix'].map(title => data.movies.find(movie => movie.title === title).id);
function setup() {
  const memory = new Map([['aniviz-catalogue-filters', 'catalogue state'], ['history-year', '1999']]);
  const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  const notices = []; let samples = 0;
  const context = createContext({ storage, onNotice: message => notices.push(message), getDustMatches(...args) { samples++; return getDustMatches(...args); } });
  context.setSources(data, scores); context.setMetadata(dashboard.anime); context.setMovies(movies);
  return { context, memory, storage, notices, samples: () => samples };
}
test('string ID joins preserve the real 997/1000 overlap and unknown metrics', () => {
  const lookup = joinRecords(data.anime, dashboard.anime);
  assert.equal(lookup.size, 1000);
  assert.equal([...lookup.values()].filter(row => row.metadata).length, 997);
  const missing = [...lookup.values()].filter(row => !row.metadata);
  assert.equal(missing.length, 3);
  for (const row of missing) {
    assert.equal(row.anime.average_score, null); assert.equal(row.anime.popularity, null);
    assert.ok(row.anime.title); assert.equal(typeof row.anime.id, 'string');
  }
  const fixture = joinRecords([{id:'1',title:'Present'},{id:'2',title:'Missing'}], [{id:1, average_score:0}]);
  assert.equal(fixture.get('1').anime.average_score, 0);
  assert.equal(fixture.get('2').anime.average_score, null);
});
test('three-movie 60-dot scope is shared, filters never refill, selection never scopes charts', () => {
  const { context, samples } = setup();
  const original = context.snapshot();
  assert.deepEqual(original.candidateDustIds, getDustMatches(data, scores, movies, 60).map(row => row.anime.id));
  assert.equal(original.ranking.length, 1000);
  const selected = original.displayedDustIds[0];
  context.setSelection([selected]);
  assert.deepEqual(context.snapshot().displayedDustIds, original.displayedDustIds);
  const genre = original.lookup.get(selected).anime.genres[0];
  context.setFilters({genre});
  const filtered = context.snapshot();
  assert.ok(filtered.displayedDustIds.length > 0 && filtered.displayedDustIds.length < 60);
  assert.deepEqual(filtered.candidateDustIds, original.candidateDustIds);
  assert.ok(filtered.displayedDustIds.every(id => filtered.lookup.get(id).anime.genres.includes(genre)));
  assert.equal(filtered.ranking.length, 1000);
  assert.deepEqual(filtered.ranking.filter(row => row.displayed).map(row => row.anime.id).sort(), [...filtered.displayedDustIds].sort());
  assert.equal(samples(), 2, 'initial empty sources and active movie set only');
  context.resetFilters(); assert.deepEqual(context.snapshot().displayedDustIds, original.displayedDustIds);
});
test('layout, hover-free snapshots, ranking sort and selection do not resample candidates', () => {
  const {context, samples} = setup(); const before = context.snapshot(), count = samples();
  context.setSelection(before.displayedDustIds.slice(0, 2));
  const revision = context.snapshot().revision;
  context.saveLayout({magnetPositions:{'3:movie':{x:.3,y:.7}},scrollY:1444});
  context.resetPositions();
  assert.equal(context.snapshot().revision, revision);
  for (const sort of [...movies, 'average']) {
    context.setRankingSort(sort);
    assert.deepEqual(context.snapshot().candidateDustIds, before.candidateDustIds);
    assert.deepEqual(context.snapshot().perMovieScores, before.perMovieScores);
    assert.deepEqual(context.snapshot().selectedAnimeIds, before.displayedDustIds.slice(0, 2));
  }
  assert.equal(samples(),count);
  assert.equal(context.getLayout().scrollY,1444);
});
test('selection retention follows displayed membership, count/movie changes resample once', () => {
  const {context,notices,samples} = setup();
  context.setSelection(context.snapshot().displayedDustIds.slice(0,3));
  context.setFilters({search:'no such title in this corpus'});
  assert.deepEqual(context.snapshot().selectedAnimeIds,[]);
  assert.equal(context.snapshot().displayedDustIds.length,0);
  assert.equal(context.snapshot().candidateDustIds.length,60);
  assert.match(notices.at(-1),/no longer displayed/);
  context.resetFilters(); const count=samples();
  context.setDustLimit(90);assert.equal(context.snapshot().candidateDustIds.length,90); assert.equal(samples(),count+1);
  const retained=context.snapshot().displayedDustIds.slice(0,2);context.setSelection(retained);
  context.setDustLimit(30);
  assert.deepEqual(context.snapshot().selectedAnimeIds,retained.filter(id=>context.snapshot().displayedDustIds.includes(id)));
  context.setRankingSort(movies[1]);context.setMovies([movies[0]]);
  assert.equal(context.snapshot().rankingSortKey,'average');assert.equal(context.snapshot().ranking.length,1000);
  context.setMovies([]);assert.equal(context.snapshot().candidateDustIds.length,0);
});
test('missing metadata is distinct from filtered-out records and does not block similarity', () => {
  const {context} = setup();const before=context.snapshot();
  context.setMetadata([], 'unavailable'); const unavailable=context.snapshot();
  assert.deepEqual(unavailable.displayedDustIds,before.displayedDustIds);
  assert.equal(unavailable.missingMetadataIds.length,60);assert.equal(unavailable.filteredOutIds.length,0);
  assert.equal(unavailable.ranking.length,1000);
  const rows=unavailable.displayedDustIds.map(id=>unavailable.lookup.get(id).anime);
  assert.ok(ChartData.genres(rows).every(row=>row.averageScore===null && row.totalPopularity===null));
  context.setFilters({minimumScore:1});
  assert.equal(context.snapshot().displayedDustIds.length,0);
  assert.equal(context.snapshot().missingMetadataIds.length,60);
  assert.equal(context.snapshot().filteredOutIds.length,60);
});
test('versioned session round trip restores movies, filters, selections and independent layout', () => {
  const {context,memory,storage} = setup(); const chosen=context.snapshot().displayedDustIds[0];
  context.setSelection([chosen]);context.setRankingSort(movies[2]);
  context.setFilters({genre:context.snapshot().lookup.get(chosen).anime.genres[0]});
  context.saveLayout({magnetPositions:{a:{x:.4,y:.2}},scrollY:876,particles:{width:800,height:500,positions:[]}});
  const restored=createContext({storage,getDustMatches}); assert.equal(restored.restore(),true);
  restored.setMetadata(dashboard.anime);restored.setSources(data,scores);
  assert.deepEqual(restored.snapshot().movieIds,movies);assert.deepEqual(restored.snapshot().selectedAnimeIds,[chosen]);
  assert.equal(restored.snapshot().rankingSortKey,movies[2]);assert.equal(restored.getLayout().scrollY,876);
  assert.deepEqual(restored.snapshot().filters,context.snapshot().filters);
  assert.deepEqual(restored.snapshot().displayedDustIds,context.snapshot().displayedDustIds);
  assert.equal(memory.get('aniviz-catalogue-filters'),'catalogue state');assert.equal(memory.get('history-year'),'1999');
  memory.set(STORAGE_KEY,JSON.stringify({version:999,state:{movieIds:movies}}));
  assert.equal(createContext({storage,getDustMatches}).restore(),false);
});
test('storage denial preserves in-memory context and emits one relevant notice', () => {
  const notices=[]; const context=createContext({getDustMatches,onNotice:m=>notices.push(m),storage:{getItem(){throw Error('disabled')},setItem(){throw Error('disabled')}}});
  context.restore();context.setSources(data,scores);context.setMovies(movies);context.setFilters({genre:'Action'});
  assert.ok(context.snapshot().displayedDustIds.length>0);assert.equal(context.snapshot().persistent,false);
  assert.equal(notices.length,1);
});
test('full-corpus sorts use exact signed scores, arithmetic averages and stable record-order ties', () => {
  const fixture={movies:[{id:'a'},{id:'b'},{id:'c'}],anime:[{id:'1'},{id:'2'},{id:'3'}]};
  const matrix=Float32Array.from([-.5,.5,.5, .5,-.5,-.5, .75,.25,.25]);
  for(let count=1;count<=3;count++) {
    const active=fixture.movies.slice(0,count).map(m=>m.id);
    for(const key of [...active,'average']) {
      const ranked=rankCorpus(fixture,matrix,active,key);
      for(const row of ranked) assert.equal(row.score,row.scores.reduce((a,b)=>a+b,0)/count);
      assert.ok(ranked.every((row,i)=>i===0||ranked[i-1].sortScore>=row.sortScore));
      const ties=ranked.filter(row=>row.anime.id!=='1');assert.deepEqual(ties.map(row=>row.anime.id),['2','3']);
    }
  }
  assert.deepEqual(rankCorpus(fixture,matrix,['a'],'a').map(row=>row.anime.id),['2','3','1']);
});
test('chart aggregates exclude unknown values per metric and highlight contributions without changing counts', () => {
  const anime=[{id:'1',genres:['Action'],studio_names:['A'],year:2000,average_score:80,popularity:10},
    {id:'2',genres:['Action','Mystery'],studio_names:['A'],year:2000,average_score:null,popularity:null}];
  const genres=ChartData.genres(anime,['2']);assert.equal(genres[0].count,2);assert.equal(genres[0].scoreCount,1);
  assert.equal(genres[0].averageScore,80);assert.equal(genres[0].selectedCount,1);
  assert.equal(genres[1].averageScore,null);assert.equal(genres[1].totalPopularity,null);
  assert.equal(ChartData.timeline(anime,['2'])[0].count,2);assert.equal(ChartData.studios(anime)[0].count,2);
  assert.equal(ChartData.correlation([[0,1],[1,2]]),null);assert.equal(ChartData.correlation([[0,1],[0,2],[0,3]]),null);
  assert.equal(ChartData.comparisonValues({episodes:null,duration:24}).runtime,null);
});
test('lazy composition discards stale marks, renders latest revision and disposes every instance', () => {
  const sandbox=vm.createContext({});vm.runInContext(readFileSync(path.join(root,'frontend/common/chart-composition.js'),'utf8'),sandbox);
  let callback, disconnected=false; const calls=[];
  const composition=sandbox.AnivizComposition.create({observerFactory:cb=>{callback=cb;return {observe(){},disconnect(){disconnected=true}}}});
  const a={replaceChildren(){calls.push('clear-a')}},b={replaceChildren(){calls.push('clear-b')}};
  composition.mount(a,{update:v=>calls.push(['a',v.revision]),pause:()=>calls.push('pause-a'),destroy:()=>calls.push('destroy-a')});
  composition.mount(b,{update:v=>calls.push(['b',v.revision]),destroy:()=>calls.push('destroy-b')});
  composition.update({revision:1});composition.update({revision:2});
  assert.ok(!calls.some(Array.isArray)); callback([{target:a,isIntersecting:true}]);
  assert.deepEqual(calls.at(-1),['a',2]); callback([{target:a,isIntersecting:false}]);
  composition.update({revision:3});callback([{target:a,isIntersecting:true},{target:b,isIntersecting:true}]);
  assert.deepEqual(calls.slice(-2),[['a',3],['b',3]]);
  composition.setActive(false);composition.update({revision:4});composition.setActive(true);
  assert.deepEqual(calls.slice(-2),[['a',4],['b',4]]);
  composition.destroy();assert.equal(disconnected,true);assert.deepEqual(calls.slice(-2),['destroy-a','destroy-b']);
});
test('resource caches share in-flight requests and isolate metadata failure from similarity/history', async () => {
  const counts=new Map();let metadataFails=true;
  const sandbox=vm.createContext({URL,document:{currentScript:{src:'https://example.com/repo/frontend/common/data-loader.js'}},fetch:async url=>{
    const name=new URL(url).pathname;counts.set(name,(counts.get(name)||0)+1);
    return {ok:!(name.endsWith('/data.json')&&metadataFails),status:503,json:async()=>name.endsWith('/data.json')?{anime:[],meta:{}}:{kind:name}};
  }});
  vm.runInContext(readFileSync(path.join(root,'frontend/common/data-loader.js'),'utf8'),sandbox);
  const loader=sandbox.AnivizData;
  assert.equal(loader.recommendations(),loader.recommendations());
  const result=await Promise.allSettled([loader.dashboard(),loader.recommendations(),loader.history()]);
  assert.equal(result[0].status,'rejected');assert.equal(result[1].status,'fulfilled');assert.equal(result[2].status,'fulfilled');
  metadataFails=false;await loader.dashboard();await loader.dashboard();
  assert.equal(counts.get('/repo/data.json'),2);assert.equal(counts.get('/repo/data/movie_recommendations.json'),1);
});
test('restoring a score-filtered selection waits for metadata rather than dropping it during loading', () => {
  const {context,storage}=setup();
  context.setFilters({minimumScore:70});const chosen=context.snapshot().displayedDustIds[0];context.setSelection([chosen]);
  const restored=createContext({storage,getDustMatches});restored.restore();restored.setSources(data,scores);
  assert.equal(restored.snapshot().displayedDustIds.length,0, 'unknown ratings cannot pass a score filter');
  assert.deepEqual(restored.snapshot().selectedAnimeIds,[chosen], 'pending metadata is not a completed membership change');
  restored.setMetadata(dashboard.anime);
  assert.ok(restored.snapshot().displayedDustIds.includes(chosen));assert.deepEqual(restored.snapshot().selectedAnimeIds,[chosen]);
});
test('numeric movie IDs normalize before candidate lookup and silent storage rejection reports persistence loss', () => {
  const fixture={movies:[{id:1}],anime:[{id:1},{id:2}]};
  const notices=[];const context=createContext({getDustMatches,onNotice:m=>notices.push(m),storage:{getItem:()=>null,setItem(){}}});
  context.setSources(fixture,Float32Array.from([-.1,.5]));context.setMovies([1]);
  assert.equal(context.snapshot().candidateDustIds.length,2);assert.deepEqual(context.snapshot().movieIds,['1']);
  assert.equal(context.snapshot().persistent,false);assert.equal(notices.length,1);
});

test('withdrawing a score source clears stale dust membership and full ranking', () => {
  const {context}=setup();assert.equal(context.snapshot().displayedDustIds.length,60);
  context.setSources(data,null);
  assert.deepEqual(context.snapshot().candidateDustIds,[]);assert.deepEqual(context.snapshot().displayedDustIds,[]);
  assert.deepEqual(context.snapshot().ranking,[]);
  context.setSources(data,scores);assert.equal(context.snapshot().candidateDustIds.length,60);
});

test('legacy Top-20 migration reuses only a resolvable seed and publishes newly computed 60-dot membership', () => {
  const memory=new Map([
    ['aniviz_seed_movie',JSON.stringify({tmdbId:movies[1],title:'Old title'})],
    ['aniviz_cohort_ids',JSON.stringify(['invented-old-id'])],
    ['aniviz_cohort_ranking',JSON.stringify({matches:[{id:'invented-old-id',score:1}]})],
    ['aniviz-filters',JSON.stringify({searchInput:'stale filter'})],
    ['aniviz-catalogue-filters','independent catalogue']
  ]);
  const storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
  const context=createContext({getDustMatches,storage});
  assert.equal(context.restore(),false);
  context.setMetadata(dashboard.anime); // Metadata may arrive before similarity JSON.
  assert.equal(context.migrateLegacy(data),true);
  context.setMetadata(dashboard.anime);context.setSources(data,scores);
  const s=context.snapshot();
  assert.deepEqual(s.movieIds,[movies[1]]);
  assert.deepEqual(s.displayedDustIds,getDustMatches(data,scores,[movies[1]],60).map(row=>String(row.anime.id)));
  assert.equal(s.displayedDustIds.length,60);assert.equal(s.displayedDustIds.includes('invented-old-id'),false);
  assert.deepEqual(s.selectedAnimeIds,[]);assert.equal(s.filters.search,'');
  assert.equal(memory.get('aniviz-catalogue-filters'),'independent catalogue');
  const restored=createContext({getDustMatches,storage});assert.equal(restored.restore(),true);
  assert.equal(restored.migrateLegacy(data),false,'versioned session wins over obsolete seed');
  restored.setMetadata(dashboard.anime);restored.setSources(data,scores);restored.setMovies([]);
  const empty=createContext({getDustMatches,storage});assert.equal(empty.restore(),true);
  assert.equal(empty.migrateLegacy(data),false);assert.deepEqual(empty.snapshot().movieIds,[],'explicit empty state survives');
});

test('unresolvable legacy seeds cannot import old IDs; missing Top-20 IDs do not prevent seed recovery', () => {
  for(const raw of ['null','{bad',JSON.stringify({tmdbId:'unknown'}),JSON.stringify({tmdbId:movies[0]})]) {
    const memory=new Map([['aniviz_seed_movie',raw]]);
    const notices=[];
    const context=createContext({getDustMatches,onNotice:notice=>notices.push(notice),storage:{getItem:key=>memory.get(key)||null,setItem:(k,v)=>memory.set(k,v)}});
    const valid=raw.includes(movies[0]);assert.equal(context.migrateLegacy(data),valid);
    assert.deepEqual(notices,[],'malformed seed data is distinct from denied storage');
    context.setSources(data,scores);assert.equal(context.snapshot().candidateDustIds.length,valid?60:0);
  }
});

test('reduced dataset-mismatch fixture preserves all recommendation records without substituting dashboard-only anime', () => {
  const fixture=require('./fixtures/catalogue-mismatch.json');
  const lookup=joinRecords(fixture.recommendations,fixture.metadata);
  assert.equal(lookup.size,4);assert.equal(lookup.get('1943').metadata.id,1943);
  for(const key of ['195516','195604','175872']) {
    assert.equal(lookup.get(key).metadata,null);assert.equal(lookup.get(key).anime.average_score,null);
  }
  assert.equal(lookup.has('4063'),false);assert.equal(lookup.has('20494'),false);assert.equal(lookup.has('228'),false);
  const rows=[...lookup.values()].map(row=>row.anime);
  assert.equal(ChartData.genres(rows).reduce((n,row)=>n+row.count,0),4);
  assert.equal(ChartData.studios(rows).reduce((n,row)=>n+row.count,0),1);
});

test('every filter narrows the same multi-movie candidate set used by aggregates; count changes respect filters', () => {
  const {context,samples}=setup();const initial=context.snapshot(), sampleCount=samples();
  const title=initial.lookup.get(initial.displayedDustIds[0]).anime;
  for(const patch of [{search:title.title},{genre:title.genres[0]},{studio:title.studio_names[0]},
    {format:title.format},{yearFrom:title.year,yearTo:title.year},{minimumScore:title.average_score}]) {
    context.resetFilters();context.setFilters(patch);const s=context.snapshot();
    const expected=initial.candidateDustIds.filter(key=>require('../frontend/common/dust-context.js').passesFilters(s.lookup.get(key).anime,s.filters));
    assert.deepEqual(s.displayedDustIds,expected);
    const rows=s.displayedDustIds.map(key=>s.lookup.get(key).anime), allowed=new Set(expected);
    for(const aggregate of [...ChartData.genres(rows),...ChartData.studios(rows)]) assert.ok(aggregate.ids.every(key=>allowed.has(key)));
    assert.equal(ChartData.timeline(rows).reduce((n,row)=>n+row.count,0),rows.filter(row=>Number.isFinite(row.year)).length);
    assert.equal(s.ranking.length,1000);
  }
  assert.equal(samples(),sampleCount);
  context.setFilters({search:'no possible title'});
  for(const count of [30,60,90]) {context.setDustLimit(count);assert.equal(context.snapshot().candidateDustIds.length,count);assert.equal(context.snapshot().displayedDustIds.length,0);}
});

test('ranking order has an independent oracle for all 1/2/3-movie bases, including tied and negative scores', () => {
  const fixture={movies:[{id:'a'},{id:'b'},{id:'c'}],anime:[{id:'x'},{id:'y'},{id:'z'}]};
  const matrix=Float32Array.from([-.5,.5,.5, .5,-.5,-.5, .75,.25,.25]);
  const expected={a:['y','z','x'],b:['x','y','z'],c:['x','y','z']};
  for(let count=1;count<=3;count++) {
    const active=['a','b','c'].slice(0,count);
    for(const basis of [...active,'average']) {
      const rows=rankCorpus(fixture,matrix,active,basis);
      assert.deepEqual(rows.map(row=>row.anime.id),basis==='average'?(count===1?expected.a:['x','y','z']):expected[basis]);
      for(const row of rows) assert.equal(row.score,row.scores.reduce((n,v)=>n+v,0)/count);
    }
  }
});
