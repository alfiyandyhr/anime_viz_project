const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, FORWARD, REVERSE, STUDIOS } = require('../frontend/common/dust-context.js');
const { studios: catalogueStudios } = require('../frontend/common/chart-data.js');
const { read: networkScope } = require('../frontend/network/scope.js');

const studioKey = id => `anilist:studio:${id}`;
const credit = (id, name) => ({ id, name });
const alpha = credit(10, 'Alpha'), beta = credit(20, 'Beta'), sparse = credit(30, 'Sparse');
const unrated = credit(40, 'Unrated'), sameName = credit(50, 'Alpha');
const memberships = [[alpha, alpha], [alpha], [alpha, beta], [alpha, beta],
  [beta], [beta], [sparse], [unrated], [sameName]];
const scores = [80, null, 78, 70, 85, 90, 60, null, 60];
const popularity = [10, 15, 20, 900, null, 40, 45, 50, 45];
const cosine = [-.2, .7, .4, .6, .8, .2, .95, .3, .1];
const data = {
  anime: memberships.map((_, index) => ({
    id: String(index + 1), title: `Anime ${index + 1}`, genres: [index === 1 ? 'Drama' : 'Action']
  })),
  movies: [{ id: 101, title: 'Inception', genres: ['Action'] }, { id: 102, title: 'Another', genres: ['Action'] }]
};
const matrix = [...cosine, ...cosine.map(value => value / 2)];
const metadata = memberships.map((studios, index) => ({
  id: index + 1, studios, studio_names: studios.map(studio => studio.name),
  average_score: scores[index], popularity: popularity[index]
}));

function setup() {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const context = createContext({ storage });
  context.setMetadata(metadata);
  context.setSources(data, matrix, { seedExample: true });
  return { context, storage };
}

const rank = (snapshot, id) => snapshot.ranking.find(match => match.key === studioKey(id));

test('studio IDs group main credits, average signed title and cohort scores, and retain scores when the field changes', () => {
  const { context } = setup();
  let snapshot = context.setDirection(STUDIOS);
  assert.equal(snapshot.lookup.size, 5, 'studios with the same name have separate IDs');
  assert.deepEqual(snapshot.activeMagnetKeys, ['tmdb:101']);
  assert.deepEqual(snapshot.displayedKeys, [30, 20, 10, 40, 50].map(studioKey));
  const alphaRank = rank(snapshot, 10);
  assert.deepEqual(alphaRank.record.memberIds, ['1', '2', '3', '4']);
  assert.deepEqual(alphaRank.supportingWorks.map(work => work.id), ['2', '4', '3', '1']);
  assert.deepEqual(alphaRank.contributingCounts, [4]);
  assert.ok(Math.abs(alphaRank.score - .375) < 1e-10);
  assert.equal(rank(snapshot, 30).rank, 1, 'one-work studios still appear in the full ranking');

  snapshot = context.setMagnets(['tmdb:101', 'tmdb:genre:Action']);
  const before = rank(snapshot, 10);
  assert.ok(Math.abs(before.rawScores[1] - .28125) < 1e-10);
  snapshot = context.setMagnets(['tmdb:genre:Action']);
  assert.ok(Math.abs(rank(snapshot, 10).score - .28125) < 1e-10);
  context.setMagnets(['tmdb:101', 'tmdb:genre:Action']);
  context.setDustLimit(30);
  snapshot = context.setFilters({ search: 'AlPhA', genre: 'Drama' });
  assert.deepEqual(snapshot.displayedKeys, [studioKey(10)]);
  assert.deepEqual(snapshot.supportingIds, ['1', '2', '3', '4']);
  assert.deepEqual(rank(snapshot, 10).rawScores, before.rawScores);
  snapshot = context.setFilters({ search: 'Sparse', genre: 'All' });
  assert.deepEqual(snapshot.displayedKeys, [studioKey(30)]);
});

