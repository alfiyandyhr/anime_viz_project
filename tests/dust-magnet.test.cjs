const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const vm = require("node:vm");
const DustContext = require("../frontend/common/dust-context.js");
const { createContext, DEFAULT_MOTION } = DustContext;
const { getDustMatches, defaultMagnetPositions, dustAttraction, createDustNodes, stepDust, layoutDust } = require("../frontend/recommendations/dust-magnet.js");
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
  const context = vm.createContext({ document, AnivizDust: DustContext, hideTooltip() {},
    AnivizMain: { deselectLast() { deselections++; } } });
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

function simulate(nodes, anchors, width = 640, height = 500, ticks = 480, mixed = false) {
  for (let tick = 0; tick < ticks; tick++) stepDust(nodes, anchors, width, height, 1 / 60, mixed);
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

test("one magnet gives stronger published matches a smaller settled radius", () => {
  const [anchor] = defaultMagnetPositions(1, 640, 500);
  const nodes = layoutDust(getDustMatches(data, scores, favorites.slice(0, 1), 60), [anchor], 640, 500);
  const medianRadius = group => group.map(node => distanceTo(node, anchor)).sort((a, b) => a - b)[7];
  assert.ok(medianRadius(nodes.slice(-15)) - medianRadius(nodes.slice(0, 15)) > 20);
  assertReadable(nodes, [anchor], 640, 500);
});

test("motion settings scale the pull and damping independently of clearance and collisions", () => {
  const anchors = [{ x: 320, y: 250 }];
  const settings = (patch) => ({ ...DEFAULT_MOTION, ...patch });
  const step = (nodes, patch) => stepDust(nodes, anchors, 640, 500, 1 / 120, false, settings(patch));
  const weakPull = grain([.5], 200, 250);
  const strongPull = { ...weakPull };
  step([weakPull], { strength: .5 });
  step([strongPull], { strength: 1.5 });
  assert.ok(Math.abs(strongPull.vx / weakPull.vx - 3) < 1e-10);

  const drifting = { ...grain([-.1], 200, 250), vx: 120 };
  const damped = { ...drifting };
  step([drifting], { damping: 6 });
  step([damped], { damping: 16 });
  assert.ok(Math.abs(damped.vx / drifting.vx - Math.exp(-10 / 120)) < 1e-10);

  const contacts = [grain([-.1], 349, 250), grain([-.2], 356, 250)];
  const other = contacts.map(node => ({ ...node }));
  step(contacts, { strength: .5 });
  step(other, { strength: 1.5 });
  assert.deepEqual(other, contacts);
  assert.ok(contacts[0].vx < contacts[1].vx);
});

test("changing rank spread refreshes preferred distances in place and zero removes the rank force", () => {
  const anchors = [{ x: 320, y: 250 }];
  const starting = { ...grain([.5], 370, 250), winnerPercentile: .5, vx: 15 };
  const node = { ...starting };
  const step = rankSpread => stepDust([node], anchors, 640, 500, 1 / 120, false, { ...DEFAULT_MOTION, rankSpread });
  step(100);
  const extended = node.scoreLayout.preferredRadius;
  assert.ok(node.vx > starting.vx);
  Object.assign(node, starting);
  step(80);
  assert.ok(node.scoreLayout.preferredRadius < extended);
  Object.assign(node, starting);
  step(0);
  assert.equal(node.scoreLayout.preferredRadius, null);
  assert.ok(node.vx < starting.vx);
});

function distanceTo(node, anchor) {
  return Math.hypot(node.x - anchor.x, node.y - anchor.y);
}

function winnerIsNearest(node, anchors) {
  const distances = anchors.map((anchor) => distanceTo(node, anchor));
  const winner = node.scores.indexOf(Math.max(...node.scores));
  return distances[winner] === Math.min(...distances);
}

function scoreGap(node) {
  const [best, next] = node.scores.slice().sort((a, b) => b - a);
  return best - next;
}

test("the rank force fades near a tie and leaves an exact tie in the shared region", () => {
  const anchors = [{ x: 100, y: 250 }, { x: 540, y: 250 }];
  function rankEffect(lead) {
    const nodes = [.98, .6].map(winnerPercentile => {
      const node = { ...grain([.5 + lead, .5], 250, 200), winnerPercentile };
      stepDust([node], anchors, 640, 500);
      return node;
    });
    return distanceTo(...nodes);
  }
  const clear = rankEffect(.2);
  assert.ok(clear > .1);
  assert.ok(rankEffect(.001) < clear / 100);
  assert.equal(rankEffect(0), 0);
});

test("a magnet centered on a title pushes it in the same direction after reordering dust", () => {
  const anchors = [{ x: 320, y: 250 }];
  const centered = { ...grain([-.1], 320, 250), winnerPercentile: .9 };
  const alone = { ...centered };
  stepDust([alone], anchors, 640, 500);
  stepDust([grain([.1], 520, 250), centered], anchors, 640, 500);
  assert.ok(distanceTo(centered, anchors[0]) > 0);
  assert.equal(distanceTo(centered, alone), 0);
});

function assertClearFavorites(nodes, anchors, gap) {
  const favorites = nodes.filter(node => scoreGap(node) >= gap);
  assert.ok(favorites.length, "expected scored titles with a clear favorite");
  for (const node of favorites) {
    assert.ok(winnerIsNearest(node, anchors), `scores ${node.scores}, distances ${anchors.map(a => distanceTo(node, a))}`);
  }
}

function targetFor(scores, anchors, mixed = false) {
  const node = grain(scores);
  stepDust([node], anchors, 640, 500, 1 / 60, mixed);
  return node.scoreLayout.target;
}

test("pair targets lie between magnets and close in proportion to their separation", () => {
  const pairs = [332.8, 110, 0].map(separation => [
    { x: 320 - separation / 2, y: 250 }, { x: 320 + separation / 2, y: 250 }
  ]);
  for (const [a, b] of pairs) {
    const target = targetFor([.391265, .492689], [a, b]);
    assert.ok(Math.abs(target.y - 250) < 1e-8);
    const separation = b.x - a.x;
    if (separation > 0) {
      const fraction = (target.x - a.x) / separation;
      assert.ok(fraction > .70 && fraction < .85, "a large lead favors one magnet with room left for the other");
      const close = targetFor([.49, .5], [a, b]);
      assert.ok(close.x > 320 && close.x - 320 < .04 * separation, "a small lead keeps the target near the midpoint");
    } else {
      assert.ok(Math.abs(target.x - 320) < 1e-8);
    }
    const signed = targetFor([.391265 - 1, .492689 - 1], [a, b]);
    assert.ok(distanceTo(signed, target) < 1e-8, "relative signed scores determine the target");
    assert.ok(distanceTo(targetFor([.5, .5], [a, b]), { x: 320, y: 250 }) < 1e-8);
  }
  const cosine = targetFor([.4, .5], pairs[0]);
  const percentile = targetFor([.4, .5], pairs[0], true);
  assert.ok(percentile.x > 320 && percentile.x < cosine.x, "percentile gaps use a wider temperature");
});

test("trio targets are convex weighted centers on both sides of a straight line", () => {
  const a = { x: 100, y: 250 }, b = { x: 540, y: 250 };
  const scores = [.61, .56, .58];
  const targets = [-.5, 0, .5].map(delta => {
    const c = { x: 320, y: 250 + delta };
    const target = targetFor(scores, [a, b, c]);
    assert.ok(target.x > a.x && target.x < b.x);
    assert.ok(target.y >= Math.min(a.y, c.y) - 1e-8 && target.y <= Math.max(a.y, c.y) + 1e-8);
    const permuted = targetFor([scores[2], scores[0], scores[1]], [c, a, b]);
    assert.ok(distanceTo(permuted, target) < 1e-8);
    return target;
  });
  assert.ok(distanceTo(targets[0], targets[1]) < .5);
  assert.ok(distanceTo(targets[1], targets[2]) < .5);
  assert.ok(targets[0].y < targets[1].y && targets[1].y < targets[2].y);
});

test("clear favorites settle nearest their winning magnet across layouts and signed scores", () => {
  const layouts = [[{ x: 100, y: 250 }, { x: 540, y: 250 }],
    [{ x: 100, y: 100 }, { x: 540, y: 100 }, { x: 320, y: 450 }],
    defaultMagnetPositions(3, 1000, 500)];
  const permutations = [[.8, .6, .4], [.8, .4, .6], [.6, .8, .4], [.4, .8, .6], [.6, .4, .8], [.4, .6, .8],
    [0, -.2, -.7], [-.8, -.1, -.5]];
  for (const anchors of layouts) for (const scores of permutations) {
    const nodes = layoutDust([grain(scores.slice(0, anchors.length))], anchors, 1000, 500);
    assertClearFavorites(nodes, anchors, .15);
  }
});

test("a shallow triangle and a close pair keep published favorites near their magnets", () => {
  const scenarios = [
    { width: 640, height: 500, anchors: [{ x: 416, y: 244 }, { x: 526, y: 244 }] },
    { width: 775, height: 697, anchors: [{ x: 386.75, y: 160.25 }, { x: 177.25, y: 487.75 }, { x: 528.25, y: 111.75 }] }
  ];
  for (const { width, height, anchors } of scenarios) {
    const matches = getDustMatches(data, scores, favorites.slice(0, anchors.length), 60);
    const nodes = layoutDust(matches, anchors, width, height);
    assertClearFavorites(nodes, anchors, .04);
    for (const node of nodes) {
      assert.ok(node.x > 14 && node.x < width - 14 && node.y > 18 && node.y < height - 18);
    }
    if (anchors.length === 3) {
      assert.equal(nodes.filter(node => node.closest === 2).length, 39);
      assert.ok(nodes.some(node => scoreGap(node) < .01 && !winnerIsNearest(node, anchors)), "near ties can share space");
    }
  }
});

test("published near ties share space in the default field with visible clearance around magnets", () => {
  const width = 730, height = 550;
  const anchors = defaultMagnetPositions(3, width, height);
  const nodes = layoutDust(getDustMatches(data, scores, favorites, 60), anchors, width, height);
  const nearTies = nodes.filter(node => scoreGap(node) < .01);
  assert.ok(nearTies.length >= 5);
  for (const node of nearTies) {
    const leaders = anchors.map((_, i) => i).sort((a, b) => node.scores[b] - node.scores[a]).slice(0, 2);
    const [a, b] = leaders.map(i => anchors[i]);
    const distanceGap = Math.abs(distanceTo(node, a) - distanceTo(node, b));
    assert.ok(distanceGap < .20 * distanceTo(a, b), `${node.anime.title} should stay between its top magnets`);
  }
  assert.ok(nodes.every(node => anchors.every(anchor => distanceTo(node, anchor) > 38)));
  assertClearFavorites(nodes, anchors, .04);
});

test("published popularity blends stay readable when percentile magnets move close together", () => {
  const context = createContext();
  context.setSources(data, scores);
  const dashboard = JSON.parse(readFileSync(require.resolve("../data/anilist_dashboard_cache.json"), "utf8"));
  context.setMetadata(dashboard.anime);
  const { displayedDust, mixed } = context.setMagnets(["tmdb:27205", "tmdb:157336", "anilist:popularity"]);
  assert.equal(mixed, true);
  const anchors = [{ x: 76, y: 100 }, { x: 186, y: 100 }, { x: 241, y: 195.3 }];
  const nodes = layoutDust(displayedDust, anchors, 320, 440, mixed);
  assertClearFavorites(nodes, anchors, .18);
  assertReadable(nodes, anchors, 320, 440);
  assert.deepEqual(nodes.map(node => [node.key, node.closest, node.rank, node.scores, node.rawScores]),
    displayedDust.map(node => [node.key, node.closest, node.rank, node.scores, node.rawScores]));
});

test("dragging through a line retains particles and updates positions only on animation steps", () => {
  const anchors = defaultMagnetPositions(3, 640, 500);
  const nodes = layoutDust(getDustMatches(data, scores, favorites, 60), anchors, 640, 500);
  const identities = nodes.slice();
  const evidence = nodes.map(node => ({
    id: node.anime.id, closest: node.closest, scores: node.scores, rank: node.rank
  }));
  for (let y = 118; y <= 430; y += 3) {
    anchors[0].y = y;
    const before = nodes.map(({ x, y, vx, vy }) => ({ x, y, vx, vy }));
    assert.equal(stepDust(nodes, anchors, 640, 500, 0), 0);
    assert.deepEqual(nodes.map(({ x, y, vx, vy }) => ({ x, y, vx, vy })), before);
    assert.ok(stepDust(nodes, anchors, 640, 500) <= 2.42, "movement stays within the speed cap");
  }
  simulate(nodes, anchors);
  assertClearFavorites(nodes, anchors, .04);
  nodes.forEach((node, i) => { assert.equal(node, identities[i]); });
  assert.deepEqual(nodes.map(({ anime, closest, scores, rank }) => ({ id: anime.id, closest, scores, rank })), evidence);
});

test("changing attraction scores refreshes geometry with fixed magnet positions", () => {
  const anchors = [{ x: 100, y: 250 }, { x: 540, y: 250 }];
  const node = grain([.8, .2], 250, 250);
  stepDust([node], anchors, 640, 500);
  assert.ok(node.scoreLayout.target.x < 320);
  node.scores = [.2, .8];
  stepDust([node], anchors, 640, 500);
  assert.ok(node.scoreLayout.target.x > 320);
  simulate([node], anchors);
  assertClearFavorites([node], anchors, .15);
});

test("lower-ranked magnets can swap distance order in a straight line", () => {
  const anchors = [{ x: 100, y: 250 }, { x: 320, y: 250 }, { x: 540, y: 250 }];
  const [node] = layoutDust([grain([.8, .2, .6])], anchors, 640, 500);
  assertClearFavorites([node], anchors, .15);
  assert.ok(distanceTo(node, anchors[1]) < distanceTo(node, anchors[2]));
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
        assert.ok(Math.hypot(node.x - before[i].x, node.y - before[i].y) <= 2.42);
      });
    }
  }
  const before = { ...nodes[0] };
  stepDust(nodes, anchors, 640, 500, 10); // Resuming a hidden tab must not jump ten seconds.
  assert.ok(Math.hypot(nodes[0].x - before.x, nodes[0].y - before.y) <= 4.84);
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

