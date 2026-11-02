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
      querySelector: () => ({setAttribute() {}}), addEventListener() {}
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

function recommendationPage(storage = new Map()) {
  const context = dashboard(storage);
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: true, value: '', innerHTML: '', textContent: '',
      href: 'https://example.com/project/frontend/content/index.html',
      listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; }
    });
    return nodes.get(selector);
  };
  context.document.body = { dataset: { chapter: 'recommendations' } };
  context.document.querySelector = node;
  const suggestion = { dataset: { movieId: '27205' }, setAttribute(key, value) { this[key] = value; } };
  context.document.querySelectorAll = () => [suggestion];
  context.window = { location: { assign: url => { context.destination = url; } } };
  context.fetch = async () => ({ ok: true, json: async () => context.bundle });
  vm.runInContext(source('frontend/recommendations/app.js'), context);
  context.bundle = JSON.parse(source('data/movie_recommendations.json'));
  vm.runInContext(`
    bindDustControls = () => {};
    stopDustChart = () => {};
    setStatus = () => {};
    hideTooltip = () => {};
    renderRecommendationTable = () => {};
    renderRecommendationChart = () => {};
    renderRecommendationDetail = () => {};
    highlightRecommendation = () => {};
    bindRecommendationControls();
  `, context);
  return { context, node, suggestion, storage };
}

function continueJourney(page) {
  let prevented = false;
  page.node('#explore-matches').listeners.click({
    preventDefault() { prevented = true; }, currentTarget: page.node('#explore-matches')
  });
  assert.equal(prevented, true);
}

test('fresh example is unconfirmed until continuation saves its published Top 20 and Task 2 restores them', async () => {
  const page = recommendationPage();
  const { context, storage, node, suggestion } = page;
  await vm.runInContext('loadRecommendations()', context);
  assert.equal(storage.has('aniviz_seed_movie'), false);
  assert.match(node('#selected-movie-label').textContent, /Example movie.*not yet chosen/);
  assert.match(node('#selected-movie').innerHTML, /Inception.*\(2010\)/);
  assert.match(node('#selected-movie').innerHTML, /Top 20 anime matches/);
  assert.equal(suggestion['aria-pressed'], false);
  assert.equal(node('#recommendation-journey').hidden, false);
  assert.match(node('#recommendation-journey-summary').textContent, /choose this example/);
  continueJourney(page);
  assert.equal(context.destination, node('#explore-matches').href);
  assert.equal(node('#selected-movie-label').textContent, 'Your movie');
  assert.match(node('#recommendation-journey-summary').textContent, /Tasks 2–4 and Explorer/);
  const movie = context.bundle.movies.find(item => item.title === 'Inception');
  assert.deepEqual(JSON.parse(storage.get('aniviz_cohort_ids')), movie.matches.slice(0, 20).map(([index]) => String(context.bundle.anime[index].id)));
  const next = dashboard(storage);
  next.document.body = { dataset: { chapter: 'content' } };
  next.document.createElement = () => ({});
  next.document.querySelector = () => ({ insertAdjacentElement() {}, setAttribute() {} });
  vm.runInContext('renderCohortContext = () => {}; restoreMovieCohort()', next);
  assert.equal(vm.runInContext('state.cohort.seed.title', next), 'Inception');
  assert.deepEqual(Array.from(vm.runInContext('state.cohort_ids', next)), JSON.parse(storage.get('aniviz_cohort_ids')));
});

