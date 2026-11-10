const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createContext, joinRecords, rankCorpus, createScoreAccessor, FORWARD, REVERSE, STORAGE_KEY } = require('../frontend/common/dust-context.js');
const ChartData = require('../frontend/common/chart-data.js');
const { getDustMatches } = require('../frontend/recommendations/dust-magnet.js');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(readFileSync(path.join(root, 'data/movie_recommendations.json')));
const dashboard = JSON.parse(readFileSync(path.join(root, 'data.json')));
const bytes = readFileSync(path.join(root, 'data/movie_anime_scores.bin'));
const scores = Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
const movies = ['Inception', 'Interstellar', 'The Matrix'].map(title => data.movies.find(movie => movie.title === title).id);
const tmdb = id => `tmdb:${id}`;
const anilist = id => `anilist:${id}`;
const movieKeys = movies.map(tmdb);
function setup() {
  const memory = new Map([['aniviz-catalogue-filters', 'catalogue state'], ['history-year', '1999']]);
  const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  const notices = [];
  const context = createContext({ storage, onNotice: message => notices.push(message) });
  context.setSources(data, scores); context.setMetadata(dashboard.anime); context.setMagnets(movieKeys);
  return { context, memory, storage, notices };
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
  const { context } = setup();
  const original = context.snapshot();
  assert.deepEqual(original.candidateKeys, getDustMatches(data, scores, movies, 60).map(row => anilist(row.anime.id)));
  assert.equal(original.ranking.length, 1000);
  const selected = original.displayedKeys[0];
  context.setSelection([selected]);
  assert.deepEqual(context.snapshot().displayedKeys, original.displayedKeys);
  const genre = original.lookup.get(selected).record.genres[0];
  context.setFilters({genre});
  const filtered = context.snapshot();
  assert.ok(filtered.displayedKeys.length > 0 && filtered.displayedKeys.length < 60);
  assert.deepEqual(filtered.candidateKeys, original.candidateKeys);
  assert.ok(filtered.displayedKeys.every(id => filtered.lookup.get(id).record.genres.includes(genre)));
  assert.equal(filtered.ranking.length, 1000);
  assert.deepEqual(filtered.ranking.filter(row => row.displayed).map(row => row.key).sort(), [...filtered.displayedKeys].sort());
  assert.equal(filtered.candidateDust, original.candidateDust);
  context.resetFilters(); assert.deepEqual(context.snapshot().displayedKeys, original.displayedKeys);
});
test('layout, hover-free snapshots, ranking sort and selection do not resample candidates', () => {
  const {context} = setup(); const before = context.snapshot();
  context.setSelection(before.displayedKeys.slice(0, 2));
  const revision = context.snapshot().revision;
  context.saveLayout({magnetPositions:{'3:movie':{x:.3,y:.7}},scrollY:1444});
  context.resetPositions();
  assert.equal(context.snapshot().revision, revision);
  for (const sort of [...movieKeys, 'average']) {
    context.setRankingSort(sort);
    assert.deepEqual(context.snapshot().candidateKeys, before.candidateKeys);
    assert.equal(context.snapshot().candidateDust, before.candidateDust);
    assert.deepEqual(context.snapshot().selectedKeys, before.displayedKeys.slice(0, 2));
  }
  assert.equal(context.getLayout().scrollY,1444);
});
test('selection retention follows displayed membership, count/movie changes resample once', () => {
  const {context,notices} = setup();
  context.setSelection(context.snapshot().displayedKeys.slice(0,3));
  context.setFilters({search:'no such title in this corpus'});
  assert.deepEqual(context.snapshot().selectedKeys,[]);
  assert.equal(context.snapshot().displayedKeys.length,0);
  assert.equal(context.snapshot().candidateKeys.length,60);
  assert.match(notices.at(-1),/no longer displayed/);
  context.resetFilters();
  context.setDustLimit(90);assert.equal(context.snapshot().candidateKeys.length,90);
  const retained=context.snapshot().displayedKeys.slice(0,2);context.setSelection(retained);
  context.setDustLimit(30);
  assert.deepEqual(context.snapshot().selectedKeys,retained.filter(id=>context.snapshot().displayedKeys.includes(id)));
  context.setRankingSort(movieKeys[1]);context.setMagnets([movieKeys[0]]);
  assert.equal(context.snapshot().rankingSortKey,'average');assert.equal(context.snapshot().ranking.length,1000);
  context.setMagnets([]);assert.equal(context.snapshot().candidateKeys.length,0);
});
test('missing metadata is distinct from filtered-out records and does not block similarity', () => {
  const {context} = setup();const before=context.snapshot();
  context.setMetadata([], 'unavailable'); const unavailable=context.snapshot();
  assert.deepEqual(unavailable.displayedKeys,before.displayedKeys);
  assert.equal(unavailable.missingMetadataIds.length,60);assert.equal(unavailable.filteredOutIds.length,0);
  assert.equal(unavailable.ranking.length,1000);
  const rows=unavailable.displayedKeys.map(id=>unavailable.lookup.get(id).record);
  assert.ok(ChartData.genres(rows).every(row=>row.averageScore===null && row.totalPopularity===null));
  context.setFilters({minimumScore:1});
  assert.equal(context.snapshot().displayedKeys.length,0);
  assert.equal(context.snapshot().missingMetadataIds.length,60);
  assert.equal(context.snapshot().filteredOutIds.length,60);
});
test('versioned session round trip restores movies, filters, selections and independent layout', () => {
  const {context,memory,storage} = setup(); const chosen=context.snapshot().displayedKeys[0];
  context.setSelection([chosen]);context.setRankingSort(movieKeys[2]);
  context.setFilters({genre:context.snapshot().lookup.get(chosen).record.genres[0]});
  context.saveLayout({magnetPositions:{a:{x:.4,y:.2}},scrollY:876,particles:{width:800,height:500,positions:[]}});
  const restored=createContext({storage}); assert.equal(restored.restore(),true);
  restored.setMetadata(dashboard.anime);restored.setSources(data,scores);
  assert.deepEqual(restored.snapshot().magnetKeys,movieKeys);assert.deepEqual(restored.snapshot().selectedKeys,[chosen]);
  assert.equal(restored.snapshot().rankingSortKey,movieKeys[2]);assert.equal(restored.getLayout().scrollY,876);
  assert.deepEqual(restored.snapshot().filters,context.snapshot().filters);
  assert.deepEqual(restored.snapshot().displayedKeys,context.snapshot().displayedKeys);
  assert.equal(memory.get('aniviz-catalogue-filters'),'catalogue state');assert.equal(memory.get('history-year'),'1999');
  memory.set(STORAGE_KEY,JSON.stringify({version:999,state:{movieIds:movies}}));
  assert.equal(createContext({storage}).restore(),false);
});
test('storage denial preserves in-memory context and emits one relevant notice', () => {
  const notices=[]; const context=createContext({onNotice:m=>notices.push(m),storage:{getItem(){throw Error('disabled')},setItem(){throw Error('disabled')}}});
  context.restore();context.setSources(data,scores);context.setMagnets(movieKeys);context.setFilters({genre:'Action'});
  assert.ok(context.snapshot().displayedKeys.length>0);assert.equal(context.snapshot().persistent,false);
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
  context.setFilters({minimumScore:70});const chosen=context.snapshot().displayedKeys[0];context.setSelection([chosen]);
  const restored=createContext({storage});restored.restore();restored.setSources(data,scores);
  assert.equal(restored.snapshot().displayedKeys.length,0, 'unknown ratings cannot pass a score filter');
  assert.deepEqual(restored.snapshot().selectedKeys,[chosen], 'pending metadata is not a completed membership change');
  restored.setMetadata(dashboard.anime);
  assert.ok(restored.snapshot().displayedKeys.includes(chosen));assert.deepEqual(restored.snapshot().selectedKeys,[chosen]);
});
test('numeric movie IDs normalize before candidate lookup and silent storage rejection reports persistence loss', () => {
  const fixture={movies:[{id:1}],anime:[{id:1},{id:2}]};
  const notices=[];const context=createContext({onNotice:m=>notices.push(m),storage:{getItem:()=>null,setItem(){}}});
  context.setSources(fixture,Float32Array.from([-.1,.5]));context.setMagnets([tmdb(1)]);
  assert.equal(context.snapshot().candidateKeys.length,2);assert.deepEqual(context.snapshot().magnetKeys,['tmdb:1']);
  assert.equal(context.snapshot().persistent,false);assert.equal(notices.length,1);
});

