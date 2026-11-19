const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ACTORS, FORWARD, ORIGINAL_CREATORS, MOVIE_ACTORS, MOVIE_WRITERS, REVERSE, createContext } = require('../frontend/common/dust-context.js');

test('voice actors aggregate by AniList staff ID and retain a distinct anime selection across reload', () => {
  const lead = { id: 42, name: 'Lead' };
  const portrait = 'https://example.com/portrait.jpg';
  const sameName = { id: 43, name: 'Lead' };
  const metadata = [
    { id: 1, title: 'First', voice_actors: [lead, { ...lead, image: portrait }], average_score: 80, popularity: 100 },
    { id: 2, title: 'Second', voice_actors: [lead, sameName], average_score: null, popularity: 300 },
    { id: 3, title: 'Third', voice_actors: [sameName], average_score: 90, popularity: 400 },
    { id: 4, title: 'Catalogue only', voice_actors: [lead], average_score: 60, popularity: null }
  ];
  const data = {
    anime: metadata.slice(0, 3).map(({ id, title }) => ({ id, title })),
    movies: [
      { id: 101, title: 'Inception', genres: ['Action'] },
      { id: 102, title: 'Another', genres: ['Action'] }
    ]
  };
  const matrix = [-0.5, 0.75, 0.25, 0.25, 0.5, 1];
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const context = createContext({ storage });
  context.setMetadata(metadata);
  context.setSources(data, matrix, { seedExample: true });
  const firstKey = 'anilist:staff:42', secondKey = 'anilist:staff:43';
  let snapshot = context.setDirection(ACTORS);
  const first = () => snapshot.ranking.find(match => match.key === firstKey);
  assert.equal(snapshot.lookup.size, 2);
  assert.equal(first().record.image, portrait);
  assert.deepEqual(first().record.memberIds, ['1', '2', '4']);
  assert.equal(first().score, 0.125);
  assert.deepEqual(first().contributingCounts, [2]);
  snapshot = context.setMagnets(['tmdb:genre:Action']);
  assert.equal(first().score, 0.25);
  snapshot = context.setMagnets(['tmdb:101', 'anilist:score', 'anilist:popularity']);
  assert.deepEqual(first().rawScores, [0.125, 70, 400]);
  assert.deepEqual(first().contributingCounts, [2, 2, 2]);
  assert.deepEqual(first().scores, [0, 0, 0]);

  const { displayedKeys } = snapshot;
  snapshot = context.setSelection([firstKey, secondKey]);
  assert.deepEqual(snapshot.displayedKeys, displayedKeys);
  assert.deepEqual(snapshot.supportingIds, ['1', '2', '4', '3']);
  assert.deepEqual(context.setDirection(FORWARD).selectedKeys, []);
  context.setDirection(ACTORS);

  const restored = createContext({ storage });
  assert.ok(restored.restore());
  restored.setSources(data, matrix);
  assert.deepEqual(restored.setMetadata(metadata).selectedKeys, [firstKey, secondKey]);
});

test('anime original creators join by anime ID and score distinct credits across all magnet types', () => {
  const creator = { id: '42', name: 'Creator', roles: ['Original Story'] };
  const portrait = 'https://example.com/portrait.jpg';
  const credits = {
    1: { original_creators: [creator, { ...creator, image: portrait, roles: ['Original Creator'] }] },
    2: { original_creators: [creator, { id: '43', name: 'Co-creator' }] },
    3: { original_creators: [] }
  };
  const anime = [
    { id: 1, title: 'First', genres: ['Action'], average_score: 60, popularity: 200 },
    { id: 2, title: 'Second', genres: ['Drama'], average_score: 90, popularity: 500 },
    { id: 3, title: 'Uncredited', genres: ['Drama'], voice_actors: [creator], average_score: 99, popularity: 1000 }
  ];
  const data = {
    anime: anime.map(({ id, title }) => ({ id, title })),
    movies: [{ id: 101, title: 'Inception', genres: ['Action'] }, { id: 102, title: 'Another', genres: ['Action'] }]
  };
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const scores = [-0.5, 0.75, 1, 0.25, 0.5, 1];
  const context = createContext({ storage });
  context.setMetadata(anime);
  context.setSources(data, scores, { seedExample: true });
  assert.equal(context.setDirection(ORIGINAL_CREATORS).creditStatus, 'idle');
  let snapshot = context.setAnimeCredits(credits);
  const firstKey = 'anilist:staff:42', secondKey = 'anilist:staff:43';
  const first = () => snapshot.ranking.find(match => match.key === firstKey);
  assert.deepEqual(first().record.memberIds, ['1', '2']);
  assert.equal(first().record.image, portrait);
  assert.equal(first().score, 0.125);
  snapshot = context.setMagnets(['tmdb:genre:Action', 'anilist:popularity', 'anilist:score']);
  assert.deepEqual(first().rawScores, [0.25, 700, 75]);
  assert.deepEqual(first().scores, [0, 1, 0]);
  snapshot = context.setMagnets(['anilist:anime-genre:Action', 'anilist:title-count']);
  assert.deepEqual(first().rawScores, [1, 2]);
  assert.deepEqual(context.setFilters({ genre: 'Action' }).displayedKeys, [firstKey]);
  context.resetFilters();
  assert.deepEqual(context.setSelection([firstKey, secondKey]).supportingIds, ['1', '2']);
  assert.deepEqual(context.setDirection(ACTORS).selectedKeys, []);
  assert.deepEqual(context.snapshot().lookup.get(firstKey).record.memberIds, ['3']);
  context.setDirection(ORIGINAL_CREATORS);

  const restored = createContext({ storage });
  assert.ok(restored.restore());
  restored.setSources(data, scores);
  restored.setMetadata(anime);
  assert.deepEqual(restored.setAnimeCredits(credits).selectedKeys, [firstKey, secondKey]);
});

