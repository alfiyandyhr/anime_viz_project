const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { getDustMatches, defaultMagnetPositions, dustAttraction, createDustNodes, stepDust, layoutDust } = require("../frontend/recommendations/dust-magnet.js");
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

function simulate(nodes, anchors, width = 640, height = 500, ticks = 480) {
  for (let tick = 0; tick < ticks; tick++) stepDust(nodes, anchors, width, height);
  return nodes;
}

function grain(scores, x = 100, y = 100) {
  return { anime: { id: "test", title: "Test" }, index: 0, scores, x, y, vx: 0, vy: 0 };
}

test("single-magnet attraction retains positive-score pull", () => {
  const anchors = [{ x: 300, y: 100 }];
  const force = dustAttraction(grain([.8]), anchors);
  assert.equal(force.x, 18 * .8 * 200);
  assert.equal(force.y, 0);
  assert.deepEqual(dustAttraction(grain([0]), anchors), { x: 0, y: 0 });
  assert.deepEqual(dustAttraction(grain([-.5]), anchors), { x: 0, y: 0 });
  const weak = dustAttraction(grain([.2]), anchors);
  const strong = dustAttraction(grain([.8]), anchors);
  assert.equal(strong.x, weak.x * 4);
});

test("one magnet gathers dust at its surface instead of a distant score radius", () => {
  const anchors = [{ x: 320, y: 250 }];
  const nodes = simulate([grain([.2], 20, 250), grain([.9], 620, 250)], anchors);
  for (const node of nodes) assert.ok(Math.abs(Math.hypot(node.x - 320, node.y - 250) - 34) < 2);
});

function assertScoreOrder(node, anchors) {
  const distances = anchors.map((a) => Math.hypot(node.x - a.x, node.y - a.y));
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
    if (node.scores[i] === node.scores[j]) continue;
    assert.ok((node.scores[i] - node.scores[j]) * (distances[i] - distances[j]) < 0,
      `${node.anime.title || node.anime.id}: scores ${node.scores}, distances ${distances}`);
  }
}

test("higher scores mean shorter distances for uneven triangles and signed scores", () => {
  const layouts = [[{ x: 100, y: 250 }, { x: 540, y: 250 }],
    [{ x: 100, y: 100 }, { x: 540, y: 100 }, { x: 320, y: 450 }],
    defaultMagnetPositions(3, 1000, 500)];
  const permutations = [[.8, .6, .4], [.8, .4, .6], [.6, .8, .4], [.4, .8, .6], [.6, .4, .8], [.4, .6, .8],
    [.501, .5, .499], [0, -.2, -.7], [-.8, -.1, -.5], [.5, .5, .4]];
  for (const anchors of layouts) for (const scores of permutations) {
    const nodes = layoutDust([grain(scores.slice(0, anchors.length))], anchors, 1000, 500);
    assertScoreOrder(nodes[0], anchors);
  }
});

test("moving magnets preserves score order immediately and throughout the animation", () => {
  const anchors = defaultMagnetPositions(3, 640, 500);
  const nodes = layoutDust(getDustMatches(data, scores, favorites, 60), anchors, 640, 500);
  const identities = nodes.slice();
  for (const position of [{ x: 90, y: 75 }, { x: 550, y: 140 }, { x: 320, y: 100 }]) {
    Object.assign(anchors[0], position);
    for (let tick = 0; tick < 60; tick++) {
      stepDust(nodes, anchors, 640, 500, tick === 0 ? 0 : 1 / 60);
      nodes.forEach((node, i) => { assert.equal(node, identities[i]); assertScoreOrder(node, anchors); });
    }
  }
});

test("impossible collinear orders keep the best movie nearest and flag the limitation", () => {
  const anchors = [{ x: 100, y: 250 }, { x: 320, y: 250 }, { x: 540, y: 250 }];
  const [node] = layoutDust([grain([.8, .2, .6])], anchors, 640, 500);
  const distances = anchors.map((a) => Math.hypot(node.x - a.x, node.y - a.y));
  assert.equal(node.scoreLayout.approximate, true);
  assert.equal(distances.indexOf(Math.min(...distances)), 0);
});