test('withdrawing a score source clears stale dust membership and full ranking', () => {
  const {context}=setup();assert.equal(context.snapshot().displayedKeys.length,60);
  context.setSources(data,null);
  assert.deepEqual(context.snapshot().candidateKeys,[]);assert.deepEqual(context.snapshot().displayedKeys,[]);
  assert.deepEqual(context.snapshot().ranking,[]);
  context.setSources(data,scores);assert.equal(context.snapshot().candidateKeys.length,60);
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
  const context=createContext({storage});
  assert.equal(context.restore(),false);
  context.setMetadata(dashboard.anime); // Metadata may arrive before similarity JSON.
  assert.equal(context.migrateLegacy(data),true);
  context.setMetadata(dashboard.anime);context.setSources(data,scores);
  const s=context.snapshot();
  assert.deepEqual(s.magnetKeys,[movieKeys[1]]);
  assert.deepEqual(s.displayedKeys,getDustMatches(data,scores,[movies[1]],60).map(row=>anilist(row.anime.id)));
  assert.equal(s.displayedKeys.length,60);assert.equal(s.displayedKeys.includes('invented-old-id'),false);
  assert.deepEqual(s.selectedKeys,[]);assert.equal(s.filters.search,'');
  assert.equal(memory.get('aniviz-catalogue-filters'),'independent catalogue');
  const restored=createContext({storage});assert.equal(restored.restore(),true);
  assert.equal(restored.migrateLegacy(data),false,'versioned session wins over obsolete seed');
  restored.setMetadata(dashboard.anime);restored.setSources(data,scores);restored.setMagnets([]);
  const empty=createContext({storage});assert.equal(empty.restore(),true);
  assert.equal(empty.migrateLegacy(data),false);assert.deepEqual(empty.snapshot().magnetKeys,[],'explicit empty state survives');
});