test('map cutoff and matrix arrival preserve the carried set; movie changes reset filters', async () => {
  const page = recommendationPage();
  const { context, node, storage } = page;
  await vm.runInContext('loadRecommendations()', context);
  vm.runInContext("selectRecommendationMovie('27205')", context);
  const ranking = storage.get('aniviz_cohort_ranking');
  const ids = storage.get('aniviz_cohort_ids');
  storage.set('aniviz-filters', '{"genreFilter":"Mystery"}');
  node('#recommendation-limit').listeners.change({ target: { value: '10' } });
  // A deliberately different matrix proves that loading full scores cannot
  // redefine the published set or replace its ranking evidence.
  vm.runInContext('recommendationState.scores = new Float32Array(bundle.movies.length * bundle.anime.length); renderRecommendations()', context);
  assert.equal(storage.get('aniviz_cohort_ids'), ids);
  assert.equal(storage.get('aniviz_cohort_ranking'), ranking);
  assert.equal(storage.has('aniviz-filters'), true);
  assert.equal(node('#selected-movie-label').textContent, 'Your movie');
  storage.set('aniviz_cohort_scope', 'catalogue');
  vm.runInContext("selectRecommendationMovie(bundle.movies.find(movie => movie.title === 'Interstellar').id)", context);
  assert.equal(storage.has('aniviz-filters'), false);
  assert.equal(storage.get('aniviz_cohort_scope'), 'cohort');
  assert.equal(JSON.parse(storage.get('aniviz_seed_movie')).title, 'Interstellar');
  assert.notEqual(storage.get('aniviz_cohort_ids'), ids);
  assert.equal(JSON.parse(storage.get('aniviz_cohort_ids')).length, 20);
  assert.equal(context.destination, undefined, 'explicit selection stays on Task 1');
});

test('restored movie continuation activates its matches and keeps its filters after catalogue browsing', async () => {
  const storage = savedCohort();
  storage.set('aniviz-filter-version', '2');
  storage.set('aniviz_cohort_scope', 'catalogue');
  storage.set('aniviz-filters', '{"genreFilter":"Mystery"}');
  const page = recommendationPage(storage);
  await vm.runInContext('loadRecommendations()', page.context);
  assert.equal(page.node('#selected-movie-label').textContent, 'Your movie');
  assert.equal(page.suggestion['aria-pressed'], true);
  continueJourney(page);
  assert.equal(page.context.destination, page.node('#explore-matches').href);
  assert.equal(storage.get('aniviz_cohort_scope'), 'cohort');
  assert.equal(storage.get('aniviz-filters'), '{"genreFilter":"Mystery"}');
  assert.equal(vm.runInContext('readMovieCohort().enabled', page.context), true);
});

test('unavailable session storage blocks continuation and explains retry without blocking recommendations', async () => {
  for (const failure of ['read', 'write', 'discard']) {
    const page = recommendationPage();
    if (failure === 'read') page.context.sessionStorage.getItem = () => { throw Error('Storage disabled'); };
    else if (failure === 'write') page.context.sessionStorage.setItem = () => { throw Error('Storage full'); };
    else page.context.sessionStorage.setItem = () => {};
    await vm.runInContext('loadRecommendations()', page.context);
    continueJourney(page);
    assert.equal(page.context.destination, undefined);
    assert.match(page.node('#recommendation-journey-summary').textContent, /could not save.*Enable session storage/);
    assert.equal(page.node('#recommendation-content').hidden, false);
  }
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
  context.document.querySelector = () => ({ insertAdjacentElement() { inserted = true; }, setAttribute() {} });
  vm.runInContext('renderCohortContext = () => {}; restoreMovieCohort()', context);
  assert.equal(inserted, true);
  assert.deepEqual(Array.from(vm.runInContext('state.cohort_ids', context)), ['1943', '43']);
});