test('movie actors use the anime matrix column and deduplicate credits for scores, metrics and selection', () => {
  const lead = { id: '7', name: 'Actor' };
  const other = { id: '8', name: 'Actor' };
  const details = {
    101: { cast: [lead, { ...lead, profile_path: '/portrait.jpg' }, other] },
    102: { cast: [lead] },
    103: { cast: [other] }
  };
  const data = {
    anime: [
      { id: 1, title: 'Attack on Titan', genres: ['Action'] },
      { id: 2, title: 'Another anime', genres: ['Action'] }
    ],
    movies: [
      { id: 101, title: 'First', genres: ['Thriller'], year: 2000 },
      { id: 102, title: 'Second', genres: ['Comedy'], year: 2005 },
      { id: 103, title: 'Third', genres: ['Drama'], year: 2010 }
    ]
  };
  const matrix = [-0.5, 0.25, 0.75, 0.5, 0.25, 1];
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const context = createContext({ storage });
  context.setSources(data, matrix, { seedExample: true });
  context.setDirection(MOVIE_ACTORS);
  let snapshot = context.setMovieDetails(details);
  const firstKey = 'tmdb:person:7', secondKey = 'tmdb:person:8';
  const first = () => snapshot.ranking.find(match => match.key === firstKey);
  assert.deepEqual(snapshot.magnetKeys, ['anilist:1']);
  assert.equal(snapshot.lookup.size, 2);
  assert.equal(first().record.profile_path, '/portrait.jpg');
  assert.deepEqual(first().record.memberIds, ['101', '102']);
  assert.equal(first().score, 0.125);
  snapshot = context.setMagnets(['anilist:genre:Action']);
  assert.equal(first().score, 0.25);
  snapshot = context.setFilters({ genre: 'Comedy', yearFrom: 2005 });
  assert.deepEqual(snapshot.displayedKeys, [firstKey]);
  assert.equal(first().score, 0.25);
  context.resetFilters();

  const moviePopularity = {
    popularity: { 101: 4, 102: 12, 103: 20 },
    vote_average: { 101: 6, 102: null, 103: 10 },
    movies: {
      101: { popularity: 4, vote_average: 6 },
      102: { popularity: 12, vote_average: null },
      103: { popularity: 20, vote_average: 10 }
    }
  };
  context.setMoviePopularity(moviePopularity, 'ready');
  snapshot = context.setMagnets(['anilist:1', 'tmdb:score', 'tmdb:popularity']);
  assert.deepEqual(first().rawScores, [0.125, 6, 16]);
  assert.deepEqual(first().contributingCounts, [2, 1, 2]);
  assert.equal(snapshot.score.scale, 10);
  assert.deepEqual(context.setSelection([firstKey, secondKey]).supportingIds, ['101', '102', '103']);
  assert.deepEqual(context.setDirection(REVERSE).selectedKeys, []);
  context.setDirection(MOVIE_ACTORS);

  const restored = createContext({ storage });
  assert.ok(restored.restore());
  restored.setSources(data, matrix);
  restored.setMoviePopularity(moviePopularity, 'ready');
  assert.deepEqual(restored.setMovieDetails(details).selectedKeys, [firstKey, secondKey]);
});

