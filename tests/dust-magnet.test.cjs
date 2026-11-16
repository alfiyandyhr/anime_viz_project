const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const vm = require("node:vm");
const { getDustMatches, defaultMagnetPositions, createDustNodes, rebaseDustPositions, dragDustStep, constrainMagnetPosition } = require("../frontend/recommendations/dust-magnet.js");
const data = JSON.parse(readFileSync(require.resolve("../data/movie_recommendations.json"), "utf8"));
const binary = readFileSync(require.resolve("../data/movie_anime_scores.bin"));
const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
const scores = Float32Array.from({ length: binary.length / 4 }, (_, index) => view.getFloat32(index * 4, true));
const favorites = ["Inception", "Interstellar", "The Matrix"].map((title) => data.movies.find((movie) => movie.title === title).id);

test("empty field clicks deselect once while dust, magnet, controls, drag and outside clicks preserve selection", () => {
  const element = (parent = null, kind = '') => ({
    parent, listeners: {},
    addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); },
    closest(selector) {
      return selector.split(',').map(s => s.trim()).includes(kind) ? this : parent?.closest(selector);
    }
  });
  const document = element(), playground = element(document), detail = element(document);
  const dot = element(playground, '.dust-node'), grain = element(dot);
  const magnet = element(playground, '.dust-magnet'), core = element(magnet);
  const retry = element(playground, 'button');
  const controls = new Map([["#recommendation-chart", playground]]);
  document.querySelector = selector => {
    if (!controls.has(selector)) controls.set(selector, element(document));
    return controls.get(selector);
  };
  let deselections = 0;
  const context = vm.createContext({ document, hideTooltip() {},
    AnivizMain: { deselectLast() { deselections++; }, resetPositions() {}, resetStrengths() {} } });
  vm.runInContext(readFileSync(require.resolve("../frontend/recommendations/dust-magnet.js"), "utf8"), context);
  vm.runInContext("bindDustControls();", context);
  const click = (target, defaultPrevented = false) => {
    for (let current = target; current; current = current.parent) {
      for (const handler of current.listeners.click || []) handler({ target, defaultPrevented });
    }
  };
  for (const target of [detail, document, document.querySelector("#dust-limit"), dot, grain, magnet, core, retry]) click(target);
  click(playground, true); // D3 suppresses the click following a magnet drag.
  assert.equal(deselections, 0);
  for (let i = 1; i <= 3; i++) {
    click(playground);
    assert.equal(deselections, i);
  }
});

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

function grain(scores, x = 100, y = 100) {
  return { key: "anilist:test", scores, x, y };
}

const FRAME_TIME = 1 / 60;
const FRAME_BUDGET = 2;
const SLOW_FRAME_BUDGET = 3;
const WIDTH = 640;
const HEIGHT = 500;

const sample = limit => getDustMatches(data, scores, favorites, limit)
  .map(match => ({ ...match, key: `anilist:${match.anime.id}` }));
const maxTravel = (nodes, before) => Math.max(...nodes.map((node, index) => distance(node, before[index])));

test("exported 30-, 60- and 90-dot samples stay bounded crossing a straight line and during fast sweeps", () => {
  for (const width of [320, WIDTH]) {
    for (const limit of [30, 60, 90]) {
      const inset = Math.min(76, width * .22);
      const anchors = [{ x: width / 2, y: 300 }, { x: inset, y: 350 }, { x: width - inset, y: 350 }];
      let nodes = createDustNodes(sample(limit), width, HEIGHT);
      for (const [x, y, elapsed, budget] of [
        ...[350, 349, 350, 351].map(y => [width / 2, y, FRAME_TIME, FRAME_BUDGET]),
        [inset, 44, .1, SLOW_FRAME_BUDGET], [width - inset, 420, 10, SLOW_FRAME_BUDGET]
      ]) {
        Object.assign(anchors[0], { x, y });
        const next = dragDustStep(nodes, anchors, width, HEIGHT, elapsed);
        const travel = maxTravel(next, nodes);
        assert.ok(travel > 0 && travel <= budget + 1e-9);
        for (const { x, y } of next) {
          assert.ok(x >= 14 && x <= width - 14 && y >= 18 && y <= HEIGHT - 18);
        }
        nodes = nodes.map((node, index) => ({ ...node, ...next[index] }));
      }
    }
  }
});

