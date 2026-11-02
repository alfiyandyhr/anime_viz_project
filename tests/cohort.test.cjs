const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = file => readFileSync(path.join(__dirname, '..', file), 'utf8');

function dashboard(storage = new Map()) {
  const context = vm.createContext({
    URL, Intl, console,
    document: {
      currentScript: { src: 'https://example.com/frontend/common/app.js' },
      querySelector: () => ({}), addEventListener() {}
    },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    }
  });
  vm.runInContext(source('frontend/common/app.js'), context);
  return context;
}

function savedCohort() {
  return new Map([
    ['aniviz_seed_movie', JSON.stringify({ tmdbId: '27205', title: 'Inception', year: 2010 })],
    ['aniviz_cohort_ids', JSON.stringify(['1943', 43, '1943'])]
  ]);
}

test('cohort state normalizes IDs, deduplicates, restores scope, and tolerates missing scores', () => {
  const storage = savedCohort();
  const context = dashboard(storage);
  let cohort = vm.runInContext('readMovieCohort()', context);
  assert.deepEqual(Array.from(cohort.ids), ['1943', '43']);
  assert.equal(cohort.ranking, null);
  assert.equal(cohort.enabled, true);
  storage.set('aniviz_cohort_scope', 'catalogue');
  storage.set('aniviz_cohort_ranking', '{broken');
  cohort = vm.runInContext('readMovieCohort()', context);
  assert.equal(cohort.enabled, false);
  assert.equal(cohort.ranking, null);
  storage.set('aniviz_cohort_ids', JSON.stringify(Array.from({length: 30}, (_, i) => i + 1)));
  assert.equal(vm.runInContext('readMovieCohort().ids.length', context), 20);
  for (const ids of ['{bad', '[]', '[null]', '[{}]', '["oops"]']) {
    storage.set('aniviz_cohort_ids', ids);
    assert.equal(vm.runInContext('readMovieCohort()', context), null);
  }
  context.sessionStorage.getItem = () => { throw Error('Storage disabled'); };
  assert.equal(vm.runInContext('readMovieCohort()', context), null);
});

test('cohort IDs intersect every dashboard filter and catalogue mode removes only cohort scope', () => {
  const context = dashboard();
  vm.runInContext(`
    state.data = { anime: [
      {id: 1943, title: 'Paprika', year: 2006, average_score: 79, genres: ['Mystery'], studio_names: ['MADHOUSE'], format: 'MOVIE'},
      {id: 43, title: 'Ghost in the Shell', year: 1995, average_score: 80, genres: ['Sci-Fi'], studio_names: ['Production I.G'], format: 'MOVIE'},
      {id: 1, title: 'Other', year: 2000, average_score: 85, genres: ['Mystery'], studio_names: ['MADHOUSE'], format: 'TV'}
    ]};
    state.cohort = {ids: ['1943', '43', '999999']};
    state.cohort_ids = new Set(state.cohort.ids);
    for (const [key, value] of Object.entries({searchInput:'', genreFilter:'All', studioFilter:'All', formatFilter:'All', yearFrom:'1900', yearTo:'2030', scoreFilter:'0'})) elements[key] = {value};
    saveFilters = () => {};
    renderFilterSummary = () => {};
    renderPage = () => {};
    applyFilters();
  `, context);
  assert.deepEqual(Array.from(vm.runInContext('state.filteredAnime', context), work => work.id), [1943, 43]);
  assert.equal(vm.runInContext('cohortAnime().length', context), 2, 'missing dashboard records are not substituted');
  vm.runInContext('elements.genreFilter.value = "Mystery"; applyFilters()', context);
  assert.deepEqual(Array.from(vm.runInContext('state.filteredAnime', context), work => work.id), [1943]);
  vm.runInContext('state.cohort_ids = null; applyFilters()', context);
  assert.deepEqual(Array.from(vm.runInContext('state.filteredAnime', context), work => work.id), [1943, 1]);
});

