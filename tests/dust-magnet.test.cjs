const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { getDustMatches, defaultMagnetPositions, dustTargetDistance, layoutDust } = require("../frontend/recommendations/dust-magnet.js");
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

function distancesTo(node, anchors) {
  return anchors.map((anchor) => Math.hypot(node.x - anchor.x, node.y - anchor.y));
}

function assertMovieScoreOrder(nodes, anchors) {
  for (const node of nodes) {
    const distances = distancesTo(node, anchors);
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        assert.ok((node.scores[i] - node.scores[j]) * (distances[i] - distances[j]) <= 1e-7,
          `${node.anime.title}: higher-scoring movie must be nearer`);
      }
    }
    assert.equal(node.approximate, false);
  }
}

test("Avengers/Inception regression: dragging does not strand low-similarity dots near a magnet", () => {
  const ids = ["Avengers: Endgame", "Inception"].map((title) => data.movies.find((movie) => movie.title === title).id);
  const matches = getDustMatches(data, scores, ids, 60);
  const anchors = [{ x: 150, y: 290 }, { x: 410, y: 305 }];
  const nodes = layoutDust(matches, anchors, 640, 500);
  assertMovieScoreOrder(nodes, anchors);
  let squaredError = 0, inversions = 0, comparisons = 0;
  for (const [index, node] of nodes.entries()) {
    const distances = distancesTo(node, anchors);
    distances.forEach((distance, magnet) => {
      const target = dustTargetDistance(node.scores[magnet], 190);
      assert.ok(distance >= target * .7, "no stray dot dramatically inside its similarity radius");
      squaredError += (distance - target) ** 2;
      for (const other of nodes.slice(index + 1)) {
        const gap = node.scores[magnet] - other.scores[magnet];
        // Ignore nearly equal scores when assessing the comparative reading.
        if (Math.abs(gap) < .03) continue;
        comparisons++;
        if (gap * (distance - distancesTo(other, anchors)[magnet]) > 0) inversions++;
      }
    });
  }
  assert.ok(Math.sqrt(squaredError / (nodes.length * anchors.length)) < 20,
    "the whole field must fit the similarity targets, not just keep dots apart");
  assert.ok(inversions / comparisons < .06, "at least 94% of distinct-score comparisons preserve radial order");
});

test("a dot stays closer to its higher-scoring movie across chart widths and densities", () => {
  const ids = ["Avengers: Endgame", "Inception"].map((title) => data.movies.find((movie) => movie.title === title).id);
  for (const width of [240, 320, 640, 1000]) {
    for (const limit of [30, 60, 90]) {
      const matches = getDustMatches(data, scores, ids, limit);
      const anchors = defaultMagnetPositions(2, width, 500);
      assertMovieScoreOrder(layoutDust(matches, anchors, width, 500), anchors);
    }
  }
});

test("single-movie distances preserve the complete anime score ordering after an edge drag", () => {
  const matches = getDustMatches(data, scores, favorites.slice(0, 1), 60);
  const anchors = [{ x: 76, y: 44 }];
  const nodes = layoutDust(matches, anchors, 640, 500);
  for (let i = 1; i < nodes.length; i++) {
    assert.ok(distancesTo(nodes[i], anchors)[0] >= distancesTo(nodes[i - 1], anchors)[0] - 1e-7);
  }
});

test("three-magnet score order is retained when the geometry has space for it", () => {
  const matches = getDustMatches(data, scores, favorites, 60);
  for (const anchors of [defaultMagnetPositions(3, 640, 500),
    [{ x: 150, y: 290 }, { x: 410, y: 305 }, { x: 250, y: 80 }]]) {
    assertMovieScoreOrder(layoutDust(matches, anchors, 640, 500), anchors);
  }
});

test("impossible three-movie orders are explicitly flagged instead of silently claiming accuracy", () => {
  // The middle of three collinear anchors cannot be farthest from any point.
  const matches = [{ anime: { id: "impossible" }, index: 0, scores: [.9, .1, .8] }];
  const anchors = [{ x: 120, y: 250 }, { x: 320, y: 250 }, { x: 520, y: 250 }];
  const [node] = layoutDust(matches, anchors, 640, 500);
  assert.equal(node.approximate, true);
  assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
});

test("all dots clear magnet halos and captions, including after extreme drags", () => {
  for (const width of [240, 320, 640]) {
    const anchors = [{ x: 76, y: 44 }, { x: width - 76, y: 422 }, { x: 76, y: 422 }];
    const nodes = layoutDust(getDustMatches(data, scores, favorites, 90), anchors, width, 500);
    for (const node of nodes) {
      for (const anchor of anchors) {
        assert.ok(Math.hypot(node.x - anchor.x, node.y - anchor.y) >= 48);
        assert.ok(!(Math.abs(node.x - anchor.x) < Math.min(75, width * .19)
          && node.y > anchor.y + 27 && node.y < anchor.y + 66));
      }
    }
  }
});

test("pointer and keyboard movement keep magnets separated and within bounds", () => {
  const { constrainMagnetPosition } = require("../frontend/recommendations/dust-magnet.js");
  for (const width of [240, 320, 640, 1000]) {
    const anchors = defaultMagnetPositions(3, width, 500);
    for (const anchor of anchors) {
      for (const [x, y] of [[-100, -100], [width + 100, 600], [anchors[1].x, anchors[1].y], [width / 2, 250]]) {
        const result = constrainMagnetPosition(anchor, x, y, anchors, width, 500);
        const margin = Math.min(76, width * .22);
        assert.ok(result.x >= margin && result.x <= width - margin);
        assert.ok(result.y >= 44 && result.y <= 422);
        for (const other of anchors.filter((item) => item !== anchor)) {
          assert.ok(Math.hypot(result.x - other.x, result.y - other.y) >= Math.min(110, width * .42) - 1e-6);
        }
        Object.assign(anchor, result);
      }
    }
  }
});

test("layout handles empty selections and tied, perfect, or negative similarity scores", () => {
  const anchors = defaultMagnetPositions(2, 640, 500);
  assert.deepEqual(layoutDust([], anchors, 640, 500), []);
  assert.deepEqual(layoutDust([{ index: 0, scores: [.5] }], [], 640, 500), []);
  const matches = [[1, 0], [0, 1], [-1, -.5], [.5, .5]].map((values, index) => ({
    anime: { id: `synthetic-${index}`, title: `synthetic-${index}` }, index, scores: values
  }));
  assertMovieScoreOrder(layoutDust(matches, anchors, 640, 500), anchors);
});
