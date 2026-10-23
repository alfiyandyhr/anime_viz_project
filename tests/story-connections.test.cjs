const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const story = require('../frontend/story/data.js');
const movies = require('../frontend/story/connections-data.js');

test('period anime popularity ranking stays within its years and ignores unavailable samples', () => {
  const payload = { years: [
    { year: 1979, anime: [{ id: 3, popularity: 8 }, { id: 2, popularity: 8 }, { id: 1, popularity: 10 }] },
    { year: 1980, anime: [{ id: 4, popularity: 999 }] },
    { year: 1978, status: 'unavailable', anime: [{ id: 5, popularity: 999 }] }
  ] };
  assert.deepEqual(story.topAnime(payload, { start: 1963, end: 1979 }, 2).map(a => a.id), [1, 2]);
});

test('connection maps fit complete cards inside existing whitespace, including narrow layouts', () => {
  assert.equal(movies.fitCount(100, 160, [300]), 0);
  assert.equal(movies.fitCount(460, 160, [300]), 1);
  assert.equal(movies.fitCount(779, 160, [300, 300]), 1);
  assert.equal(movies.fitCount(780, 160, [300, 300]), 2);
  assert.equal(movies.fitCount(780, 190, [330, 340]), 1);
  assert.equal(movies.fitCount(-20, 160, [300]), 0);
  assert.equal(movies.fitCount(Infinity, 160, [300]), 0);
});

test('bad optional recommendation data is rejected without accepting missing or invented scores', () => {
  const data = { schema_version: 1, meta: { model: { id: 'Qwen/Qwen3-Embedding-4B' } },
    movies: ['1', '2', '3'].map(id => ({ id, title: id })),
    periods: [{ id: 'p', start: 1963, end: 1979, anime: [{ id: 7, matches: [
      { movie_id: '1', score: .8 }, { movie_id: '2', score: .5 }, { movie_id: '3', score: -.1 }
    ] }] }] };
  assert.equal(movies.validate(data), data);
  for (const score of [NaN, Infinity, -1.1, 1.1, null]) {
    const invalid = structuredClone(data);
    invalid.periods[0].anime[0].matches[0].score = score;
    assert.throws(() => movies.validate(invalid));
  }
  const missing = structuredClone(data);
  missing.movies.pop();
  assert.throws(() => movies.validate(missing));
});

const snapshotPath = path.resolve(__dirname, '../data/story_movie_recommendations.json');
test('published period recommendations preserve all reused scores and rank the complete movie corpus',
  { skip: !existsSync(snapshotPath) }, () => {
    const snapshot = movies.validate(JSON.parse(readFileSync(snapshotPath, 'utf8')));
    const archive = JSON.parse(readFileSync(path.resolve(__dirname, '../story.json'), 'utf8'));
    const base = JSON.parse(readFileSync(path.resolve(__dirname, '../data/movie_recommendations.json'), 'utf8'));
    const matrix = readFileSync(path.resolve(__dirname, '../data/movie_anime_scores.bin'));
    const indices = new Map(base.anime.map((anime, i) => [Number(anime.id), i]));
    let reused = 0, supplemental = 0;
    assert.equal(snapshot.periods.length, 6);
    assert.equal(snapshot.meta.movie_count, base.movies.length);
    assert.equal(snapshot.meta.model.revision, '5cf2132abc99cad020ac570b19d031efec650f2b');
    for (const period of snapshot.periods) {
      assert.deepEqual(period.anime.map(anime => anime.id), story.topAnime(archive, period).map(anime => anime.id));
      period.anime.forEach((anime, i) => {
        assert.equal(anime.rank, i + 1);
        const index = indices.get(anime.id);
        if (index === undefined) {
          supplemental++;
          assert.equal(anime.score_source, 'supplemental_cache');
          return;
        }
        reused++;
        assert.equal(anime.score_source, 'published_matrix');
        const ranked = base.movies.map((movie, j) => ({ movie_id: movie.id,
          score: matrix.readFloatLE((j * base.anime.length + index) * 4), index: j
        })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3)
          .map(({ movie_id, score }) => ({ movie_id, score }));
        assert.deepEqual(anime.matches, ranked);
      });
    }
    assert.equal(reused, snapshot.meta.reused_anime);
    assert.equal(supplemental, snapshot.meta.supplemental_anime);
    assert.equal(reused + supplemental, 60);
  });