// A small DOM harness keeps the real context rendering, controls, and shared
// filtering active together, including navigation through session storage.
function scopePage(storage = new Map(), chapter = 'content', query = '', storageFailure = null) {
  const context = dashboard(storage);
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: false, value: '', textContent: '', innerHTML: '', listeners: {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      setAttribute(key, value) { this[key] = value; },
      insertAdjacentElement(position, strip) { nodes.set('#cohort-context', strip); }
    });
    return nodes.get(selector);
  };
  let built = false;
  const strip = {
    querySelector(selector) {
      if (selector === '.cohort-details' && !built) return null;
      return node(selector);
    },
    set innerHTML(value) { built = true; this.markup = value; }
  };
  context.window = { location: { href: `https://example.com/project/frontend/${chapter}/index.html${query}` } };
  if (storageFailure) context.sessionStorage[storageFailure] = () => { throw Error('Storage unavailable'); };
  context.document.body = { dataset: { chapter } };
  context.document.querySelector = selector => selector === '#cohort-context'
    ? nodes.get(selector) || null : node(selector);
  context.document.createElement = () => strip;
  vm.runInContext(`
    state.data = {meta: {year_min: 1980, year_max: 2026}, anime: [
      {id: 1943, title: 'Paprika', year: 2006, average_score: 79, genres: ['Mystery'], studio_names: ['MADHOUSE'], format: 'MOVIE'},
      {id: 43, title: 'Ghost in the Shell', year: null, average_score: 80, genres: ['Sci-Fi'], studio_names: ['Production I.G'], format: 'MOVIE'},
      {id: 1, title: 'Other', year: 2000, average_score: 85, genres: ['Mystery'], studio_names: ['MADHOUSE'], format: 'TV'}
    ]};
    for (const [key, value] of Object.entries({searchInput:'', genreFilter:'All', studioFilter:'All', formatFilter:'All', yearFrom:'1980', yearTo:'2026', scoreFilter:'0'})) {
      elements[key] = {value, tagName: 'INPUT'};
    }
    restoreMovieCohort();
    restoreFilters();
    applyFilters();
  `, context);
  return { context, node, strip };
}

function scopeStorage(ids = ['1943', '999999', '43']) {
  const storage = savedCohort();
  storage.set('aniviz_cohort_ids', JSON.stringify(ids));
  storage.set('aniviz_cohort_ranking', JSON.stringify({tmdbId: '27205', total: 1000,
    matches: [{id: '1943', rank: 1, score: .6132}, {id: '999999', rank: 2, score: .58}, {id: '43', rank: 3, score: .561}]}));
  return storage;
}

test('all guided views show original match totals, distinguish missing metadata, and restore filters on navigation', () => {
  const storage = scopeStorage();
  const original = storage.get('aniviz_cohort_ranking');
  const first = scopePage(storage);
  assert.equal(first.node('.cohort-label').textContent, 'Your movie: Inception (2010) · Top 3 anime matches');
  assert.match(first.node('.cohort-count').textContent, /Showing 2 of 3 matches.*0 matches hidden/);
  assert.match(first.node('.cohort-metadata').textContent, /1 match is unavailable.*metadata is missing/);
  vm.runInContext('elements.genreFilter.value = "Mystery"; applyFilters()', first.context);
  assert.match(first.node('.cohort-count').textContent, /Showing 1 of 3 matches.*1 match hidden/);
  for (const chapter of ['creators', 'reception', 'explorer']) {
    const next = scopePage(storage, chapter);
    assert.match(next.node('.cohort-label').textContent, /Your movie: Inception \(2010\)/);
    assert.match(next.node('.cohort-count').textContent, /Showing 1 of 3 matches.*1 match hidden/);
    assert.match(next.node('.cohort-filter-note').textContent, /Filters carry between Tasks 2–4 and Explorer/);
    assert.equal(next.node('.cohort-metadata').hidden, false);
  }
  assert.equal(storage.get('aniviz_cohort_ranking'), original);
  assert.deepEqual(JSON.parse(storage.get('aniviz_cohort_ids')), ['1943', '999999', '43']);
});

