// Replay the published score matrix against the pre-spacing geometry on alfi.
// From the repo root, run node tests/dust-motion-replay.cjs [baseline-ref]
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createContext, DEFAULT_MOTION, FORWARD, REVERSE } = require('../frontend/common/dust-context.js');
const current = require('../frontend/recommendations/dust-magnet.js');

const root = path.resolve(__dirname, '..');
const load = name => require(path.join(root, 'data', `${name}.json`));
const baselineRef = process.argv[2] || 'e50054f';
const baseline = { exports: {} };
vm.runInNewContext(execFileSync('git', ['show', `${baselineRef}:frontend/recommendations/dust-magnet.js`],
  { cwd: root, encoding: 'utf8' }), { module: baseline });
const bytes = readFileSync(path.join(root, 'data/movie_anime_scores.bin'));
const scores = Float32Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readFloatLE(index * 4));
const context = createContext();
context.setSources(load('movie_recommendations'), scores);
context.setMetadata(load('anilist_dashboard_cache').anime);
context.setMoviePopularity(load('movie_popularity'), 'ready');

const titles = ['tmdb:27205', 'tmdb:157336', 'tmdb:603'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rounded = value => Number(value.toFixed(2));
function median(values) {
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered.length ? (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2 : null;
}
function rankMetrics(rows, winnerCount) {
  let agreement = 0, pairs = 0;
  const gaps = [], tiedScoreGaps = [];
  for (let i = 0; i < winnerCount; i++) {
    const cloud = rows.filter(row => row.winner === i).sort((a, b) => b.score - a.score);
    const size = Math.floor(cloud.length / 4);
    if (size && cloud[size - 1].score > cloud.at(-size).score) {
      gaps.push(median(cloud.slice(-size).map(row => row.radius)) - median(cloud.slice(0, size).map(row => row.radius)));
    }
    for (const [index, stronger] of cloud.entries()) {
      for (const weaker of cloud.slice(index + 1)) {
        const gap = weaker.radius - stronger.radius;
        if (stronger.score === weaker.score) {
          tiedScoreGaps.push(Math.abs(gap));
        } else {
          pairs++;
          agreement += Math.abs(gap) < 1e-6 ? .5 : Number(gap > 0);
        }
      }
    }
  }
  const quartileGap = median(gaps);
  const tiedRadiusGap = median(tiedScoreGaps);
  return { pairs, agreement: pairs ? rounded(100 * agreement / pairs) : null,
    quartileGap: quartileGap === null ? null : rounded(quartileGap),
    tiedScorePairs: tiedScoreGaps.length, tiedRadiusGap: tiedRadiusGap === null ? null : rounded(tiedRadiusGap) };
}

function replay(engine, matches, width, height, waypoints, mixed, motion) {
  const anchors = waypoints[0].map(([x, y]) => ({ x, y }));
  const nodes = engine.createDustNodes(matches, anchors, width, height, null, mixed);
  const tick = () => engine.stepDust(nodes, anchors, width, height, 1 / 60, mixed, motion);
  let maxTravel = 0;
  function settle() {
    let quiet = 0, frames = 0, smallFrames = 0, smallSeconds = null, travel = 0;
    for (; frames < 720 && quiet < 24; frames++) {
      travel = tick();
      maxTravel = Math.max(maxTravel, travel);
      smallFrames = travel < .1 ? smallFrames + 1 : 0;
      if (smallFrames === 24 && smallSeconds === null) smallSeconds = rounded((frames + 1) / 60);
      quiet = travel < .015 ? quiet + 1 : 0;
    }
    return { smallSeconds, seconds: rounded(frames / 60), quiet: quiet === 24, lastTravel: rounded(travel) };
  }
  let settled = settle();
  for (const waypoint of waypoints.slice(1)) {
    const from = anchors.map(anchor => ({ ...anchor }));
    for (let frame = 1; frame <= 120; frame++) {
      const t = frame / 120;
      anchors.forEach((anchor, index) => {
        anchor.x = from[index].x + t * (waypoint[index][0] - from[index].x);
        anchor.y = from[index].y + t * (waypoint[index][1] - from[index].y);
      });
      maxTravel = Math.max(maxTravel, tick());
    }
    settled = settle();
  }
  const rows = nodes.map(node => {
    const winner = node.scores.indexOf(Math.max(...node.scores));
    const score = node.scores[winner];
    const lead = score - Math.max(...node.scores.filter((_, index) => index !== winner));
    const radii = anchors.map(anchor => distance(node, anchor));
    const tiedRadii = radii.filter((_, index) => node.scores[index] === score);
    return { winner, score, lead, radius: radii[winner], nearest: Math.min(...radii),
      sharedGap: Math.max(...tiedRadii) - Math.min(...tiedRadii) };
  });
  const clear = rows.filter(row => row.lead >= (mixed ? .18 : .04));
  const near = rows.filter(row => row.lead > 0 && row.lead < (mixed ? .04 : .01));
  const tied = rows.filter(row => row.lead === 0);
  const sharedGap = median(tied.map(row => row.sharedGap));
  return {
    all: rankMetrics(rows, anchors.length), clear: rankMetrics(clear, anchors.length),
    near: { count: near.length, ...rankMetrics(near, anchors.length) },
    topTies: { count: tied.length, sharedGap: sharedGap === null ? null : rounded(sharedGap) },
    nearestClear: [clear.filter(row => row.radius === row.nearest).length, clear.length],
    wall: nodes.filter(({ x, y }) => Math.min(x - 14, width - 14 - x, y - 18, height - 18 - y) <= 5).length,
    core: rounded(Math.min(...rows.map(row => row.nearest))),
    hits: nodes.filter((node, index) => rows[index].nearest > 25 &&
      nodes.slice(index + 1).every(other => distance(other, node) > 9)).length,
    maxTravel: rounded(maxTravel), ...settled
  };
}

function sample(direction, keys, count) {
  context.setDirection(direction);
  context.setMagnets(keys);
  return context.setDustLimit(count);
}
const flat = [[100, 250], [320, 250], [540, 250]];
const shallow = [[100, 250], [320, 275], [540, 250]];
const otherSide = [[100, 250], [320, 225], [540, 250]];
const primary = [
  ['pictured', 775, 697, titles, [[[386.75, 160.25], [177.25, 487.75], [528.25, 111.75]]]],
  ['shallow', 640, 500, titles, [shallow]],
  ['line', 640, 500, titles, [shallow, flat]],
  ['past line', 640, 500, titles, [shallow, otherSide]],
  ['close pair', 640, 500, titles.slice(0, 2), [[[416, 244], [526, 244]]]],
  ['single', 640, 500, titles.slice(0, 1), []]
];
const compact = { ...DEFAULT_MOTION, rankSpread: 0 };
const broadWeak = { ...DEFAULT_MOTION, rankSpread: 100, strength: .5 };
const broadStrong = { ...DEFAULT_MOTION, rankSpread: 100, strength: 1.5 };
for (const [name, width, height, keys, moves] of primary) {
  const { displayedDust, mixed } = sample(FORWARD, keys, 60);
  const start = current.defaultMagnetPositions(keys.length, width, height).map(({ x, y }) => [x, y]);
  for (const [profile, engine, motion] of [
    ['baseline', baseline.exports, undefined], ['default', current, DEFAULT_MOTION],
    ['compact', current, compact], ['broad weak', current, broadWeak], ['broad strong', current, broadStrong],
    ['light damping', current, { ...DEFAULT_MOTION, damping: 6 }],
    ['heavy damping', current, { ...DEFAULT_MOTION, damping: 16 }]
  ]) {
    console.log(JSON.stringify({ name, profile, width, height, count: 60,
      ...replay(engine, displayedDust, width, height, [start, ...moves], mixed, motion) }));
  }
}

const tiedScore = { key: 'tie', scores: [-.1, -.1], winnerPercentile: .8, closest: 0 };
for (const [profile, engine, motion] of [['baseline', baseline.exports, undefined], ['default', current, DEFAULT_MOTION]]) {
  console.log(JSON.stringify({ name: 'exact signed tie', profile, width: 640, height: 500, count: 1,
    ...replay(engine, [tiedScore], 640, 500, [[[100, 250], [540, 250]]], false, motion) }));
}

const variants = [
  ['title', FORWARD, titles],
  ['forward genre', FORWARD, [titles[0], 'tmdb:genre:Science Fiction', 'tmdb:genre:Drama']],
  ['forward popularity', FORWARD, [...titles.slice(0, 2), 'anilist:popularity']],
  ['reverse genre', REVERSE, ['anilist:16498', 'anilist:genre:Sci-Fi', 'anilist:genre:Drama']],
  ['reverse popularity', REVERSE, ['anilist:16498', 'anilist:genre:Sci-Fi', 'tmdb:popularity']]
];
for (const [name, direction, keys] of variants) {
  for (const [width, height] of [[640, 500], [240, 440]]) {
    const anchors = current.defaultMagnetPositions(keys.length, width, height).map(({ x, y }) => [x, y]);
    for (const count of [30, 60, 90]) {
      const { displayedDust, mixed } = sample(direction, keys, count);
      for (const [profile, motion] of [['default', DEFAULT_MOTION], ['compact', compact],
        ['broad weak', broadWeak], ['broad strong', broadStrong]]) {
        console.log(JSON.stringify({ name, profile, width, height, count, mixed,
          ...replay(current, displayedDust, width, height, [anchors], mixed, motion) }));
      }
    }
  }
}