function mockChart(reducedMotion) {
  const frames = new Map(), draws = [[], []], controls = [];
  let nextFrame = 0, time = 0, saves = 0;
  const field = { clientWidth: WIDTH, clientHeight: HEIGHT, isConnected: true };
  const mirror = {};
  const elements = new Map();
  const state = vm.createContext({
    field, mirror,
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    document: { querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {});
      return elements.get(selector);
    } },
    AnivizDust: { REVERSE: "reverse" },
    AnivizMain: { snapshot: () => ({ selectedKeys: [] }), color: () => "blue",
      magnetStrength: () => 1, saveLayout() { saves++; } },
    recommendationState: { magnetPositions: {} },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    mockDustView(container, matches, anchors, width, height, movement) {
      controls.push({ anchor: anchors[0], ...movement });
      return {
        draw(positions) {
          const node = positions.get("anilist:test");
          draws[container === field ? 0 : 1].push({ x: node.x, y: node.y });
        },
        drawLinks() {}
      };
    }
  });
  vm.runInContext(readFileSync(require.resolve("../frontend/recommendations/dust-magnet.js"), "utf8"), state);
  vm.runInContext(`
    createDustView = mockDustView;
    const node = { key: "anilist:test", x: 100, y: 100, scores: [1] };
    dustChart = { width: ${WIDTH}, height: ${HEIGHT}, positions: new Map([[node.key, node]]) };
    renderDustChart(field, mirror, [{ key: "magnet" }], [node], false);
  `, state);
  return {
    ...controls[1],
    advanceFrame(delay = 1000 / 60) {
      assert.equal(frames.size, 1);
      const [[id, callback]] = frames;
      frames.delete(id);
      callback(time += delay);
    },
    attractDust: () => vm.runInContext("dustChart.attractDust()", state),
    stop: () => vm.runInContext("stopDustChart()", state),
    get point() {
      assert.deepEqual(draws[0], draws[1]);
      return draws[0].at(-1);
    },
    get draws() { return draws[0].length; },
    get frames() { return frames.size; },
    get saves() { return saves; }
  };
}

test("both views share one bounded frame per pointer move and stay still during a hold and after release", () => {
  const chart = mockChart(false);
  const { anchor, startMove, moveAnchor, endMove } = chart;
  const start = chart.point;
  assert.equal(chart.frames, 0);
  endMove(startMove(anchor)); // Click.
  assert.equal(chart.frames, 0);
  assert.deepEqual(chart.point, start);

  const gesture = startMove(anchor);
  moveAnchor(gesture, 450, 350);
  moveAnchor(gesture, 500, 340);
  assert.equal(chart.draws, 1);
  chart.advanceFrame();
  assert.equal(chart.draws, 2);
  assert.deepEqual([anchor.x, anchor.y], [500, 340]);
  assert.ok(distance(chart.point, start) > 0 && distance(chart.point, start) <= FRAME_BUDGET + 1e-9);
  const held = chart.point;
  assert.equal(chart.frames, 0);
  moveAnchor(gesture, 500, 340); // Duplicate pointer event while stationary.
  chart.advanceFrame();
  assert.deepEqual(chart.point, held);
  assert.equal(chart.draws, 2);
  assert.equal(chart.frames, 0);

  moveAnchor(gesture, 140, 60);
  chart.advanceFrame(1000);
  assert.ok(distance(chart.point, held) > 0 && distance(chart.point, held) <= FRAME_BUDGET + 1e-9);
  const released = chart.point;
  moveAnchor(gesture, 90, 60);
  endMove(gesture);
  assert.deepEqual([anchor.x, anchor.y], [90, 60]);
  assert.deepEqual(chart.point, released);
  assert.equal(chart.frames, 0);
  assert.equal(chart.saves, 1);
});

test("reduced motion applies a single bounded dust step only after a moved magnet is released", () => {
  const chart = mockChart(true);
  const { anchor, startMove, moveAnchor, endMove } = chart;
  const start = chart.point;
  endMove(startMove(anchor));
  assert.deepEqual(chart.point, start);
  const gesture = startMove(anchor);
  moveAnchor(gesture, 500, 340);
  chart.advanceFrame(1000);
  assert.equal(anchor.x, 500);
  assert.deepEqual(chart.point, start);
  assert.equal(chart.frames, 0);
  moveAnchor(gesture, 510, 340);
  endMove(gesture);
  assert.equal(anchor.x, 510);
  assert.ok(distance(chart.point, start) > 0 && distance(chart.point, start) <= FRAME_BUDGET + 1e-9);
  assert.equal(chart.frames, 0);
  assert.equal(chart.saves, 1);
});