test('unresolvable legacy seeds cannot import old IDs; missing Top-20 IDs do not prevent seed recovery', () => {
  for(const raw of ['null','{bad',JSON.stringify({tmdbId:'unknown'}),JSON.stringify({tmdbId:movies[0]})]) {
    const memory=new Map([['aniviz_seed_movie',raw]]);
    const notices=[];
    const context=createContext({onNotice:notice=>notices.push(notice),storage:{getItem:key=>memory.get(key)||null,setItem:(k,v)=>memory.set(k,v)}});
    const valid=raw.includes(movies[0]);assert.equal(context.migrateLegacy(data),valid);
    assert.deepEqual(notices,[],'malformed seed data is distinct from denied storage');
    context.setSources(data,scores);assert.equal(context.snapshot().candidateKeys.length,valid?60:0);
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
  const {context}=setup();const initial=context.snapshot();
  const title=initial.lookup.get(initial.displayedKeys[0]).record;
  for(const patch of [{search:title.title},{genre:title.genres[0]},{studio:title.studio_names[0]},
    {format:title.format},{yearFrom:title.year,yearTo:title.year},{minimumScore:title.average_score}]) {
    context.resetFilters();context.setFilters(patch);const s=context.snapshot();
    const expected=initial.candidateKeys.filter(key=>require('../frontend/common/dust-context.js').passesFilters(s.lookup.get(key).record,s.filters));
    assert.deepEqual(s.displayedKeys,expected);
    const rows=s.displayedKeys.map(key=>s.lookup.get(key).record), allowed=new Set(rows.map(row=>row.id));
    for(const aggregate of [...ChartData.genres(rows),...ChartData.studios(rows)]) assert.ok(aggregate.ids.every(key=>allowed.has(key)));
    assert.equal(ChartData.timeline(rows).reduce((n,row)=>n+row.count,0),rows.filter(row=>Number.isFinite(row.year)).length);
    assert.equal(s.ranking.length,1000);
  }
  assert.equal(context.snapshot().candidateDust,initial.candidateDust);
  context.setFilters({search:'no possible title'});
  for(const count of [30,60,90]) {context.setDustLimit(count);assert.equal(context.snapshot().candidateKeys.length,count);assert.equal(context.snapshot().displayedKeys.length,0);}
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

test('forward sampling, cosine vectors, ranks and filters match the alfi 3342eb3 fixture', () => {
  for (const fixture of require('./fixtures/dust-forward-3342eb3.json')) {
    const { context } = setup();
    context.setMagnets(fixture.movieIds.map(tmdb));
    context.setDustLimit(fixture.limit);
    const original = context.snapshot();
    assert.deepEqual(original.candidateDust.map(row => [row.record.id, row.rank, ...row.scores]), fixture.candidates);
    assert.deepEqual(original.displayedKeys, fixture.displayed.map(anilist));
    for (const [basis, expected] of Object.entries(fixture.ranking)) {
      const { ranking } = context.setRankingSort(basis === 'average' ? basis : tmdb(basis));
      assert.deepEqual(ranking.map(row => row.record.id), expected);
      assert.deepEqual(ranking.filter(row => row.displayed).map(row => row.record.id).sort(), fixture.displayed.slice().sort());
    }
    const filtered = context.setFilters(fixture.filters);
    assert.deepEqual(filtered.displayedKeys, fixture.filtered.map(anilist));
    assert.equal(filtered.candidateDust, original.candidateDust);
    for (const [basis, expected] of Object.entries(fixture.ranking)) {
      const { ranking } = context.setRankingSort(basis === 'average' ? basis : tmdb(basis));
      assert.deepEqual(ranking.map(row => row.record.id), expected);
      assert.deepEqual(ranking.filter(row => row.displayed).map(row => row.record.id).sort(), fixture.filtered.slice().sort());
    }
  }
});

test('a 2 × 3 movie-major fixture reads the correct row and column, including signed and tied scores', () => {
  const fixture = {
    movies: [{ id: 1, title: 'Movie One', aliases: ['Alternate One'], genres: ['Action'], year: 1999 }, { id: 2, title: 'Movie Two' }],
    anime: [{ id: 1, title: 'Attack on Titan' }, { id: 2, title: 'Anime Two' }, { id: 3, title: 'Anime Three' }]
  };
  const matrix = Float32Array.from([-.5, .25, -.5, -.5, .75, .125]);
  const pair = createScoreAccessor(fixture, matrix);
  assert.equal(pair('2', '3'), .125);
  assert.equal(pair(2, 2), .75);
  assert.equal(pair(3, 2), undefined);
  const context = createContext();
  context.setMetadata([]);
  context.setSources(fixture, matrix);
  const forward = context.setMagnets(['tmdb:1']);
  assert.deepEqual(forward.ranking.map(row => [row.key, row.score]), [['anilist:2', .25], ['anilist:1', -.5], ['anilist:3', -.5]]);
  context.toggleSelection('anilist:1');
  const reverse = context.setDirection(REVERSE);
  assert.deepEqual(reverse.magnetKeys, ['anilist:1']);
  assert.deepEqual(reverse.selectedKeys, []);
  assert.deepEqual(reverse.ranking.map(row => [row.key, row.score]), [['tmdb:1', -.5], ['tmdb:2', -.5]]);
  assert.equal(reverse.lookup.get('tmdb:1').record.title, 'Movie One');
  assert.equal(reverse.lookup.has('anilist:1'), false);
  assert.equal(reverse.candidateDust[0].scores, reverse.ranking[0].scores);
  assert.deepEqual(context.setFilters({ search: 'alternate', genre: 'Action', yearFrom: 1999,
    yearTo: 1999, minimumScore: 100 }).displayedKeys, ['tmdb:1']);
  assert.deepEqual(context.snapshot().candidateKeys, reverse.candidateKeys);
  assert.equal(context.setFilters({ search: 'Action' }).displayedKeys.length, 0, 'movie search uses title and alias only');
  context.resetFilters();
  context.toggleSelection('tmdb:1');
  assert.deepEqual(context.setDirection(FORWARD).selectedKeys, ['anilist:1']);
  assert.equal(context.snapshot().lookup.get('anilist:1').record.title, 'Attack on Titan');
});

test('published Attack on Titan column and Inception row agree, and Pacific Rim leads the reverse ranking', () => {
  const { context } = setup();
  const forward = context.setMagnets(['tmdb:27205']);
  assert.equal(forward.ranking.find(row => row.key === 'anilist:16498').score, 0.36754152178764343);
  const reverse = context.setDirection(REVERSE);
  assert.equal(reverse.example, true);
  assert.deepEqual(reverse.magnetKeys, ['anilist:16498']);
  assert.equal(reverse.ranking.find(row => row.key === 'tmdb:27205').score, 0.36754152178764343);
  assert.equal(reverse.ranking[0].record.title, 'Pacific Rim');
  assert.equal(reverse.ranking[0].score, 0.549102246761322);
});

test('genre cohorts average signed movie rows and anime columns, preserving ties and one vote per magnet', () => {
  const fixture = {
    movies: [{ id: 1, genres: ['Action', 'Action', 'Drama'] }, { id: 2, genres: ['Action'] }, { id: 3, genres: ['Comedy', 'Drama'] }],
    anime: [{ id: 1, genres: ['Action'] }, { id: 2, genres: ['Action'] }, { id: 3, genres: ['Sci-Fi'] }, { id: 4 }]
  };
  const matrix = [-.75, .25, .5, -.25, .25, -.75, .5, -.5, -.5, -.5, .75, .125];
  const context = createContext();
  context.setSources(fixture, matrix);
  const values = snapshot => snapshot.ranking.map(row => [row.key, row.score]);
  const actionMovies = 'tmdb:genre:Action';
  const actionAnime = 'anilist:genre:Action';
  const forward = context.setMagnets(['tmdb:genre:Empty', actionMovies, actionMovies]);
  assert.deepEqual(forward.magnetKeys, [actionMovies]);
  assert.deepEqual(forward.magnets[0].memberIds, [1, 2]);
  assert.deepEqual(values(forward), [['anilist:3', .5], ['anilist:1', -.25], ['anilist:2', -.25], ['anilist:4', -.375]]);
  const threeCohorts = [actionMovies, 'tmdb:genre:Comedy', 'tmdb:genre:Drama'];
  const allGenres = context.setMagnets([actionMovies, actionMovies, ...threeCohorts.slice(1), 'tmdb:1']);
  assert.deepEqual(allGenres.magnetKeys, threeCohorts);
  assert.deepEqual(allGenres.ranking.map(row => [row.key, row.scores, row.score]), [
    ['anilist:3', [.5, .75, .625], 1.875 / 3], ['anilist:4', [-.375, .125, -.0625], -.3125 / 3],
    ['anilist:2', [-.25, -.5, -.125], -.875 / 3], ['anilist:1', [-.25, -.5, -.625], -1.375 / 3]
  ]);
  const overlap = context.setMagnets([actionMovies, 'tmdb:1', 'tmdb:2', 'tmdb:3']);
  assert.deepEqual(overlap.magnetKeys, [actionMovies, 'tmdb:1', 'tmdb:2']);
  const mixed = context.setMagnets([actionMovies, 'tmdb:1']);
  assert.deepEqual(values(mixed), [['anilist:3', .5], ['anilist:2', 0], ['anilist:4', -.3125], ['anilist:1', -.5]]);
  context.setMetadata([{ id: 3, genres: ['Action'] }]);
  context.setDirection(REVERSE);
  const reverse = context.setMagnets([actionAnime, actionMovies]);
  assert.deepEqual(reverse.magnetKeys, [actionAnime]);
  assert.deepEqual(reverse.magnets[0].memberIds, [1, 2]);
  assert.deepEqual(values(reverse), [['tmdb:1', -.25], ['tmdb:2', -.25], ['tmdb:3', -.5]]);
});

test('cohort vectors are reused within a bundle and saved choices are revalidated by direction', () => {
  const { context, storage } = setup();
  const fixture = { movies: [{ id: 1, genres: ['Action'] }], anime: [{ id: 1, genres: ['Action'] }] };
  const actionMovies = 'tmdb:genre:Action', actionAnime = 'anilist:genre:Action';
  let reads = 0;
  const matrix = { get 0() { reads++; return .25; } };
  context.setSources(fixture, matrix);
  context.setMagnets([actionMovies]);
  assert.equal(reads, 1);
  context.setRankingSort(actionMovies);
  context.setFilters({ genre: 'Drama' });
  context.setDustLimit(90);
  context.setMagnets([]);
  context.setMagnets([actionMovies]);
  context.setRankingSort(actionMovies);
  assert.equal(reads, 1);
  context.setDirection(REVERSE);
  context.setMagnets([actionAnime]);
  const reverseReads = reads;
  context.setDirection(FORWARD);
  assert.equal(reads, reverseReads);
  assert.equal(context.snapshot().ranking[0].score, .25);
  assert.equal(context.setSources(fixture, [-.5]).ranking[0].score, -.5);

  const restored = createContext({ storage });
  assert.equal(restored.restore(), true);
  const restoredForward = restored.setSources(fixture, matrix);
  assert.deepEqual(restoredForward.magnetKeys, [actionMovies]);
  assert.equal(restoredForward.rankingSortKey, actionMovies);
  assert.deepEqual(restoredForward.displayedKeys, []);
  assert.deepEqual(restored.setDirection(REVERSE).magnetKeys, [actionAnime]);
  restored.setDirection(FORWARD);
  const unavailable = restored.setSources({ ...fixture, movies: [{ id: 1 }] }, matrix);
  assert.deepEqual(unavailable.genreCohorts, []);
  assert.deepEqual(unavailable.magnetKeys, []);
  assert.deepEqual(unavailable.ranking, []);
  assert.equal(unavailable.rankingSortKey, 'average');
});

test('published genre affinities match the matrix in both directions and change six Inception top-30 entries', () => {
  const { context } = setup();
  const inception = context.setMagnets(['tmdb:27205']).ranking;
  const scienceFiction = 'tmdb:genre:Science Fiction';
  const combined = context.setMagnets(['tmdb:27205', scienceFiction]);
  assert.equal(combined.magnets[1].memberIds.length, 214);
  const movieRows = data.movies.flatMap((movie, i) => movie.genres.includes('Science Fiction') ? [i] : []);
  for (const row of combined.ranking) {
    const mean = movieRows.reduce((sum, i) => sum + scores[i * data.anime.length + row.index], 0) / movieRows.length;
    assert.equal(row.scores[1], mean);
    assert.equal(row.score, (row.scores[0] + mean) / 2);
  }
  const originalTop = new Set(inception.slice(0, 30).map(row => row.key));
  assert.equal(combined.ranking.slice(0, 30).filter(row => !originalTop.has(row.key)).length, 6);
  context.setRankingSort(scienceFiction);
  assert.equal(context.setMagnets(['tmdb:27205']).rankingSortKey, 'average');
  assert.deepEqual(context.snapshot().ranking, inception);

  context.setDirection(REVERSE);
  const reverse = context.setMagnets(['anilist:genre:Sci-Fi']);
  const animeColumns = data.anime.flatMap((anime, i) => anime.genres.includes('Sci-Fi') ? [i] : []);
  assert.equal(reverse.magnets[0].memberIds.length, 165);
  for (const row of reverse.ranking) {
    const mean = animeColumns.reduce((sum, i) => sum + scores[row.index * data.anime.length + i], 0) / animeColumns.length;
    assert.equal(row.score, mean);
  }
  const filtered = context.setFilters({ genre: 'Science Fiction' });
  assert.ok(filtered.displayedKeys.length > 0 && filtered.displayedKeys.length < reverse.displayedKeys.length);
  assert.equal(filtered.candidateDust, reverse.candidateDust);
  assert.equal(filtered.magnets, reverse.magnets);
  const evidence = ({ ranking }) => ranking.map(({ key, score }) => [key, score]);
  assert.deepEqual(evidence(filtered), evidence(reverse));
  assert.deepEqual(evidence(context.setDustLimit(30)), evidence(reverse));
});

test('v1 imports typed selections, sorts and layouts and keeps both directions independent during loading', () => {
  const { context: initial } = setup();
  const selected = initial.snapshot().displayedKeys[0].slice('anilist:'.length);
  const v1 = {
    version: 1,
    state: { version: 1, movieIds: movies, selectedAnimeIds: [selected], rankingSortKey: movies[0],
      filters: { minimumScore: 70 }, displayedDustIds: ['stale'] },
    layout: { magnetPositions: { [`3:${movies[0]}`]: { x: .2, y: .4 } },
      movieColors: { [movies[0]]: '#43d9e6' }, scrollY: 450,
      particles: { width: 600, height: 450, positions: [{ anime: { id: selected }, x: 200, y: 100 }] } }
  };
  const memory = new Map([['aniviz-dust-session-v1', JSON.stringify(v1)]]);
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const context = createContext({ storage });
  assert.equal(context.restore(), true);
  context.setSources(data, null);
  assert.deepEqual(context.snapshot().magnetKeys, movieKeys);
  assert.deepEqual(context.snapshot().displayedKeys, []);
  assert.deepEqual(context.snapshot().selectedKeys, [anilist(selected)]);
  assert.deepEqual(context.getLayout().magnetPositions, { [`3:${movieKeys[0]}`]: { x: .2, y: .4 } });
  assert.deepEqual(context.getLayout().magnetColors, { [movieKeys[0]]: '#43d9e6' });
  assert.equal(context.getLayout().particles.positions[0].key, anilist(selected));
  assert.equal(context.getLayout().scrollY, 450);
  context.setDirection(REVERSE);
  const { displayedKeys: [selectedMovie], magnetKeys: [animeMagnet] } = context.setSources(data, scores);
  context.toggleSelection(selectedMovie);
  context.setRankingSort(animeMagnet);
  context.setRankingOrder('descending');
  context.saveLayout({ scrollY: 125 });
  const reverse = context.snapshot();
  context.setMetadata(dashboard.anime);
  assert.deepEqual(context.snapshot().displayedKeys, reverse.displayedKeys);
  assert.deepEqual(context.snapshot().selectedKeys, [selectedMovie]);
  const forward = context.setDirection(FORWARD);
  assert.deepEqual(forward.selectedKeys, [anilist(selected)]);
  assert.equal(forward.rankingSortKey, movieKeys[0]);
  assert.equal(forward.rankingOrder, 'ascending');
  assert.equal(context.getLayout().scrollY, 450);
  context.setMagnets([]);
  context.setDirection(REVERSE);
  const restored = createContext({ storage });
  assert.equal(restored.restore(), true);
  const saved = restored.setSources(data, scores);
  assert.equal(saved.direction, REVERSE);
  assert.deepEqual(saved.selectedKeys, [selectedMovie]);
  assert.equal(saved.rankingOrder, 'descending');
  assert.equal(restored.getLayout().scrollY, 125);
  assert.deepEqual(restored.setDirection(FORWARD).magnetKeys, []);
  assert.equal(memory.get('aniviz-dust-session-v1'), JSON.stringify(v1));
});

test('an explicitly empty v1 session takes priority over the legacy seed and example', () => {
  const values = {
    'aniviz-dust-session-v1': JSON.stringify({ version: 1, state: { version: 1, movieIds: [] } }),
    aniviz_seed_movie: JSON.stringify({ tmdbId: movies[0] })
  };
  const context = createContext({ storage: { getItem: key => values[key], setItem: (key, value) => { values[key] = value; } } });
  assert.equal(context.restore(), true);
  const snapshot = context.setSources(data, scores, { seedExample: true });
  assert.deepEqual(snapshot.magnetKeys, []);
  assert.equal(snapshot.example, false);
  assert.deepEqual(context.setDirection(REVERSE).magnetKeys, ['anilist:16498']);
  assert.deepEqual(context.setMagnets([]).magnetKeys, []);
  context.setDirection(FORWARD);
  assert.deepEqual(context.setDirection(REVERSE).magnetKeys, []);
});

test('popularity uses midranks on one shared sample and preserves raw sorts for missing titles', () => {
  const fixture = {
    movies: [{ id: 1, title: 'One', genres: ['Action'] }, { id: 2, title: 'Two', genres: ['Action'] }],
    anime: [1, 2, 3, 4].map(id => ({ id, title: String(id) }))
  };
  const matrix = Float32Array.of(-0.5, -0.5, 0.5, 1, 0, 0.5, -1, 1);
  const context = createContext();
  context.setSources(fixture, matrix);
  context.setMetadata([{ id: 1, popularity: 10 }, { id: 2, popularity: 20 }, { id: 3, popularity: 20 }]);
  const keys = ['tmdb:1', 'tmdb:genre:Action', 'anilist:popularity'];
  const mixed = context.setMagnets(keys);
  assert.equal(mixed.popularity.eligible, 3);
  assert.deepEqual(mixed.ranking.map(row => [row.key, row.scores, row.rawScores, row.rank]), [
    ['anilist:2', [0.25, 1, 0.75], [-0.5, 0, 20], 1],
    ['anilist:3', [1, 0.25, 0.75], [0.5, -0.25, 20], 2],
    ['anilist:1', [0.25, 0.25, 0], [-0.5, -0.25, 10], 3],
    ['anilist:4', [null, null, null], [1, 1, null], null]
  ]);
  assert.equal(mixed.ranking[0].score, 2 / 3);
  assert.equal(mixed.ranking[0].closest, 1);
  assert.equal(mixed.ranking[3].score, null);
  assert.equal(mixed.candidateDust.length, 3);
  context.setFilters({ search: '2' });
  context.setDustLimit(30);
  assert.deepEqual(context.snapshot().displayedKeys, ['anilist:2']);
  assert.deepEqual(context.snapshot().displayedDust[0].scores, [0.25, 1, 0.75]);
  const raw = context.setRankingSort('tmdb:1');
  assert.deepEqual(raw.ranking.map(row => [row.key, row.rank]), [
    ['anilist:4', 1], ['anilist:3', 2], ['anilist:1', 3], ['anilist:2', 4]
  ]);
  context.setMetadata([{ id: 3, popularity: 0 }]);
  assert.deepEqual(context.snapshot().candidateDust[0].scores, [0.5, 0.5, 0.5]);
  assert.equal(context.snapshot().candidateDust[0].closest, 0);
  const cosine = context.setMagnets(keys.slice(0, 2));
  assert.equal(cosine.mixed, false);
  assert.equal(cosine.ranking[0].score, 1);
  assert.equal(cosine.candidateDust.length, 4);
});

test('popularity sources, saved choices, and missing values remain independent by direction', () => {
  const { context, storage } = setup();
  const scienceFiction = 'tmdb:genre:Science Fiction';
  const forwardKeys = ['tmdb:27205', scienceFiction, 'anilist:popularity'];
  const forward = context.setMagnets(forwardKeys);
  assert.equal(forward.popularity.eligible, 997);
  assert.equal(forward.ranking.filter(row => row.rank === null).length, 3);
  const inceptionRow = data.movies.findIndex(movie => movie.id === movies[0]) * data.anime.length;
  assert.ok(forward.candidateDust.every(row => row.rawScores[0] === scores[inceptionRow + row.index]));
  context.setDirection(REVERSE);
  const reverseKeys = ['anilist:1', 'tmdb:popularity'];
  context.setMagnets(reverseKeys);
  context.setRankingSort('tmdb:popularity');
  assert.equal(context.snapshot().ranking[0].key, 'tmdb:9016');

  const restored = createContext({ storage });
  assert.ok(restored.restore());
  restored.setSources(data, scores);
  assert.deepEqual(restored.snapshot().magnetKeys, reverseKeys);
  assert.deepEqual(restored.snapshot().activeMagnetKeys, ['anilist:1']);
  const { popularity } = require('../data/movie_popularity.json');
  const ids = data.movies.slice(0, 3).map(movie => String(movie.id));
  const unavailable = restored.setMoviePopularity(null, 'unavailable');
  assert.deepEqual(unavailable.magnetKeys, reverseKeys);
  assert.equal(unavailable.mixed, false);
  const tied = restored.setMoviePopularity({ popularity: { [ids[0]]: 8, [ids[1]]: 8, [ids[2]]: null } }, 'ready');
  assert.deepEqual(tied.ranking.slice(0, 3).map(row => [row.key, row.scores[1], row.rank]), [
    [tmdb(ids[0]), 0.5, 1], [tmdb(ids[1]), 0.5, 2], [tmdb(ids[2]), null, null]
  ]);
  const reverse = restored.setMoviePopularity({ popularity }, 'ready');
  assert.equal(reverse.popularity.eligible, 1000);
  const selected = reverse.displayedKeys[0];
  restored.setSelection([selected]);
  const missing = restored.setDirection(FORWARD);
  assert.deepEqual(missing.magnetKeys, forwardKeys);
  assert.equal(missing.mixed, false);
  restored.setMetadata(dashboard.anime);
  assert.deepEqual(restored.snapshot().ranking, forward.ranking);
  assert.deepEqual(restored.setDirection(REVERSE).selectedKeys, [selected]);
});