test('empty-result reset keeps movie and evidence, restores available matches, and retains focused controls', () => {
  const storage = scopeStorage();
  const page = scopePage(storage);
  const reset = page.node('.cohort-reset');
  vm.runInContext('elements.searchInput.value = "no such anime"; applyFilters()', page.context);
  assert.match(page.node('.cohort-count').textContent, /Showing 0 of 3 matches.*2 matches hidden/);
  const before = storage.get('aniviz_cohort_ranking');
  reset.listeners.click();
  assert.equal(page.node('.cohort-reset'), reset);
  assert.match(page.node('.cohort-count').textContent, /Showing 2 of 3 matches.*0 matches hidden/);
  assert.match(page.node('.cohort-label').textContent, /Inception/);
  assert.equal(storage.get('aniviz_cohort_ranking'), before);
  assert.deepEqual(Array.from(vm.runInContext('state.filteredAnime', page.context), anime => anime.id), [1943, 43]);
  // Unknown years are available with unrestricted filters, but cannot satisfy
  // an explicitly narrowed year range.
  vm.runInContext('elements.yearFrom.value = "2000"; applyFilters()', page.context);
  assert.match(page.node('.cohort-count').textContent, /Showing 1 of 3 matches/);
});

test('no joined metadata is unavailable rather than filtered out; scope navigation preserves the movie', () => {
  const storage = scopeStorage(['999999']);
  const page = scopePage(storage);
  assert.match(page.node('.cohort-count').textContent, /Showing 0 of 1 matches.*0 matches hidden/);
  assert.match(page.node('.cohort-metadata').textContent, /1 match is unavailable/);
  page.node('.cohort-reset').listeners.click();
  assert.match(page.node('.cohort-count').textContent, /Showing 0 of 1 matches/);
  const catalogue = scopePage(storage, 'content', '?mode=catalogue');
  assert.match(catalogue.node('.cohort-label').textContent, /Browsing the full catalogue.*Inception/);
  assert.match(catalogue.node('.cohort-count').textContent, /3 of 3 sampled catalogue anime/);
  assert.equal(catalogue.node('.cohort-metadata').hidden, true);
  assert.equal(catalogue.node('.cohort-resume').hidden, false);
  assert.match(catalogue.node('.cohort-resume').textContent, /Resume matches for Inception/);
  const resumed = scopePage(storage, 'content', '?mode=matches');
  assert.match(resumed.node('.cohort-label').textContent, /Your movie: Inception/);
  assert.match(resumed.node('.cohort-count').textContent, /Showing 0 of 1 matches/);
  assert.equal(resumed.node('.cohort-resume').hidden, true);
  const direct = scopePage();
  assert.equal(direct.node('.cohort-label').textContent, 'Browsing the full catalogue');
  assert.equal(direct.node('.cohort-change').textContent, 'Choose a movie · Task 1');
  assert.equal(direct.node('.cohort-resume').hidden, true);
  assert.doesNotMatch(page.strip.markup, /cohort-full-catalogue|cohort-dismiss/);
});

test('Creators labels studio credits as a whole-set summary while cast and charts use filtered matches', () => {
  const page = scopePage(scopeStorage(), 'creators');
  page.context.document.querySelectorAll = () => [];
  page.node('#cohort-studio-bars').querySelectorAll = () => [];
  vm.runInContext(source('frontend/creators/app.js'), page.context);
  vm.runInContext('renderPage = () => {}; elements.genreFilter.value = "Mystery"; applyFilters(); renderCohortStudios()', page.context);
  assert.match(page.node('#cohort-studio-note').textContent, /original 3 movie matches, unaffected by filters/);
  assert.match(page.node('#cohort-studio-note').textContent, /2 have dashboard metadata; 1 unavailable/);
  assert.match(page.node('#cohort-studio-note').textContent, /only the 1 currently visible match\./);
  assert.match(page.node('#cohort-studio-bars').innerHTML, /Production I.G/);
  assert.doesNotMatch(page.node('#cohort-studio-bars').innerHTML, /in cohort/);
});