test("cancellation and chart teardown discard pending moves and simulation time", () => {
  for (const reducedMotion of [false, true]) {
    const chart = mockChart(reducedMotion);
    const { anchor, startMove, moveAnchor, endMove } = chart;
    const gesture = startMove(anchor);
    moveAnchor(gesture, 500, 340);
    chart.advanceFrame();
    const held = chart.point;
    moveAnchor(gesture, 520, 340);
    endMove(gesture, true);
    assert.equal(anchor.x, 500);
    assert.deepEqual(chart.point, held);
    assert.equal(chart.frames, 0);

    const hidden = startMove(anchor);
    moveAnchor(hidden, 530, 340);
    chart.stop();
    endMove(hidden);
    assert.equal(anchor.x, 500);
    assert.deepEqual(chart.point, held);
    assert.equal(chart.frames, 0);
  }
});

test("keyboard and Attract dust actions each apply one bounded step", () => {
  for (const reducedMotion of [false, true]) {
    const chart = mockChart(reducedMotion);
    const start = chart.point;
    chart.nudgeAnchor(chart.anchor, 12, 0);
    assert.equal(chart.anchor.x, WIDTH / 2 + 12);
    const nudged = chart.point;
    assert.ok(distance(nudged, start) > 0 && distance(nudged, start) <= FRAME_BUDGET + 1e-9);
    chart.attractDust();
    assert.ok(distance(chart.point, nudged) > 0 && distance(chart.point, nudged) <= FRAME_BUDGET + 1e-9);
    assert.equal(chart.draws, 3);
    assert.equal(chart.frames, 0);
    assert.equal(chart.saves, 2);
  }
});

test("rerender and resize restore positions by typed key and drop legacy velocities", () => {
  const matches = sample(30);
  const nodes = createDustNodes(matches, WIDTH, HEIGHT);
  const previous = { width: WIDTH, height: HEIGHT,
    positions: new Map(nodes.map(node => [node.key, { ...node, vx: 40, vy: -20 }])) };
  const restored = createDustNodes(matches.slice().reverse(), 320, 440, rebaseDustPositions(previous, 320, 440));
  restored.forEach(node => {
    const saved = previous.positions.get(node.key);
    near(node.x, saved.x / 2);
    near(node.y, saved.y * 440 / HEIGHT);
    assert.equal(node.vx, undefined);
    assert.equal(node.vy, undefined);
  });
});

test("first entry seeds a deterministic, compact cloud with individually reachable dots", () => {
  for (const width of [240, 320, WIDTH, 1000]) {
    for (const limit of [30, 60, 90]) {
      const matches = sample(limit);
      const nodes = createDustNodes(matches, width, HEIGHT);
      assert.deepEqual(nodes, createDustNodes(matches, width, HEIGHT));
      for (const [index, node] of nodes.entries()) {
        assert.ok(node.x >= 14 && node.x <= width - 14 && node.y >= 18 && node.y <= HEIGHT - 18);
        assert.ok(distance(node, { x: width / 2, y: HEIGHT / 2 }) < 120);
        for (const other of nodes.slice(index + 1)) assert.ok(distance(node, other) > 9);
      }
    }
  }
  assert.deepEqual(createDustNodes([], WIDTH, HEIGHT), []);
});

test("adding magnets and changing dot count seed new grains clear of the saved grains", () => {
  const positions = new Map();
  for (const [limit, magnetCount] of [[60, 1], [60, 2], [60, 3], [30, 3], [90, 3]]) {
    const matches = getDustMatches(data, scores, favorites.slice(0, magnetCount), limit)
      .map(match => ({ ...match, key: `anilist:${match.anime.id}` }));
    const nodes = createDustNodes(matches, 240, 260, positions);
    for (const [index, node] of nodes.entries()) {
      const saved = positions.get(node.key);
      if (saved) assert.equal(distance(node, saved), 0);
      for (const other of nodes.slice(index + 1)) assert.ok(distance(node, other) >= 12);
      positions.set(node.key, node);
    }
  }
});