test('mixed studio magnets aggregate each input independently and use tie-aware studio percentiles', () => {
  const { context } = setup();
  context.setDirection(STUDIOS);
  const snapshot = context.setMagnets(['tmdb:101', 'anilist:score', 'anilist:popularity']);
  const alphaRank = rank(snapshot, 10), betaRank = rank(snapshot, 20);
  assert.deepEqual(alphaRank.supportingWorks.map(work => work.id), ['2', '4', '3', '1']);
  assert.ok(Math.abs(alphaRank.rawScores[0] - .375) < 1e-10);
  assert.deepEqual(alphaRank.rawScores.slice(1), [76, 945]);
  assert.deepEqual(alphaRank.contributingCounts, [4, 3, 4]);
  assert.deepEqual(betaRank.supportingWorks.map(work => work.id), ['5', '4', '3', '6']);
  assert.deepEqual(betaRank.rawScores.slice(1), [80.75, 960]);
  assert.deepEqual(betaRank.contributingCounts, [4, 4, 3]);
  assert.equal(rank(snapshot, 30).scores[2], rank(snapshot, 50).scores[2]);
  assert.deepEqual(rank(snapshot, 40).contributingCounts, [1, 0, 1]);
  assert.equal(rank(snapshot, 40).rank, null);
  assert.equal(rank(snapshot, 40).score, null);
  assert.deepEqual(new Set(snapshot.displayedKeys), new Set([10, 20, 30, 50].map(studioKey)));
});

test('standalone studio metrics match Full Catalogue even for works outside the similarity matrix', () => {
  const { context } = setup();
  const fullCatalogue = [...metadata, {
    id: 10, title: 'Catalogue only', studios: [alpha], studio_names: ['Alpha'], average_score: 97, popularity: 1000
  }];
  context.setMetadata(fullCatalogue);
  let snapshot = context.setDirection(STUDIOS);
  assert.equal(rank(snapshot, 10).score, .375);
  assert.deepEqual(rank(snapshot, 10).contributingCounts, [4]);
  assert.ok(snapshot.titleLookup.has('anilist:10'));
  for (const [magnet, field, value] of [
    ['anilist:popularity', 'totalPopularity', 1945],
    ['anilist:score', 'averageScore', 81.25]
  ]) {
    snapshot = context.setMagnets([magnet]);
    const catalogue = catalogueStudios(fullCatalogue).sort((a, b) => b[field] - a[field]);
    assert.equal(snapshot.ranking[0].key, catalogue[0].key);
    assert.equal(snapshot.ranking[0].rawScores[0], value);
    assert.equal(snapshot.displayedDust[0].scores[0], 1);
    assert.equal(snapshot.displayedDust[0].key, studioKey(10));
    assert.equal(snapshot.displayedDust.some(row => row.key === studioKey(40)), magnet === 'anilist:popularity');
  }
});

test('selection publishes a deduplicated title scope and restores independently of title sessions', () => {
  const { context, storage } = setup();
  const selectedTitle = context.snapshot().displayedKeys[0];
  context.setSelection([selectedTitle]);
  const studios = context.setDirection(STUDIOS);
  const before = studios.displayedKeys;
  context.setSelection([studioKey(10)]);
  assert.deepEqual(networkScope(storage), { ids: ['1', '2', '3', '4'] });
  context.toggleSelection(studioKey(20));
  assert.deepEqual(networkScope(storage), { ids: ['1', '2', '3', '4', '5', '6'] });
  assert.deepEqual(context.snapshot().displayedKeys, before);
  context.toggleSelection(studioKey(30));
  context.toggleSelection(studioKey(40));
  const selection = [studioKey(10), studioKey(20), studioKey(30)];
  assert.deepEqual(context.snapshot().selectedKeys, selection);
  context.saveLayout({ scrollY: 800 });
  context.setDirection(REVERSE);
  assert.deepEqual(networkScope(storage), { movieDust: true });
  assert.deepEqual(context.setDirection(FORWARD).selectedKeys, [selectedTitle]);
  assert.equal(context.getLayout().scrollY, 0);
  assert.deepEqual(context.setDirection(STUDIOS).selectedKeys, selection);

  const oldSession = JSON.parse(storage.getItem('aniviz-dust-session-v2'));
  oldSession.sessions[STUDIOS].state.minimumWorks = 5;
  storage.setItem('aniviz-dust-session-v2', JSON.stringify(oldSession));
  const restored = createContext({ storage });
  assert.ok(restored.restore());
  restored.setSources(data, matrix);
  restored.setMetadata([], 'unavailable');
  assert.deepEqual(restored.snapshot().selectedKeys, selection);
  assert.equal(restored.snapshot().minimumWorks, undefined);
  restored.setMetadata(metadata);
  assert.equal(restored.getLayout().scrollY, 800);
  assert.deepEqual(restored.snapshot().selectedKeys, selection);
  assert.deepEqual(networkScope(storage), { ids: ['1', '2', '3', '4', '5', '6', '7'] });
  restored.setSelection([]);
  assert.equal(networkScope(storage).ids.length, 9);
});