test('explicit catalogue entry overrides a saved movie and each mode restores only its own filters', () => {
  const storage = scopeStorage();
  const ids = storage.get('aniviz_cohort_ids');
  const ranking = storage.get('aniviz_cohort_ranking');
  const matches = scopePage(storage);
  vm.runInContext('elements.genreFilter.value = "Mystery"; applyFilters()', matches.context);
  const catalogue = scopePage(storage, 'explorer', '?mode=catalogue');
  assert.equal(vm.runInContext('elements.genreFilter.value', catalogue.context), 'All');
  assert.match(catalogue.node('.cohort-count').textContent, /3 of 3 sampled catalogue/);
  vm.runInContext('elements.searchInput.value = "Other"; applyFilters()', catalogue.context);
  const restoredCatalogue = scopePage(storage, 'reception');
  assert.equal(vm.runInContext('elements.searchInput.value', restoredCatalogue.context), 'Other');
  assert.match(restoredCatalogue.node('.cohort-count').textContent, /1 of 3 sampled catalogue/);
  const resumed = scopePage(storage, 'creators', '?mode=matches');
  assert.equal(vm.runInContext('elements.searchInput.value', resumed.context), '');
  assert.equal(vm.runInContext('elements.genreFilter.value', resumed.context), 'Mystery');
  assert.match(resumed.node('.cohort-count').textContent, /Showing 1 of 3 matches/);
  resumed.node('.cohort-reset').listeners.click();
  assert.equal(JSON.parse(storage.get('aniviz-catalogue-filters')).searchInput, 'Other');
  assert.equal(storage.get('aniviz_cohort_ids'), ids);
  assert.equal(storage.get('aniviz_cohort_ranking'), ranking);
});

test('direct entry restores a valid session mode, otherwise labels the catalogue and offers Task 1', () => {
  for (const chapter of ['content', 'creators', 'reception', 'explorer']) {
    const storage = scopeStorage();
    const matches = scopePage(storage, chapter);
    assert.match(matches.node('.chapter-head .chapter-eyebrow').textContent, /Task|Final comparison/);
    assert.match(matches.node('.chapter-head .chapter-lede').textContent, /movie/);
    storage.set('aniviz_cohort_scope', 'catalogue');
    const catalogue = scopePage(storage, chapter);
    assert.match(catalogue.node('.chapter-head .chapter-eyebrow').textContent, /Full catalogue/);
    assert.doesNotMatch(catalogue.node('.chapter-head h2').textContent, /matches|finalists/);
    assert.doesNotMatch(catalogue.node('.chapter-head .chapter-lede').textContent, /Task|movie|matches/);
    assert.equal(catalogue.node(`#chapter-${chapter}`)['aria-label'], catalogue.node('.chapter-head .chapter-eyebrow').textContent);
    for (const invalid of [new Map(), new Map([['aniviz_cohort_scope', 'cohort']]),
      new Map([['aniviz_seed_movie', '{bad']]), new Map([...scopeStorage(), ['aniviz_cohort_scope', 'unknown']])]) {
      const direct = scopePage(invalid, chapter, '?mode=invalid');
      assert.match(direct.node('.cohort-label').textContent, /^Browsing the full catalogue/);
      assert.match(direct.node('.chapter-head .chapter-eyebrow').textContent, /Full catalogue/);
    }
    const noMovie = scopePage(new Map(), chapter, '?mode=matches');
    assert.equal(noMovie.node('.cohort-change').textContent, 'Choose a movie · Task 1');
    assert.equal(vm.runInContext('state.cohort_ids', noMovie.context), null);
  }
});

