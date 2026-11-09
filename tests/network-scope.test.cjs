const {test}=require('node:test');
const assert=require('node:assert/strict');
const {read,resolve}=require('../frontend/network/scope.js');
const storage=value=>({getItem:()=>JSON.stringify(value),setItem(){throw Error('Network must not write dust state');}});
const session=()=>({version:1,state:{version:1,movieIds:['movie'],candidateDustIds:['1','2','3'],displayedDustIds:[1,'2','2','outsider']},layout:{scrollY:1200}});
test('Network reads normalized displayed dust IDs, with no refill or session mutation',()=>{
 const saved=session(),before=JSON.stringify(saved);
 assert.deepEqual(read(storage(saved)),{ids:['1','2']});
 assert.equal(JSON.stringify(saved),before);
});
test('Network direct entry, invalid version, and storage failure use catalogue fallback',()=>{
 for(const saved of [null,{...session(),version:2},{version:1,state:{version:1,movieIds:[]}}])assert.equal(read(storage(saved)),null);
 assert.equal(read({getItem(){throw Error('Storage unavailable')}}),null);
 assert.equal(read({getItem:()=>'{bad'}),null);
});
test('Network scopes join string IDs to numeric metadata and report unavailable records separately',()=>{
 const anime=[{id:1,title:'One'},{id:3,title:'Three'},{id:4,title:'Catalogue only'}],before=JSON.stringify(anime),dust={ids:['1','2','3']};
 assert.deepEqual(resolve(anime,dust,'dust'),{anime:[anime[0],anime[1]],total:3,missing:1});
 assert.deepEqual(resolve(anime,dust,'catalogue'),{anime,total:3,missing:0});
 assert.equal(JSON.stringify(anime),before);
});
test('a filtered-to-empty current dust context stays empty; only absent context falls back to catalogue',()=>{
 const saved=session();saved.state.displayedDustIds=[];
 const dust=read(storage(saved)),anime=[{id:1}];
 assert.deepEqual(resolve(anime,dust,'dust'),{anime:[],total:0,missing:0});
 assert.deepEqual(resolve(anime,null,'dust'),{anime,total:1,missing:0});
});

test('a supported v2 session takes precedence over v1 and scopes only the active anime dust', () => {
  const state = { magnetKeys: ['tmdb:1'], candidateKeys: ['anilist:1','anilist:2','tmdb:2'],
    displayedKeys: ['anilist:1','anilist:1','tmdb:2','anilist:3'] };
  const v2 = { version: 2, direction: 'movie-to-anime', sessions: {
    'movie-to-anime': { state }, 'anime-to-movies': { state: { magnetKeys: ['anilist:1'], displayedKeys: ['tmdb:2'] } }
  } };
  const store = { getItem: key => JSON.stringify(key.endsWith('-v2') ? v2 : session()) };
  assert.deepEqual(read(store), { ids: ['1'] });
  state.displayedKeys = [];
  assert.deepEqual(read(store), { ids: [] });
  state.magnetKeys = [];
  assert.equal(read(store), null);
  v2.direction = 'anime-to-movies';
  assert.deepEqual(read(store), { movieDust: true });
  const anime = [{ id: 1 }];
  assert.deepEqual(resolve(anime, read(store), 'dust'), { anime, total: 1, missing: 0 });
});
