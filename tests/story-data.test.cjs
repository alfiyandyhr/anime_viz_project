const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const model = require('../frontend/story/data.js');
const payload = { meta: { schema_version: 1, start_year: 1963, end_year: 2026 }, years: [
  { year: 1963, status: 'ready', anime: [
    { id: 1, title: 'A', year: 1963, genres: ['Action', 'Drama', 'Action'], studio_names: ['One', 'Two', 'One'] },
    { id: 2, title: 'B', year: 1963, genres: ['Drama'], studio_names: ['Unknown studio'] }
  ] },
  { year: 1964, status: 'ready', anime: [] },
  { year: 1965, status: 'unavailable', anime: [] },
  { year: 1966, status: 'stale', anime: [{ id: 3, title: 'C', year: 1966 }] }
] };

test('genre shares use titles as denominator and count each genre once per title', () => {
  const result = model.summarizePeriod(payload, { start: 1963, end: 1966 });
  assert.equal(result.anime.length, 3);
  assert.equal(result.genres.find(row => row.name === 'Action').count, 1);
  assert.equal(result.genres.find(row => row.name === 'Drama').percent, 200 / 3);
  assert.ok(!result.studios.some(row => row.name === 'Unknown studio'));
  assert.equal(result.studios.find(row => row.name === 'One').count, 1);
  assert.equal(result.studios.find(row => row.name === 'Two').count, 1);
});

test('a confirmed empty year differs from missing and stale years', () => {
  const result = model.summarizePeriod(payload, { start: 1963, end: 1967 });
  assert.deepEqual(result.missing, [1965, 1967]);
  assert.deepEqual(result.stale, [1966]);
  assert.equal(result.availableYears, 3);
  assert.deepEqual(model.summarizePeriod(payload, { start: 1980, end: 1989 }).genres, []);
});

test('scroll position is deterministic and reversible across all periods', () => {
  const periods = [[1963,1979], [1980,1989], [1990,1999], [2000,2009], [2010,2019], [2020,2026]];
  const at = scroll => model.locatePeriod(periods.map(([start,end], i) => ({ start, end, top: 500 + 1000 * i - scroll, height: 1000 })), 500);
  const forward = Array.from({length: 6}, (_,i) => at(1000 * i + 500));
  const reverse = Array.from({length: 6}, (_,i) => at(1000 * (5-i) + 500)).reverse();
  assert.deepEqual(forward, reverse);
  forward.forEach((row, i) => assert.equal(row.index, i));
  assert.equal(at(0).year, 1963);
  assert.equal(at(7000).year, 2026);
});

test('every year is reachable and each chapter completes before the next activates', () => {
  const periods = [[1963,1979], [1980,1989], [1990,1999], [2000,2009], [2010,2019], [2020,2026]];
  for (const probe of [65, 500, 720]) {
    const sections = periods.map(([start, end], i) => ({ start, end,
      top: probe + periods.slice(0, i).reduce((sum, [a, b]) => sum + (b - a + 1) * 160, 0),
      height: (end - start + 1) * 160 }));
    const at = scroll => model.locatePeriod(sections.map(section => ({ ...section, top: section.top - scroll })), probe);
    sections.forEach((section, index) => {
      const startScroll = section.top - probe;
      const seen = new Set();
      for (let offset = 0; offset < section.height - 2; offset += 10) {
        const located = at(startScroll + offset);
        assert.equal(located.index, index);
        seen.add(located.year);
      }
      assert.deepEqual([...seen], Array.from({ length: section.end - section.start + 1 }, (_, i) => section.start + i));
      const end = at(startScroll + section.height - 10);
      assert.equal(end.year, section.end);
      assert.equal(end.progress, 1);
      for (let year = section.start; year <= section.end; year++) {
        const target = startScroll + model.yearScrollProgress(section, year) * section.height;
        assert.equal(at(target).year, year, `year picker reaches ${year}`);
        assert.equal(at(target).index, index);
      }
    });
  }
});