function assertReadable(nodes, anchors, width, height) {
  for (const [index, node] of nodes.entries()) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x >= 14 && node.x <= width - 14 && node.y >= 18 && node.y <= height - 18);
    for (const other of nodes.slice(index + 1)) {
      assert.ok(distanceTo(node, other) > 13, `dot overlap at ${width}px, ${anchors.length} magnets, ${nodes.length} dots`);
    }
    for (const anchor of anchors) {
      assert.ok(distanceTo(node, anchor) > 29.5, `core overlap at ${width}px, ${anchors.length} magnets, ${nodes.length} dots`);
    }
  }
}

test("1-3 magnets gather 30-90 readable dots inside mobile and desktop bounds", () => {
  for (const width of [240, 320, 640, 1000]) {
    for (const count of [1, 2, 3]) {
      for (const limit of [30, 60, 90]) {
        const matches = getDustMatches(data, scores, favorites.slice(0, count), limit);
        const before = JSON.stringify(matches);
        const anchors = defaultMagnetPositions(count, width, 500);
        const nodes = layoutDust(matches, anchors, width, 500);
        assert.equal(JSON.stringify(matches), before);
        assertReadable(nodes, anchors, width, 500);
        if (count > 1) assertClearFavorites(nodes, anchors, .04);
      }
    }
  }
});

