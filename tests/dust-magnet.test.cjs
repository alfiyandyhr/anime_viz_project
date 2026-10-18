const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { getDustMatches, defaultMagnetPositions, dustTargetDistance, layoutDust } = require("../dust-magnet.js");
const data = JSON.parse(readFileSync(require.resolve("../data/movie_recommendations.json"), "utf8"));
const binary = readFileSync(require.resolve("../data/movie_anime_scores.bin"));
const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
const scores = Float32Array.from({ length: binary.length / 4 }, (_, index) => view.getFloat32(index * 4, true));
const favorites = ["Inception", "Interstellar", "The Matrix"].map((title) => data.movies.find((movie) => movie.title === title).id);

test("complete web matrix matches its hash, dimensions, and every exported top/bottom score", () => {
  assert.equal(binary.length, data.movies.length * data.anime.length * 4);
  assert.equal(createHash("sha256").update(binary).digest("hex"), data.meta.score_matrix.sha256);
  for (const [movieIndex, movie] of data.movies.entries()) {
    for (const [animeIndex, score] of [...movie.matches, ...movie.bottom_matches]) {
      assert.ok(Math.abs(scores[movieIndex * data.anime.length + animeIndex] - score) < 1e-7);
    }
  }
  assert.ok(scores.every((score) => Number.isFinite(score) && score >= -1 && score <= 1));
});

test("one magnet returns the actual highest scoring anime beyond the old top 20", () => {
  const matches = getDustMatches(data, scores, [favorites[0]], 60);
  const movieIndex = data.movies.findIndex((movie) => movie.id === favorites[0]);
  const expected = data.anime.map((_, index) => index)
    .sort((a, b) => scores[movieIndex * 1000 + b] - scores[movieIndex * 1000 + a] || a - b).slice(0, 60);
  assert.deepEqual(matches.map((match) => match.index), expected);
  assert.deepEqual(matches.map((match) => match.rank), Array.from({ length: 60 }, (_, index) => index + 1));
});

test("multiple magnets retain each movie's strongest matches and use full per-movie scores", () => {
  const matches = getDustMatches(data, scores, favorites, 60);
  assert.equal(matches.length, 60);
  assert.equal(new Set(matches.map((match) => match.anime.id)).size, 60);
  for (const [index, id] of favorites.entries()) {
    const movie = data.movies.find((item) => item.id === id);
    for (const [animeIndex] of movie.matches.slice(0, 10)) assert.ok(matches.some((match) => match.index === animeIndex));
    const movieIndex = data.movies.indexOf(movie);
    for (const match of matches) assert.equal(match.scores[index], scores[movieIndex * data.anime.length + match.index]);
  }
  for (const match of matches) {
    assert.equal(match.score, match.scores.reduce((a, b) => a + b, 0) / 3);
    assert.equal(match.scores[match.closest], Math.max(...match.scores));
  }
});

test("movie order changes color association but not the chosen anime or combined ranking", () => {
  const forward = getDustMatches(data, scores, favorites.slice(0, 2));
  const backward = getDustMatches(data, scores, favorites.slice(0, 2).reverse());
  assert.deepEqual(forward.map((match) => match.anime.id), backward.map((match) => match.anime.id));
  assert.deepEqual(forward[0].scores, backward[0].scores.slice().reverse());
});

test("empty magnets and unavailable scores do not invent matches", () => {
  assert.deepEqual(getDustMatches(data, scores, []), []);
  assert.deepEqual(getDustMatches(data, null, favorites), []);
  assert.deepEqual(getDustMatches(data, scores, ["missing movie"]), []);
  assert.equal(getDustMatches(data, scores, favorites, 30).length, 30);
  assert.equal(getDustMatches(data, scores, favorites, 90).length, 90);
});

test("higher cosine scores have monotonically shorter target distances, including negative scores", () => {
  assert.equal(dustTargetDistance(1, 100), 0);
  assert.equal(dustTargetDistance(-1, 100), 200);
  const distances = [-1, -.5, 0, .3, .6, .9, 1].map((score) => dustTargetDistance(score, 100));
  distances.forEach((distance, index) => { if (index) assert.ok(distance < distances[index - 1]); });
});

test("1–3 magnets keep 30–90 dots separated and within mobile and desktop bounds", () => {
  for (const width of [240, 320, 640, 1000]) {
    for (const count of [1, 2, 3]) {
      for (const limit of [30, 60, 90]) {
        const matches = getDustMatches(data, scores, favorites.slice(0, count), limit);
        const before = JSON.stringify(matches);
        const nodes = layoutDust(matches, defaultMagnetPositions(count, width, 500), width, 500);
        assert.equal(JSON.stringify(matches), before, "layout must not mutate source matches");
        for (const [index, node] of nodes.entries()) {
          assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
          assert.ok(node.x >= 14 && node.x <= width - 14 && node.y >= 18 && node.y <= 482);
          for (const other of nodes.slice(index + 1)) {
            assert.ok(Math.hypot(node.x - other.x, node.y - other.y) > 13, `overlap at ${width}px, ${count} magnets, ${limit} dots`);
          }
        }
      }
    }
  }
});

test("dragged positions produce a stable, finite layout without leaving the chart", () => {
  const matches = getDustMatches(data, scores, favorites, 60);
  const anchors = [{ x: 76, y: 44 }, { x: 244, y: 422 }, { x: 76, y: 422 }];
  const first = layoutDust(matches, anchors, 320, 500);
  assert.deepEqual(first, layoutDust(matches, anchors, 320, 500));
  first.forEach((node) => assert.ok(node.x >= 14 && node.x <= 306 && node.y >= 18 && node.y <= 482));
});