test('published archive contains independently ranked annual samples for every year', () => {
  const data = model.validate(JSON.parse(readFileSync(require.resolve('../story.json'), 'utf8')));
  assert.equal(data.years.length, data.meta.end_year - 1963 + 1);
  assert.ok(data.meta.complete);
  for (const row of data.years) {
    assert.ok(row.anime.length <= 10);
    assert.ok(row.anime.every(work => work.year === row.year && work.country === 'JP' && work.status !== 'NOT_YET_RELEASED'));
    assert.ok(row.anime.every((work, i) => i === 0 || row.anime[i-1].popularity >= work.popularity));
  }
  assert.ok(data.years[0].anime.some(work => work.title === 'Astro Boy'));
  assert.ok(data.years.at(-1).provisional);
});

test('validation rejects dashboard data, duplicate years and cross-year records', () => {
  assert.throws(() => model.validate({ meta: {}, anime: [] }));
  assert.throws(() => model.validate({ ...payload, years: [...payload.years, payload.years[0]] }));
  assert.throws(() => model.validate({ ...payload, years: [{ year: 1963, anime: [{ id: 1, title: 'Wrong year', year: 1964 }] }] }));
});

test('the anime timeline ranks the five highest-scoring live-action movies for every annual winner', () => {
  const archive = model.validate(require('../story.json'));
  const bundle = require('../data/history_movie_matches.json');
  const catalogue = require('../data/movie_recommendations.json');
  const matrix = readFileSync(require.resolve('../data/movie_anime_scores.bin'));
  const animeIndices = new Map(catalogue.anime.map((anime, index) => [Number(anime.id), index]));
  const excluded = movie => !movie.genres.length || movie.genres.includes('Animation')
    || movie.tags.includes('cartoon characters');
  const eligible = new Set(bundle.live_action_movie_ids);
  assert.deepEqual([...eligible], catalogue.movies.filter(movie => !excluded(movie)).map(movie => movie.id));
  for (const id of ['8392', '1311031']) assert.ok(!eligible.has(id));
  const pairs = model.yearPairs(archive, bundle);
  assert.equal(pairs.length, archive.years.length);
  for (const { year, anchor: anime, matches } of pairs) {
    assert.equal(anime.id, model.topAnime(archive, { start: year, end: year }, 1)[0].id);
    assert.equal(matches.length, 5);
    assert.ok(matches.every(({ work, score }, rank) => work.synopsis && !excluded(work)
      && (rank === 0 || score <= matches[rank - 1].score)));
    const index = animeIndices.get(anime.id);
    if (index === undefined) continue;
    const ranked = catalogue.movies.flatMap((movie, movieIndex) => eligible.has(movie.id)
      ? [[movie.id, matrix.readFloatLE((movieIndex * catalogue.anime.length + index) * 4)]] : []);
    ranked.sort((a, b) => b[1] - a[1]);
    assert.deepEqual(matches.map(({ work, score }) => [work.id, score]), ranked.slice(0, 5));
  }
});

test('the movie timeline chooses live-action winners and links to the five highest-scoring anime', () => {
  const catalogue = require('../data/movie_recommendations.json');
  const popularity = require('../data/movie_popularity.json');
  const matrix = readFileSync(require.resolve('../data/movie_anime_scores.bin'));
  const { live_action_movie_ids: ids } = require('../data/history_movie_matches.json');
  const eligible = new Set(ids);
  const movies = catalogue.movies.filter(movie => eligible.has(movie.id));
  const pairs = model.movieYearPairs(catalogue, popularity, ids);
  const years = [...new Set(movies.map(movie => movie.year))].sort((a, b) => a - b);
  assert.deepEqual(pairs.map(pair => pair.year), years);
  for (const { year, anchor: movie, matches } of pairs) {
    const ranked = movies.filter(movie => movie.year === year)
      .sort((a, b) => popularity.popularity[b.id] - popularity.popularity[a.id]);
    assert.equal(movie.id, ranked[0].id);
    const row = catalogue.movies.findIndex(record => record.id === movie.id);
    const scores = catalogue.anime.map((anime, index) =>
      [anime.id, matrix.readFloatLE((row * catalogue.anime.length + index) * 4)]);
    scores.sort((a, b) => b[1] - a[1]);
    assert.ok(matches.every(({ work }) => work.description === work.synopsis));
    assert.deepEqual(matches.map(({ work, score }) => [work.id, Math.fround(score)]), scores.slice(0, 5));
  }
});
