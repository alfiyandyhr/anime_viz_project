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
  const at = scroll => model.locatePeriod(periods.map(([start,end], i) => ({ start, end, top: 500 + 1000 * i - scroll, height: 1000 })), 500, 65);
  const forward = Array.from({length: 6}, (_,i) => at(1000 * i + 500));
  const reverse = Array.from({length: 6}, (_,i) => at(1000 * (5-i) + 500)).reverse();
  assert.deepEqual(forward, reverse);
  forward.forEach((row, i) => assert.equal(row.index, i));
  assert.equal(at(0).year, 1963);
  assert.equal(at(7000).year, 2026);
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