test('selecting a movie saves its top 20 and exact ranking evidence before the matrix loads', () => {
  const storage = new Map([['aniviz-filters', '{"searchInput":"old search"}']]);
  const context = dashboard(storage);
  vm.runInContext(source('frontend/recommendations/app.js'), context);
  context.bundle = JSON.parse(source('data/movie_recommendations.json'));
  vm.runInContext(`
    recommendationState.data = bundle;
    recommendationState.movieId = bundle.movies.find(movie => movie.title === 'Inception').id;
    saveRecommendationCohort();
  `, context);
  assert.equal(storage.has('aniviz_cohort_ids'), false, 'default preview does not create a cohort');
  vm.runInContext('recommendationState.cohortSelected = true; saveRecommendationCohort()', context);
  const ids = JSON.parse(storage.get('aniviz_cohort_ids'));
  const ranking = JSON.parse(storage.get('aniviz_cohort_ranking'));
  assert.equal(ids.length, 20);
  assert.equal(ids[0], '1943');
  assert.equal(ranking.total, 1000);
  assert.equal(ranking.matches[0].rank, 1);
  assert.ok(Math.abs(ranking.matches[0].score - .613) < .001);
  assert.equal(storage.has('aniviz-filters'), false);
  storage.set('aniviz-filters', '{"genreFilter":"Mystery"}');
  vm.runInContext('saveRecommendationCohort()', context);
  assert.equal(storage.has('aniviz-filters'), true, 'same movie retains exploration filters');
});

test('comparison keeps movie evidence separate from ratings and missing runtime stays unknown', () => {
  const context = dashboard(savedCohort());
  context.document.querySelectorAll = () => [];
  vm.runInContext(source('frontend/explorer/app.js'), context);
  const rows = vm.runInContext(`
    state.cohort = { ranking: {total:1000, matches:[{id:'1943',rank:1,score:0.6132}]} };
    state.cohort_ids = new Set(['1943']);
    comparisonRows({id:1943, format:'MOVIE', year:2006, episodes:1, duration:90, average_score:79, status:'FINISHED'})
  `, context);
  assert.deepEqual(Array.from(rows), ['1 / 1,000', '0.613', 'Movie / 2006', '1 × 90 min', '90 min', '79 / 100', 'Finished']);
  const missing = vm.runInContext('state.cohort_ids = null; comparisonRows({id:1943, episodes:13, duration:null, format:"TV"})', context);
  assert.deepEqual(Array.from(missing).slice(0, 2), ['–', '–']);
  assert.equal(missing[4], 'Unknown');
});

test('cast paths deduplicate actors by ID and include only direct shared cohort credits', () => {
  const creators = source('frontend/creators/app.js');
  const start = creators.indexOf('function buildCohortCastPaths(');
  const end = creators.indexOf('function renderCohortCast(', start);
  const build = vm.runInNewContext(`(${creators.slice(start, end).trim()})`);
  const selected = {id:1, voice_actors:[{id:7,name:'Actor',characters:['A']},{id:'7',name:'Actor',characters:['B']}]};
  const other = {id:2,voice_actors:[{id:'7',name:'Actor',characters:['C']}]};
  const unrelated = {id:3,voice_actors:[{id:8,name:'Other'}]};
  const paths = build(selected, [selected, other, unrelated]);
  assert.equal(paths.length, 1);
  assert.deepEqual(Array.from(paths[0].characters), ['A', 'B']);
  assert.deepEqual(Array.from(paths[0].works, work => work.id), [2]);
  assert.equal(build({id:4}, [other]).length, 0);
});

test('Reception restores the movie cohort before applying shared filters', () => {
  const context = dashboard(savedCohort());
  let inserted = false;
  context.document.body = { dataset: { chapter: 'reception' } };
  context.document.createElement = () => ({});
  context.document.querySelector = () => ({ insertAdjacentElement() { inserted = true; } });
  vm.runInContext('renderCohortContext = () => {}; restoreMovieCohort()', context);
  assert.equal(inserted, true);
  assert.deepEqual(Array.from(vm.runInContext('state.cohort_ids', context)), ['1943', '43']);
});