test('legacy shared filters migrate to their previous scope exactly once', () => {
  for (const hasMovie of [true, false]) {
    const storage = hasMovie ? scopeStorage() : new Map();
    storage.set('aniviz_cohort_scope', 'catalogue');
    storage.set('aniviz-filters', JSON.stringify({searchInput: 'Other'}));
    const catalogue = scopePage(storage, 'content');
    assert.match(catalogue.node('.cohort-count').textContent, /1 of 3 sampled catalogue/);
    assert.equal(storage.has('aniviz-filters'), false);
    assert.equal(storage.get('aniviz-filter-version'), '2');
    if (hasMovie) {
      const matches = scopePage(storage, 'content', '?mode=matches');
      assert.match(matches.node('.cohort-count').textContent, /Showing 2 of 3 matches/);
      assert.equal(vm.runInContext('elements.searchInput.value', matches.context), '');
      const again = scopePage(storage, 'content', '?mode=catalogue');
      assert.equal(vm.runInContext('elements.searchInput.value', again.context), 'Other');
    }
  }
  const legacyMatches = scopeStorage();
  legacyMatches.set('aniviz-filters', JSON.stringify({searchInput: 'Paprika'}));
  assert.match(scopePage(legacyMatches).node('.cohort-count').textContent, /Showing 1 of 3 matches/);
  assert.equal(legacyMatches.has('aniviz-catalogue-filters'), false);
});

test('choosing a movie activates its matches without erasing catalogue filters', async () => {
  const storage = scopeStorage();
  scopePage(storage);
  storage.set('aniviz-filters', JSON.stringify({searchInput: 'Paprika'}));
  storage.set('aniviz-catalogue-filters', JSON.stringify({searchInput: 'Other'}));
  storage.set('aniviz_cohort_scope', 'catalogue');
  const page = recommendationPage(storage);
  await vm.runInContext('loadRecommendations()', page.context);
  assert.equal(storage.get('aniviz_cohort_scope'), 'catalogue', 'restoring Task 1 is not a new choice');
  vm.runInContext("selectRecommendationMovie('27205')", page.context);
  assert.equal(storage.get('aniviz_cohort_scope'), 'cohort');
  assert.equal(JSON.parse(storage.get('aniviz-filters')).searchInput, 'Paprika', 'same movie keeps its filters');
  storage.set('aniviz_cohort_scope', 'catalogue');
  vm.runInContext("selectRecommendationMovie(bundle.movies.find(movie => movie.title === 'Interstellar').id)", page.context);
  assert.equal(storage.get('aniviz_cohort_scope'), 'cohort');
  assert.equal(storage.has('aniviz-filters'), false, 'different movie resets only match filters');
  assert.equal(JSON.parse(storage.get('aniviz-catalogue-filters')).searchInput, 'Other');
});

test('changing movie from a legacy catalogue session preserves the old catalogue filters', async () => {
  const storage = scopeStorage();
  storage.set('aniviz_cohort_scope', 'catalogue');
  storage.set('aniviz-filters', JSON.stringify({searchInput: 'Other'}));
  const page = recommendationPage(storage);
  await vm.runInContext('loadRecommendations()', page.context);
  vm.runInContext("selectRecommendationMovie(bundle.movies.find(movie => movie.title === 'Interstellar').id)", page.context);
  assert.equal(JSON.parse(storage.get('aniviz-catalogue-filters')).searchInput, 'Other');
  assert.equal(storage.has('aniviz-filters'), false);
  assert.equal(storage.get('aniviz_cohort_scope'), 'cohort');
});

test('disabled storage keeps explicit catalogue labels and explains persistence limits', () => {
  for (const failure of ['getItem', 'setItem']) {
    const page = scopePage(scopeStorage(), 'explorer', '?mode=catalogue', failure);
    assert.match(page.node('.cohort-label').textContent, /^Browsing the full catalogue/);
    assert.match(page.node('.cohort-count').textContent, /3 of 3 sampled catalogue/);
    assert.match(page.node('.cohort-filter-note').textContent, /Session storage is unavailable/);
    assert.match(page.node('.chapter-head .chapter-eyebrow').textContent, /Full catalogue/);
  }
});