test("pointer and keyboard movement keep magnets separated and within bounds", () => {
  for (const width of [240, 320, 640, 1000]) {
    const anchors = defaultMagnetPositions(3, width, 500);
    for (const anchor of anchors) {
      for (const [x, y] of [[-100, -100], [width + 100, 600], [anchors[1].x, anchors[1].y], [width / 2, 250]]) {
        const result = constrainMagnetPosition(anchor, x, y, anchors, width, 500);
        const margin = Math.min(76, width * .22);
        assert.ok(result.x >= margin && result.x <= width - margin);
        assert.ok(result.y >= 44 && result.y <= 422);
        for (const other of anchors.filter((item) => item !== anchor)) {
          const separation = Math.min(110, (width - 2 * margin - 8) / 2);
          assert.ok(Math.hypot(result.x - other.x, result.y - other.y) >= separation - 1e-6);
        }
        Object.assign(anchor, result);
      }
    }
  }
});

const dragPoint = (node, anchors, elapsed = 1 / 60) => dragDustStep([node], anchors, 640, 500, elapsed)[0];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("drag pull scales with elapsed time, affinity and strength below the shared cap", () => {
  const node = grain([.25], 320, 250);
  const anchor = { x: 500, y: 250, strength: 1 };
  const move = (scores, strength, elapsed) => dragPoint({ ...node, scores }, [{ ...anchor, strength }], elapsed).x - node.x;
  const baseline = move([.25], 1, 1 / 60);
  assert.ok(baseline > 0 && baseline < .25);
  near(move([.25], 2, 1 / 60), 2 * baseline);
  near(move([.5], 1, 1 / 60), 2 * baseline);
  near(move([.25], 1, 1 / 120), baseline / 2);
  near(move([2], 1, 1 / 60), 4 * baseline);
  const mixed = { ...node, scores: [.25], rawScores: [100_000] };
  assert.deepEqual(dragPoint(mixed, [anchor]), dragPoint(node, [anchor]));
  assert.deepEqual(dragPoint(node, [anchor], 0), { x: node.x, y: node.y });
});

test("collinear pulls cancel or reinforce, and changing strength can reverse the net pull", () => {
  const node = grain([.5, .5], 320, 250);
  const left = { x: 100, y: 250 }, right = { x: 540, y: 250 };
  assert.deepEqual(dragPoint(node, [left, right]), { x: node.x, y: node.y });
  const pull = node.x - dragPoint(node, [left]).x;
  assert.ok(pull > 0);
  near(dragPoint(node, [left, { x: 200, y: 250 }]).x, node.x - 2 * pull);
  near(dragPoint(node, [{ ...left, strength: 2 }, right]).x, node.x - pull);
  near(dragPoint(node, [{ ...left, strength: 0 }, right]).x, node.x + pull);

  const tied = grain([1, 1, 1], 320, 250);
  const sameSide = [right, { x: 550, y: 250 }, { x: 560, y: 250 }].map(anchor => ({ ...anchor, strength: 2 }));
  near(dragPoint(tied, sameSide).x, tied.x + 2);
  near(dragPoint(tied, sameSide, 10).x, tied.x + 3);
});

test("missing scores are skipped, nonpositive scores do not attract, and muted magnets give no clearance", () => {
  const node = grain([.8], 320, 250);
  const nearAnchor = { x: 322, y: 250 }, farAnchor = { x: 500, y: 250 };
  const start = { x: node.x, y: node.y };
  for (const missing of [null, undefined, NaN, Infinity]) {
    assert.deepEqual(dragPoint({ ...node, scores: [missing] }, [nearAnchor]), start);
  }
  for (const score of [-.8, 0]) {
    assert.deepEqual(dragPoint({ ...node, scores: [score] }, [farAnchor]), start);
  }
  const threeScores = { ...node, scores: [.8, 1, 1] };
  assert.deepEqual(dragPoint(threeScores, [farAnchor, { ...nearAnchor, strength: 0 }, { x: 100, y: 250, strength: 0 }]),
    dragPoint(node, [farAnchor]));
  const muted = { ...nearAnchor, strength: 0 };
  assert.deepEqual(dragDustStep([node, node], [muted], 640, 500), [start, start]);
});

