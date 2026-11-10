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
  vm.runInContext(source('frontend/common/data-loader.js'), context);
  vm.runInContext(source('frontend/common/chart-data.js'), context);
  vm.runInContext(source('frontend/common/title-artwork.js'), context);
  vm.runInContext(source('frontend/common/explorer-table.js'), context);
  vm.runInContext(source('frontend/common/app.js'), context);
  return context;
}

// Legacy Top-20 storage is input to migration only, never catalogue membership.
function savedCohort() {
  return new Map([
    ['aniviz_seed_movie', JSON.stringify({tmdbId:'27205', title:'Inception', year:2010})],
    ['aniviz_cohort_ids', JSON.stringify(['1943','999999','43'])]
  ]);
}
// A small DOM harness keeps the real context rendering, controls, and shared
// filtering active together, including navigation through session storage.
function scopePage(storage = new Map(), chapter = 'explorer', query = '', storageFailure = null) {
  const context = dashboard(storage);
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: false, value: '', textContent: '', innerHTML: '', listeners: {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      setAttribute(key, value) { this[key] = value; },
      remove() { this.removed = true; },
      querySelectorAll() { return []; },
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
      {id: 999998, title: 'Other', year: 2000, average_score: 85, genres: ['Mystery'], studio_names: ['MADHOUSE'], format: 'TV'}
    ]};
    for (const [key, value] of Object.entries({searchInput:'', genreFilter:'All', studioFilter:'All', formatFilter:'All', yearFrom:'1980', yearTo:'2026', scoreFilter:'0'})) {
      elements[key] = {value, tagName: 'INPUT'};
    }
    initializeBrowseMode();
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

test('catalogue entry ignores legacy modes and dust scope while keeping its filters independent', () => {
  const storage = scopeStorage();
  storage.set('aniviz-filter-version','2');
  storage.set('aniviz-filters',JSON.stringify({genreFilter:'Mystery'}));
  storage.set('aniviz-dust-session-v1',JSON.stringify({version:1,state:{version:1,movieIds:['27205'],displayedDustIds:['1943']}}));
  const dust = storage.get('aniviz-dust-session-v1');
  for (const query of ['', '?mode=matches', '?mode=catalogue', '?mode=invalid']) {
    const page = scopePage(storage,'explorer',query);
    assert.equal(vm.runInContext('state.browseMode',page.context),'catalogue');
    assert.equal(vm.runInContext('state.cohort_ids',page.context),null);
    assert.equal(vm.runInContext('state.filteredAnime.length',page.context),3);
  }
  const page = scopePage(storage);
  vm.runInContext('elements.searchInput.value="Other"; applyFilters()',page.context);
  assert.equal(vm.runInContext('state.filteredAnime[0].title',scopePage(storage).context),'Other');
  assert.equal(storage.get('aniviz-dust-session-v1'),dust);
  assert.equal(JSON.parse(storage.get('aniviz-filters')).genreFilter,'Mystery');
});

test('legacy catalogue filters migrate once without copying old movie-match filters', () => {
  for (const scope of ['catalogue','cohort']) {
    const storage=scopeStorage();storage.set('aniviz_cohort_scope',scope);
    storage.set('aniviz-filters',JSON.stringify({searchInput:'Other'}));
    const page=scopePage(storage);
    assert.equal(vm.runInContext('state.filteredAnime.length',page.context),scope==='catalogue'?1:3);
    assert.equal(storage.get('aniviz-filter-version'),'2');
    assert.equal(JSON.parse(storage.get('aniviz-catalogue-filters')).searchInput,scope==='catalogue'?'Other':'');
  }
});

test('missing or malformed legacy context and denied storage leave the catalogue usable', () => {
  for (const storage of [new Map(),scopeStorage(),new Map([['aniviz_seed_movie','{bad']])]) {
    const page=scopePage(storage,'explorer','?mode=matches');
    assert.equal(vm.runInContext('state.filteredAnime.length',page.context),3);
  }
  for (const failure of ['getItem','setItem']) {
    const page=scopePage(scopeStorage(),'explorer','?mode=matches',failure);
    assert.equal(vm.runInContext('state.filteredAnime.length',page.context),3);
    assert.equal(vm.runInContext('state.scopePersistent',page.context),false);
  }
});

test('catalogue inline comparison retains filtered finalists and clears explicitly without movie evidence', () => {
  const page = scopePage(scopeStorage(), 'explorer');
  page.node('#comparison-footer').querySelector = page.node;
  vm.runInContext(source('frontend/explorer/app.js'), page.context);
  vm.runInContext(`
    renderAnimeTable = () => {};
    renderCatalogueAnalysis = () => {};
    shortlist.add('1943'); shortlist.add('43'); renderComparison();
    elements.searchInput.value = 'no such anime'; applyFilters(); renderComparison();
  `, page.context);
  const footer = page.node('#comparison-footer');
  assert.equal(footer.hidden, false);
  assert.match(footer.innerHTML, /Paprika/); assert.match(footer.innerHTML, /Ghost in the Shell/);
  assert.doesNotMatch(footer.innerHTML, /Cosine|Similarity|0\.613/);
  assert.match(footer.innerHTML, /class="comparison-scroll" tabindex="0" role="region"/);
  assert.equal(vm.runInContext('state.filteredAnime.length', page.context), 0);
  page.node('#clear-shortlist').listeners.click();
  assert.equal(footer.hidden, true);
  assert.match(page.node('#shortlist-status').textContent, /Shortlist 2–3/);
  const reloaded = scopePage(scopeStorage(), 'explorer');
  vm.runInContext(source('frontend/explorer/app.js'), reloaded.context);
  assert.equal(vm.runInContext('shortlist.size', reloaded.context), 0);
});

test('Explorer pagination names its actions and marks only the current page', () => {
  const page = scopePage(scopeStorage(), 'explorer');
  vm.runInContext(source('frontend/explorer/app.js'), page.context);
  page.context.d3 = { descending: (a, b) => b - a };
  vm.runInContext(`
    AnivizExplorer.create({ body: { innerHTML: '', querySelectorAll: () => [] },
      pagination: document.querySelector('#table-pagination'), note: document.querySelector('#table-note'),
      d3, helpers: chartHelpers() }).update({ anime: Array.from({length: 30}, (_, i) => ({
        id: i, title: 'Title', cover: {}, titles: {}, studio_names: [], genres: []
      })), page: 1, pageSize: 10 });
  `, page.context);
  const html = page.node('#table-pagination').innerHTML;
  assert.match(html, /aria-label="Previous page"/);
  assert.match(html, /aria-label="Next page"/);
  assert.match(html, /aria-label="Page 2" aria-current="page"/);
  assert.equal((html.match(/aria-current=/g) || []).length, 1);
});