test('journey overview marks only the current location, keeps Explorer unnumbered, and hides in catalogue views', () => {
  const pages = ['recommendations', 'content', 'creators', 'reception', 'explorer'];
  for (const chapter of pages) {
    const storage = scopeStorage();
    const page = scopePage(storage, chapter);
    const html = page.node('#journey-overview').innerHTML;
    assert.equal(page.node('#journey-overview').hidden, false, chapter);
    assert.equal((html.match(/<li>/g) || []).length, 4);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    assert.match(html, new RegExp(`href="../${chapter}/index.html[^\"]*"[^>]*aria-current="page"`));
    assert.match(html, /<\/ol>\s*<a[^>]*>Final comparison · Explorer/);
    assert.match(html, /task completion is not tracked/);
    assert.doesNotMatch(html, /Task 5|completed|aria-valuenow/);
    const before = Array.from(storage);
    vm.runInContext('renderJourneyGuidance()', page.context);
    assert.deepEqual(Array.from(storage), before, 'location does not write progress');
    const catalogue = scopePage(storage, chapter, '?mode=catalogue');
    assert.equal(catalogue.node('#journey-overview').hidden, chapter !== 'recommendations');
    if (['content', 'creators', 'reception'].includes(chapter)) {
      assert.equal(page.node('#journey-next').hidden, false);
      assert.equal(catalogue.node('#journey-next').hidden, true);
    }
  }
});

test('descriptive next actions lead through Tasks 2–4 to filtered Explorer with original similarity evidence', () => {
  const storage = scopeStorage();
  let page = scopePage(storage, 'content');
  vm.runInContext('elements.genreFilter.value = "Mystery"; applyFilters()', page.context);
  const original = storage.get('aniviz_cohort_ranking');
  for (const destination of ['creators', 'reception', 'explorer']) {
    const html = page.node('#journey-next').innerHTML;
    assert.match(html, destination === 'explorer'
      ? /Compare your finalists in Explorer →/ : /Next: /);
    const href = html.match(/href="([^"]+)"/)[1];
    const url = new URL(href, 'https://example.com/project/frontend/content/index.html');
    assert.equal(url.pathname, `/project/frontend/${destination}/index.html`);
    page = scopePage(storage, destination, url.search);
    assert.equal(vm.runInContext('state.cohort.seed.title', page.context), 'Inception');
    assert.equal(vm.runInContext('elements.genreFilter.value', page.context), 'Mystery');
    assert.deepEqual(Array.from(vm.runInContext('state.filteredAnime', page.context), anime => anime.id), [1943]);
    assert.equal(storage.get('aniviz_cohort_ranking'), original);
  }
  assert.match(page.node('.chapter-head .chapter-lede').textContent, /Shortlist checkboxes.*2–3.*similarity, format, runtime, and audience scores/);
  vm.runInContext(source('frontend/explorer/app.js'), page.context);
  assert.equal(vm.runInContext('comparisonRows(state.filteredAnime[0])[1]', page.context), '0.613');
});

test('Task 1 overview links confirm the displayed movie and use the same persistence check as continuation', async () => {
  for (const destination of ['content', 'creators', 'reception', 'explorer']) {
    for (const blocked of [false, true]) {
      const page = recommendationPage();
      await vm.runInContext('loadRecommendations()', page.context);
      vm.runInContext('initializeBrowseMode()', page.context);
      assert.equal(page.storage.has('aniviz_seed_movie'), false);
      const href = `https://example.com/project/frontend/${destination}/index.html?mode=matches`;
      if (blocked) page.context.sessionStorage.setItem = () => { throw Error('Storage full'); };
      let prevented = false;
      page.node('#journey-overview').listeners.click({
        target: { closest: () => ({ href }) }, preventDefault() { prevented = true; }
      });
      assert.equal(prevented, true);
      if (blocked) {
        assert.equal(page.context.destination, undefined);
        assert.match(page.node('#recommendation-journey-summary').textContent, /could not save/);
      } else {
        assert.equal(page.context.destination, href);
        assert.equal(page.storage.get('aniviz_cohort_scope'), 'cohort');
        assert.equal(JSON.parse(page.storage.get('aniviz_cohort_ids')).length, 20);
        assert.equal(JSON.parse(page.storage.get('aniviz_seed_movie')).title, 'Inception');
      }
    }
  }
});