test("a crowded narrow corner leaves room to pick both dots and magnets", () => {
  const width = 240, height = 440;
  const matches = getDustMatches(data, scores, favorites, 90);
  const anchors = [{ x: 52.8, y: 44 }, { x: 52.8, y: 145 }, { x: 155, y: 44 }];
  const nodes = layoutDust(matches, anchors, width, height);
  assertReadable(nodes, anchors, width, height);
  assertClearFavorites(nodes, anchors, .04);
  const onEdge = nodes.filter(node => node.x === 14 || node.x === width - 14
    || node.y === 18 || node.y === height - 18);
  assert.ok(onEdge.length <= 3, `${onEdge.length} dots cluster against the hard field limits`);
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

test("dense dust settles after dragging instead of animating idle contact jitter forever", () => {
  for (const width of [240, 640]) {
    const anchors = defaultMagnetPositions(3, width, 500);
    const nodes = layoutDust(getDustMatches(data, scores, favorites, 90), anchors, width, 500);
    anchors[0].y += 50;
    let quietFrames = 0;
    for (let frame = 0; frame < 600 && quietFrames < 24; frame++) {
      quietFrames = stepDust(nodes, anchors, width, 500) < .015 ? quietFrames + 1 : 0;
    }
    assert.equal(quietFrames, 24, `never settled at ${width}px`);
    assertClearFavorites(nodes, anchors, .04);
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

test("starting offsets follow title identity across reordered and filtered samples", () => {
  const anchors = defaultMagnetPositions(3, 640, 500);
  const matches = getDustMatches(data, scores, favorites, 60);
  const initial = createDustNodes(matches, anchors, 640, 500);
  const filtered = matches.slice(10, 30).reverse();
  const redrawn = createDustNodes(filtered, anchors, 640, 500);
  const byId = new Map(initial.map(node => [node.anime.id, node]));
  for (const node of redrawn) assert.deepEqual(node, byId.get(node.anime.id));
});