test('movie writers use writing credits and keep their filters and selection separate from movie actors', () => {
  const writer = { id: '7', name: 'Writer', jobs: ['Story'] };
  const coWriter = { id: '8', name: 'Co-writer', jobs: ['Screenplay'] };
  const details = {
    101: { writers: [writer, { ...writer, jobs: ['Screenplay'] }, coWriter] },
    102: { writers: [{ ...writer, profile_path: '/writer.jpg' }] },
    103: { cast: [writer] },
    104: { writers: [coWriter] }
  };
  const data = {
    anime: [{ id: 1, title: 'Attack on Titan' }],
    movies: [
      { id: 101, title: 'First', genres: ['Thriller'] },
      { id: 102, title: 'Second', genres: ['Comedy'] },
      { id: 103, title: 'Third', genres: ['Drama'] },
      { id: 104, title: 'Fourth', genres: ['Thriller'] }
    ]
  };
  const matrix = [-0.5, 0.75, 1, 0.5];
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const context = createContext({ storage });
  context.setSources(data, matrix, { seedExample: true });
  context.setDirection(MOVIE_WRITERS);
  const snapshot = context.setMovieDetails(details);
  const firstKey = 'tmdb:person:7', secondKey = 'tmdb:person:8';
  const match = snapshot.ranking.find(row => row.key === firstKey);
  assert.equal(match.score, 0.125);
  assert.equal(match.record.profile_path, '/writer.jpg');
  assert.deepEqual(match.record.memberIds, ['101', '102']);
  assert.deepEqual(context.setSelection([firstKey, secondKey]).supportingIds, ['101', '102', '104']);
  assert.deepEqual(context.setFilters({ search: 'Writer', genre: 'Comedy' }).displayedKeys, [firstKey]);
  assert.deepEqual(context.setDirection(MOVIE_ACTORS).selectedKeys, []);
  assert.deepEqual(context.snapshot().lookup.get(firstKey).record.memberIds, ['103']);
  context.setSelection([firstKey]);
  assert.deepEqual(context.setDirection(MOVIE_WRITERS).filters.search, 'Writer');
  assert.deepEqual(context.snapshot().supportingIds, ['101', '102']);

  const restored = createContext({ storage });
  assert.ok(restored.restore());
  assert.equal(restored.setSources(data, matrix).direction, MOVIE_WRITERS);
  assert.deepEqual(restored.setMovieDetails(details).selectedKeys, [firstKey]);
});

test('movie creator count magnets use distinct credits, fixed percentiles, and restore after credits load', () => {
  const [lead, coLead, other] = ['Lead', 'Co-lead', 'Other'].map((name, index) => ({ id: index + 1, name }));
  const details = {
    101: { cast: [lead, lead, coLead], writers: [other, other, coLead] },
    102: { cast: [lead], writers: [other] },
    103: { cast: [other], writers: [lead] }
  };
  const data = {
    anime: [{ id: 1, title: 'Attack on Titan', genres: ['Action'] }],
    movies: [
      { id: 101, title: 'First', genres: ['Action', 'Action', 'Comedy'] },
      { id: 102, title: 'Second', genres: ['Drama'] },
      { id: 103, title: 'Third', genres: ['Drama'] },
      { id: 104, title: 'Uncredited', genres: ['Fantasy'] }
    ]
  };
  const action = 'tmdb:movie-genre:Action', titles = 'tmdb:title-count', animeGenre = 'anilist:genre:Action';
  const matrix = [0.25, 0.75, -0.5, 1];
  for (const [direction, leader] of [[MOVIE_ACTORS, lead], [MOVIE_WRITERS, other]]) {
    const memory = new Map();
    const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
    const context = createContext({ storage });
    context.setSources(data, null);
    context.setDirection(direction);
    const ready = context.setMovieDetails(details);
    assert.deepEqual(ready.genreCountMagnets.map(magnet => magnet.title), ['Action movies', 'Comedy movies', 'Drama movies']);

    const counts = context.setMagnets([action, titles]);
    assert.equal(counts.mixed, true);
    assert.deepEqual(counts.ranking.map(row => [row.record.title, row.rawScores, row.scores]), [
      [leader.name, [1, 2], [.75, 1]],
      [coLead.name, [1, 1], [.75, .25]],
      [leader === lead ? other.name : lead.name, [0, 1], [0, .25]]
    ]);
    assert.deepEqual(context.setMagnets([action]).ranking[0].supportingWorks.map(work => work.id), ['101']);
    assert.deepEqual(context.setMagnets([titles]).ranking[0].supportingWorks.map(work => work.id), ['101', '102']);

    context.setSources(data, matrix);
    const combined = context.setMagnets([animeGenre, action, titles]);
    const leaderKey = `tmdb:person:${leader.id}`;
    const filtered = context.setFilters({ search: leader.name, genre: 'Drama' });
    assert.deepEqual(filtered.displayedKeys, [leaderKey]);
    assert.deepEqual(filtered.displayedDust[0].rawScores, [.5, 1, 2]);
    assert.deepEqual(filtered.displayedDust[0].scores, combined.ranking.find(row => row.key === leaderKey).scores);
    context.setSelection([leaderKey]);
    context.setRankingSort(action);

    const restored = createContext({ storage });
    assert.equal(restored.restore(), true);
    const pending = restored.setSources(data, matrix);
    assert.deepEqual(pending.magnetSlots.map(magnet => magnet.title), ['Action anime', 'Action movies', 'Title count']);
    assert.deepEqual(pending.activeMagnetKeys, [animeGenre]);
    const reloaded = restored.setMovieDetails(details);
    assert.deepEqual(reloaded.activeMagnetKeys, [animeGenre, action, titles]);
    assert.deepEqual(reloaded.selectedKeys, [leaderKey]);
    assert.equal(reloaded.rankingSortKey, action);
    assert.deepEqual(restored.setDirection(REVERSE).magnetKeys, [animeGenre]);
  }
});
