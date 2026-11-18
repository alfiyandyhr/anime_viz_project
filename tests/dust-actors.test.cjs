const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ACTORS, FORWARD, createContext } = require('../frontend/common/dust-context.js');

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