test("tapered pull and clearance stay continuous and finite at the magnet center", () => {
  const node = grain([.8], 320, 250);
  const start = { x: node.x, y: node.y };
  const at = dx => ({ x: node.x + dx, y: node.y });
  assert.deepEqual(dragPoint(node, [at(0)]), start);
  const pull = dx => dragPoint(node, [at(dx)]).x - dragPoint({ ...node, scores: [0] }, [at(dx)]).x;
  near(pull(1), 2 * pull(.5));
  near(pull(1), -pull(-1));
  assert.ok(pull(1) > 0);
  for (const dx of [-.001, .001]) assert.ok(distance(dragPoint(node, [at(dx)]), start) < .001);
});

test("drag displacement survives a magnet permutation and changes continuously through collinearity", () => {
  const node = grain([.7, .2, .7], 270, 255);
  const anchors = [{ x: 100, y: 350, strength: 2 }, { x: 320, y: 349, strength: .75 }, { x: 540, y: 350 }];
  const order = [2, 0, 1];
  let previous = dragPoint(node, anchors);
  for (let i = 1; i <= 16; i++) {
    anchors[1].y = 349 + i / 8;
    const next = dragPoint(node, anchors);
    assert.ok(distance(next, previous) > 0 && distance(next, previous) < .001);
    const permuted = dragPoint({ ...node, scores: order.map(i => node.scores[i]) }, order.map(i => anchors[i]));
    near(distance(next, permuted), 0);
    previous = next;
  }
});

test("local spacing separates coincident grains gently and fits the total travel and field limits", () => {
  const nodes = [Object.freeze(grain([1, 1, 1], 320, 250)), Object.freeze(grain([1, 1, 1], 320, 250))];
  Object.freeze(nodes);
  const noPull = [{ x: 320, y: 250 }];
  const spaced = dragDustStep(nodes, noPull, 640, 500);
  assert.ok(distance(...spaced) > 0 && distance(...spaced) <= 2);
  near((spaced[0].x + spaced[1].x) / 2, nodes[0].x);
  near((spaced[0].y + spaced[1].y) / 2, nodes[0].y);
  const anchors = [410, 520, 630].map(x => Object.freeze({ x, y: 300, strength: 2 }));
  const next = dragDustStep(nodes, Object.freeze(anchors), 640, 500, 10);
  next.forEach((point, i) => assert.ok(distance(point, nodes[i]) <= 3 + 1e-9));
  const edge = grain([1], 14, 18);
  assert.deepEqual(dragPoint(edge, [{ x: -100, y: -100 }]), { x: 14, y: 18 });
});

test("a dense 90-dot drag keeps each grain reachable within its hit area", () => {
  const nodes = getDustMatches(data, scores, favorites, 90).map((match, i) => ({
    ...match, x: 260 + (i % 10) * 12, y: 200 + Math.floor(i / 10) * 12
  }));
  const anchors = [{ x: 100, y: 350 }, { x: 320, y: 350, strength: 2 }, { x: 540, y: 350 }];
  // Try the center and nearby points within the SVG's 9-unit hit radius.
  const hitOffsets = [{ x: 0, y: 0 }, ...[4, 8].flatMap(radius => Array.from({ length: 12 }, (_, i) => ({
    x: radius * Math.cos(i * Math.PI / 6), y: radius * Math.sin(i * Math.PI / 6)
  })))];
  for (let frame = 0; frame < 300; frame++) {
    anchors[1].y = 350 + 48 * Math.sin(frame / 20);
    const next = dragDustStep(nodes, anchors, 640, 500);
    next.forEach((point, i) => {
      assert.ok(distance(point, nodes[i]) <= FRAME_BUDGET + 1e-9);
      Object.assign(nodes[i], point);
    });
    if ((frame + 1) % 60 !== 0) continue;
    nodes.forEach((node, i) => {
      assert.ok(hitOffsets.some(offset => {
        const hit = { x: node.x + offset.x, y: node.y + offset.y };
        return nodes.slice(i + 1).every(above => distance(hit, above) > 9)
          && anchors.every(anchor => distance(hit, anchor) > 25);
      }), `grain ${i} is covered at frame ${frame + 1}`);
    });
  }
});