test("magnet drags preserve particle identity and bound per-frame travel, even through dust", () => {
  const anchors = [{ x: 320, y: 250 }];
  const nodes = layoutDust(getDustMatches(data, scores, favorites.slice(0, 1), 60), anchors, 640, 500);
  const identities = nodes.slice();
  for (const target of [{ x: 330, y: 250 }, { x: nodes[0].x, y: nodes[0].y }, { x: 76, y: 44 }]) {
    Object.assign(anchors[0], target);
    for (let tick = 0; tick < 120; tick++) {
      const before = nodes.map((n) => ({ x: n.x, y: n.y }));
      stepDust(nodes, anchors, 640, 500);
      nodes.forEach((node, i) => {
        assert.equal(node, identities[i]);
        assert.ok(Math.hypot(node.x - before[i].x, node.y - before[i].y) <= 5.00001);
      });
    }
  }
  const before = { ...nodes[0] };
  stepDust(nodes, anchors, 640, 500, 10); // Resuming a hidden tab must not jump ten seconds.
  assert.ok(Math.hypot(nodes[0].x - before.x, nodes[0].y - before.y) <= 10.00001);
});

test("restoring a chart retains positions and momentum by anime ID, including resize", () => {
  const matches = getDustMatches(data, scores, favorites, 30);
  const nodes = layoutDust(matches, defaultMagnetPositions(3, 640, 500), 640, 500);
  const previous = { width: 640, height: 500, positions: new Map(nodes.map((n) => [n.anime.id, n])) };
  const restored = createDustNodes(matches.slice().reverse(), defaultMagnetPositions(3, 320, 440), 320, 440, previous);
  restored.forEach((node) => {
    const saved = previous.positions.get(node.anime.id);
    assert.ok(Math.abs(node.x - saved.x / 2) < 1e-10);
    assert.ok(Math.abs(node.y - saved.y * 440 / 500) < 1e-10);
    assert.equal(node.vx, saved.vx);
  });
});

test("1-3 magnets gather 30-90 readable dots inside mobile and desktop bounds", () => {
  for (const width of [240, 320, 640, 1000]) {
    for (const count of [1, 2, 3]) {
      for (const limit of [30, 60, 90]) {
        const matches = getDustMatches(data, scores, favorites.slice(0, count), limit);
        const before = JSON.stringify(matches);
        const anchors = defaultMagnetPositions(count, width, 500);
        const nodes = layoutDust(matches, anchors, width, 500);
        assert.equal(JSON.stringify(matches), before);
        for (const [i, node] of nodes.entries()) {
          assertScoreOrder(node, anchors);
          assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
          assert.ok(node.x >= 14 && node.x <= width - 14 && node.y >= 18 && node.y <= 482);
          for (const other of nodes.slice(i + 1)) {
            assert.ok(Math.hypot(node.x - other.x, node.y - other.y) > 10,
              `overlap at ${width}px, ${count} magnets, ${limit} dots`);
          }
          for (const anchor of anchors) assert.ok(Math.hypot(node.x - anchor.x, node.y - anchor.y) > 29);
        }
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

test("dense constrained dust settles instead of animating idle contact jitter forever", () => {
  for (const width of [240, 640]) {
    const anchors = defaultMagnetPositions(3, width, 500);
    const nodes = layoutDust(getDustMatches(data, scores, favorites, 90), anchors, width, 500);
    let quietFrames = 0;
    for (let frame = 0; frame < 600 && quietFrames < 24; frame++) {
      quietFrames = stepDust(nodes, anchors, width, 500) < .015 ? quietFrames + 1 : 0;
    }
    assert.equal(quietFrames, 24, `never settled at ${width}px`);
    nodes.forEach((node) => assertScoreOrder(node, anchors));
  }
});

test("empty selections, tied and nonpositive scores remain finite and deterministic", () => {
  const anchors = defaultMagnetPositions(2, 640, 500);
  assert.deepEqual(layoutDust([], anchors, 640, 500), []);
  assert.deepEqual(layoutDust([grain([.5])], [], 640, 500), []);
  const matches = [[1, 0], [0, 1], [-1, -.5], [0, 0], [.5, .5]].map((values, index) => ({
    anime: { id: `synthetic-${index}` }, index, scores: values
  }));
  const nodes = layoutDust(matches, anchors, 640, 500);
  assert.deepEqual(nodes, layoutDust(matches, anchors, 640, 500));
  for (const node of nodes) assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
});
