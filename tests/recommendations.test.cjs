const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { normalizeMovieSearch, searchRecommendationMovies, getRecommendationMatches, getRecommendationRanking } = require("../recommendations.js");
const data = JSON.parse(readFileSync(require.resolve("../data/movie_recommendations.json"), "utf8"));

test("movie search handles case, punctuation, accents, alternative titles, and years", () => {
  const movies = [
    { title: "Amélie", aliases: ["Le Fabuleux Destin d'Amélie Poulain"], year: 2001 },
    { title: "Spider-Man", aliases: [], year: 2002 },
    { title: "The Amazing Spider-Man", aliases: [], year: 2012 },
  ];
  assert.equal(normalizeMovieSearch("  SPIDER-MAN  "), "spider man");
  assert.equal(searchRecommendationMovies(movies, "AMELIE")[0], movies[0]);
  assert.equal(searchRecommendationMovies(movies, "fabuleux destin")[0], movies[0]);
  assert.equal(searchRecommendationMovies(movies, "spider man")[0], movies[1]);
  assert.equal(searchRecommendationMovies(movies, "spider 2012")[0], movies[2]);
  assert.equal(searchRecommendationMovies(movies, "absent").length, 0);
  assert.equal(searchRecommendationMovies(movies, "  ").length, 0);
});

test("all 1,000 movies have 20 unique matches in descending score order", () => {
  assert.equal(data.movies.length, 1000);
  assert.equal(data.anime.length, 1000);
  for (const movie of data.movies) {
    assert.equal(movie.matches.length, 20);
    assert.equal(new Set(movie.matches.map(([index]) => index)).size, 20);
    movie.matches.forEach(([index, score], rank) => {
      assert.ok(data.anime[index]);
      assert.ok(Number.isFinite(score) && score >= -1 && score <= 1);
      if (rank) assert.ok(score <= movie.matches[rank - 1][1]);
    });
  }
});

test("combined controls preserve both ends of the ranking and raw scores, with at most 20 titles", () => {
  const movie = data.movies.find((item) => item.title === "Inception");
  const before = JSON.stringify(movie);
  for (const limit of [5, 10]) {
    const matches = getRecommendationMatches(data, movie, limit);
    assert.equal(matches.length, 2 * limit);
    matches.slice(0, limit).forEach((match, rank) => {
      assert.equal(match.anime, data.anime[movie.matches[rank][0]]);
      assert.equal(match.score, movie.matches[rank][1]);
      assert.equal(match.rank, rank + 1);
      assert.equal(match.group, "top");
    });
    const bottom = movie.bottom_matches.slice(0, limit).reverse();
    matches.slice(limit).forEach((match, rank) => {
      assert.equal(match.anime, data.anime[bottom[rank][0]]);
      assert.equal(match.score, bottom[rank][1]);
      assert.equal(match.rank, data.anime.length - limit + rank + 1);
      assert.equal(match.group, "bottom");
    });
    assert.deepEqual(matches.map((match) => match.rank),
      [...Array.from({length: limit}, (_, rank) => rank + 1),
        ...Array.from({length: limit}, (_, rank) => data.anime.length - limit + rank + 1)]);
  }
  for (const limit of [20, 100, 0, -5, -10, "invalid"]) assert.equal(getRecommendationMatches(data, movie, limit).length, 10);
  assert.equal(getRecommendationMatches(data, movie, "10").length, 20);
  assert.equal(JSON.stringify(movie), before);
  assert.deepEqual(getRecommendationMatches(data, null, 5), []);
});

test("every movie's combined list is unique, descending, and ends at rank 1,000", () => {
  for (const movie of data.movies) {
    for (const limit of [5, 10]) {
      const matches = getRecommendationMatches(data, movie, limit);
      assert.equal(new Set(matches.map((match) => match.anime.id)).size, limit * 2);
      assert.equal(matches.at(-1).rank, 1000);
      matches.forEach((match, rank) => {
        if (rank) assert.ok(match.score <= matches[rank - 1].score);
      });
    }
  }
});

test("all movies include 20 unique bottom matches below the top set", () => {
  for (const movie of data.movies) {
    assert.equal(movie.bottom_matches.length, 20);
    assert.equal(new Set(movie.bottom_matches.map(([index]) => index)).size, 20);
    const topIds = new Set(movie.matches.map(([index]) => index));
    movie.bottom_matches.forEach(([index, score], rank) => {
      assert.ok(data.anime[index]);
      assert.ok(Number.isFinite(score) && score >= -1 && score <= 1);
      assert.ok(!topIds.has(index));
      assert.ok(score <= movie.matches.at(-1)[1]);
      if (rank) {
        const previous = movie.bottom_matches[rank - 1];
        assert.ok(score >= previous[1]);
        if (score === previous[1]) assert.ok(index < previous[0]);
      }
    });
  }
});

test("exact movie search returns the intended source record rather than a sequel", () => {
  for (const title of ["Inception", "Interstellar", "The Matrix", "Titanic"]) {
    assert.equal(searchRecommendationMovies(data.movies, title)[0].title, title);
  }
});

test("full rankings include every anime, all middle ranks, and the exported endpoints", () => {
  const binary = readFileSync(require.resolve("../data/movie_anime_scores.bin"));
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const scores = Float32Array.from({ length: binary.length / 4 }, (_, index) => view.getFloat32(index * 4, true));
  for (const title of ["Inception", "Interstellar", "Titanic"]) {
    const movie = data.movies.find((item) => item.title === title);
    const before = JSON.stringify(movie);
    const ranking = getRecommendationRanking(data, scores, movie);
    assert.equal(ranking.length, data.anime.length);
    assert.equal(new Set(ranking.map((match) => match.anime.id)).size, data.anime.length);
    assert.deepEqual(ranking.slice(0, 20).map((match) => match.index), movie.matches.map(([index]) => index));
    assert.deepEqual(ranking.slice(-20).map((match) => match.index), movie.bottom_matches.slice().reverse().map(([index]) => index));
    ranking.forEach((match, index) => {
      assert.equal(match.rank, index + 1);
      assert.equal(match.score, scores[data.movies.indexOf(movie) * data.anime.length + match.index]);
      if (index) assert.ok(match.score <= ranking[index - 1].score);
    });
    assert.equal(JSON.stringify(movie), before);
  }
});

test("full ranking resolves ties by anime record order and keeps negative scores", () => {
  const movie = { id: "movie" };
  const sample = { movies: [movie], anime: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] };
  const ranking = getRecommendationRanking(sample, Float32Array.from([-.5, .25, .25, -1]), movie);
  assert.deepEqual(ranking.map((match) => match.anime.id), ["b", "c", "a", "d"]);
  assert.deepEqual(ranking.map((match) => match.rank), [1, 2, 3, 4]);
  assert.deepEqual(ranking.map((match) => match.score), [.25, .25, -.5, -1]);
  assert.deepEqual(getRecommendationRanking(sample, null, movie), []);
  assert.deepEqual(getRecommendationRanking(sample, new Float32Array(4), null), []);
  assert.deepEqual(getRecommendationRanking(sample, new Float32Array(4), { id: "unknown" }), []);
});
