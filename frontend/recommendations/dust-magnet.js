"use strict";

const DUST_MAGNET_VIOLET = "var(--dust-magnet-violet)";
const MAGNET_COLORS = ["var(--color-secondary-strong)", DUST_MAGNET_VIOLET, "var(--color-accent-strong)"];
const DUST_UNIFORM_COLOR = "var(--dust-uniform)";
const DUST_ENGINE = typeof module !== "undefined" && module.exports ? require("../common/dust-context.js") : AnivizDust;
let dustChart = null;

// Keep the original forward helper available to existing callers.
function getDustMatches(data, scores, movieIds, limit = 60) {
  const count = [30, 60, 90].includes(Number(limit)) ? Number(limit) : 60;
  return DUST_ENGINE.sampleDust(DUST_ENGINE.forwardVectors(data, scores, movieIds), movieIds.length, count)
    .map(({ record, key, sortScore, ...match }) => ({ ...match, anime: record }));
}

function defaultMagnetPositions(count, width, height) {
  const positions = count === 1 ? [[.5, .5]] : count === 2 ? [[.24, .5], [.76, .5]]
    : [[.5, .23], [.23, .70], [.77, .70]];
  return positions.slice(0, count).map(([x, y]) => ({ x: x * width, y: y * height }));
}

const DUST_HIT_RADIUS = 9;
const MAGNET_CORE_RADIUS = 25;
const DUST_SPACING = 2 * DUST_HIT_RADIUS;
const DUST_CLEARANCE = MAGNET_CORE_RADIUS + DUST_HIT_RADIUS;
const DUST_MULTI_CLEARANCE = DUST_CLEARANCE + 8;
const DUST_INSET_X = 14;
const DUST_INSET_Y = 18;
const DUST_EDGE_BUFFER = 24;
const DUST_MAX_RANK_SPREAD = 160;
const DUST_RANK_SPREAD = .8;
const DUST_RANK_CURVE = .125;
const DUST_RADIAL_STIFFNESS = 185;
const DUST_DAMPING = 10;
const DUST_STEP = 1 / 120;
const DUST_MAX_SPEED = 145;
const DUST_QUIET_FRAMES = 24;
const DUST_QUIET_MOVEMENT = .015;

function dustTemperature(mixed) {
  // Percentiles have a wider spread than cosine scores in the displayed sample.
  return mixed ? .24 : .07;
}

function dustAffinity(score, best, temperature) {
  return Math.exp((score - best) / temperature);
}

function dustPreference(gap, temperature) {
  const t = Math.min(1, gap / (.65 * temperature));
  return t * t * (3 - 2 * t);
}

function activeDustAnchors(anchors) {
  return anchors.map((anchor, index) => ({ ...anchor, index, strength: anchor.strength ?? 1 }))
    .filter(anchor => anchor.strength > 0);
}

function dustPullScores(scores, anchors, temperature) {
  // In the exponential affinity, this adds a multiplier without scaling signed similarity scores.
  return anchors.map(({ index, strength }) => scores[index] + temperature * Math.log(strength));
}

function dustScoreTarget(scores, anchors, temperature) {
  // Subtract the maximum so the weights stay finite for signed scores.
  const best = Math.max(...scores);
  const maxStrength = Math.max(...anchors.map(anchor => anchor.strength));
  let x = 0, y = 0, total = 0;
  anchors.forEach((anchor, index) => {
    // Give every magnet a small share of the pull, even for large leads.
    const weight = .06 * anchor.strength / maxStrength + dustAffinity(scores[index], best, temperature);
    x += anchor.x * weight;
    y += anchor.y * weight;
    total += weight;
  });
  return { x: x / total, y: y / total };
}

function dustRankSpreads(anchors, width, height) {
  const fieldCap = Math.min(width - 2 * DUST_INSET_X, height - 2 * DUST_INSET_Y) / 3;
  return anchors.map((anchor, index) => {
    const gap = Math.min(...anchors.map((other, i) =>
      i === index ? Infinity : Math.hypot(other.x - anchor.x, other.y - anchor.y)));
    const available = 1.25 * (Math.min(fieldCap, .7 * gap) - DUST_CLEARANCE);
    return Math.max(0, Math.min(DUST_MAX_RANK_SPREAD, available)) * DUST_RANK_SPREAD;
  });
}

function dustScoreLayout(node, anchors, temperature, key, spreads) {
  const { scoreLayout, winnerPercentile } = node;
  if (scoreLayout?.key === key && scoreLayout.scores === node.scores
      && scoreLayout.winnerPercentile === winnerPercentile) return scoreLayout;
  const scores = dustPullScores(node.scores, anchors, temperature);
  const winner = scores.indexOf(Math.max(...scores));
  const runnerUp = Math.max(...scores.filter((_, index) => index !== winner));
  const lead = scores[winner] - runnerUp;
  const confidence = 1 - Math.exp(-((lead / temperature) ** 2));
  const winnerPreference = dustPreference(lead, temperature);
  const percentile = node.magnetPercentiles?.[anchors[winner].index] ?? winnerPercentile;
  const weakness = 1 - percentile;
  const clearance = anchors.length > 1 ? DUST_MULTI_CLEARANCE : DUST_CLEARANCE;
  const preferredRadius = spreads[winner] > 0 && Number.isFinite(percentile)
    ? clearance + spreads[winner] * (1 + DUST_RANK_CURVE) * weakness / (DUST_RANK_CURVE + weakness)
    : null;
  const comparisons = [];
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i], b = anchors[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) continue;
      const x = dx / length, y = dy / length;
      const boundary = x * (a.x + b.x) / 2 + y * (a.y + b.y) / 2;
      // Give clear favorites room on their side of the bisector.
      if (winnerPreference > 0 && (i === winner || j === winner)) {
        const side = i === winner ? 1 : -1;
        const strength = winnerPreference * dustPreference(Math.abs(scores[i] - scores[j]), temperature);
        comparisons.push({ x: side * x, y: side * y, boundary: side * boundary - 14 * strength,
          stiffness: 900 * strength, maxPull: 15000 * strength });
      }
      // Let comparable top scores share a wide band. A soft pull leaves room for crowding.
      const shared = 1 - dustPreference(scores[winner] - Math.min(scores[i], scores[j]), temperature / 2);
      if (shared > 0) {
        const band = 12 + .12 * length;
        const stiffness = 95 * shared, maxPull = 3200 * shared;
        comparisons.push({ x, y, boundary: boundary + band, stiffness, maxPull },
          { x: -x, y: -y, boundary: -boundary + band, stiffness, maxPull });
      }
    }
  }
  const target = anchors.length > 1 ? dustScoreTarget(scores, anchors, temperature) : null;
  return (node.scoreLayout = { key, scores: node.scores, winnerPercentile, target, comparisons, winner, confidence, preferredRadius });
}

function dustAttraction(node, anchors, target) {
  if (target) return { x: 21 * (target.x - node.x), y: 21 * (target.y - node.y) };
  let x = 0, y = 0;
  anchors.forEach((anchor, index) => {
    const strength = 18 * Math.max(0, Math.min(1, node.scores[anchor.index ?? index] || 0)) / anchors.length;
    x += strength * (anchor.x - node.x);
    y += strength * (anchor.y - node.y);
  });
  return { x, y };
}

function dustTitleHash(key) {
  let hash = 2166136261;
  for (const letter of String(key)) hash = Math.imul(hash ^ letter.codePointAt(0), 16777619);
  return hash;
}

function dustDirection(hash) {
  const angle = (hash >>> 0) / 2 ** 32 * 2 * Math.PI;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function dustSeed(key, radius) {
  // Seed the angle and radius from the title key so a change in rank cannot move the seed.
  const hash = dustTitleHash(key);
  const direction = dustDirection(hash);
  const radiusHash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  const distance = radius * Math.sqrt((radiusHash >>> 0) / 2 ** 32);
  return { x: distance * direction.x, y: distance * direction.y };
}

function dustCenterDirection(node) {
  return dustDirection(dustTitleHash(node.key ?? node.anime?.id ?? node.index));
}

function applyDustRankForce(force, node, anchor, { confidence, preferredRadius }, scale) {
  if (preferredRadius === null || confidence === 0) return;
  const dx = node.x - anchor.x, dy = node.y - anchor.y;
  const distance = Math.hypot(dx, dy);
  const direction = distance < 1e-6 ? dustCenterDirection(node) : { x: dx / distance, y: dy / distance };
  const radial = force.x * direction.x + force.y * direction.y;
  // Keep the tangential pull toward the weighted center.
  const adjustment = scale * confidence * (DUST_RADIAL_STIFFNESS * (preferredRadius - distance) - radial);
  force.x += adjustment * direction.x;
  force.y += adjustment * direction.y;
}

function dustBounds(x, y, width, height) {
  return { x: Math.max(DUST_INSET_X, Math.min(width - DUST_INSET_X, x)),
    y: Math.max(DUST_INSET_Y, Math.min(height - DUST_INSET_Y, y)) };
}

function createDustNodes(matches, anchors, width, height, previous, mixed = false) {
  const temperature = dustTemperature(mixed);
  const active = activeDustAnchors(anchors);
  return matches.map((match) => {
    const key = match.key ?? match.anime.id;
    const saved = previous?.positions.get(key);
    if (saved) {
      const position = dustBounds(saved.x * width / previous.width, saved.y * height / previous.height, width, height);
      return { ...match, ...position, vx: saved.vx || 0, vy: saved.vy || 0 };
    }
    let center, radius;
    if (active.length > 1) {
      const scores = dustPullScores(match.scores, active, temperature);
      center = dustScoreTarget(scores, active, temperature);
      const [best, next] = scores.sort((a, b) => b - a);
      radius = 30 + 50 * Math.exp((next - best) / temperature);
    } else {
      center = active.length && match.scores[active[0].index] > 0 ? active[0] : { x: width / 2, y: height / 2 };
      radius = 90;
    }
    const offset = dustSeed(key, radius);
    const position = dustBounds(center.x + offset.x, center.y + offset.y, width, height);
    return { ...match, ...position, vx: 0, vy: 0 };
  });
}

// Particle motion, including the response to moving bisectors, goes through velocity.
function stepDust(nodes, magnets, width, height, elapsed = 1 / 60, mixed = false) {
  if (elapsed <= 0) return 0;
  const duration = Math.min(elapsed, 1 / 30);
  const steps = Math.ceil(duration / DUST_STEP);
  const dt = duration / steps;
  const damping = Math.exp(-DUST_DAMPING * dt);
  const temperature = dustTemperature(mixed);
  const anchors = activeDustAnchors(magnets);
  const key = `${temperature}:${width},${height}:${anchors.map(a => `${a.index},${a.x},${a.y},${a.strength}`).join(":")}`;
  const spreads = dustRankSpreads(anchors, width, height);
  const layouts = nodes.map((node) => anchors.length ? dustScoreLayout(node, anchors, temperature, key, spreads) : null);
  const multiple = anchors.length > 1;
  const clearance = multiple ? DUST_MULTI_CLEARANCE : DUST_CLEARANCE;
  const rankScale = multiple ? .33 : 1;
  const spacingForce = multiple ? 3700 : 3000;
  const coreForce = multiple ? 2800 : 3700;
  const edgeForce = multiple ? 380 : 210;
  const before = nodes.map((node) => ({ x: node.x, y: node.y }));
  for (let step = 0; step < steps; step++) {
    const forces = nodes.map((node, index) => {
      const layout = layouts[index];
      const strength = layout ? anchors[layout.winner].strength : 0;
      const force = dustAttraction(node, anchors, layout?.target);
      if (layout) {
        // Let the other magnets influence position even when one leads.
        applyDustRankForce(force, node, anchors[layout.winner], layout, rankScale);
      }
      force.x *= strength;
      force.y *= strength;
      // The edge buffer gives crowded dots a way back from the hard field limits.
      force.x += edgeForce * (Math.max(0, DUST_INSET_X + DUST_EDGE_BUFFER - node.x)
        - Math.max(0, node.x - (width - DUST_INSET_X - DUST_EDGE_BUFFER)));
      force.y += edgeForce * (Math.max(0, DUST_INSET_Y + DUST_EDGE_BUFFER - node.y)
        - Math.max(0, node.y - (height - DUST_INSET_Y - DUST_EDGE_BUFFER)));
      for (const { x, y, boundary, stiffness, maxPull } of layout?.comparisons || []) {
        const crossed = x * node.x + y * node.y - boundary;
        if (crossed <= 0) continue;
        const pull = Math.min(maxPull, stiffness * crossed) * strength;
        force.x -= x * pull;
        force.y -= y * pull;
      }
      return force;
    });
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = node.x - nodes[j].x, dy = node.y - nodes[j].y;
        const distance2 = dx * dx + dy * dy;
        if (distance2 >= DUST_SPACING * DUST_SPACING) continue;
        let distance = Math.sqrt(distance2);
        if (distance < 1e-6) { dx = Math.cos(i + j); dy = Math.sin(i + j); distance = 1; }
        const push = (DUST_SPACING - distance) * spacingForce / distance;
        forces[i].x += dx * push; forces[i].y += dy * push;
        forces[j].x -= dx * push; forces[j].y -= dy * push;
      }
      for (const anchor of anchors) {
        const dx = node.x - anchor.x, dy = node.y - anchor.y;
        const distance2 = dx * dx + dy * dy;
        if (distance2 >= clearance * clearance) continue;
        const distance = Math.sqrt(distance2);
        const direction = distance < 1e-6 ? dustCenterDirection(node) : { x: dx / distance, y: dy / distance };
        const push = (clearance - distance) * coreForce;
        forces[i].x += direction.x * push; forces[i].y += direction.y * push;
      }
    }
    nodes.forEach((node, index) => {
      node.vx = ((node.vx || 0) + forces[index].x * dt) * damping;
      node.vy = ((node.vy || 0) + forces[index].y * dt) * damping;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > DUST_MAX_SPEED) { node.vx *= DUST_MAX_SPEED / speed; node.vy *= DUST_MAX_SPEED / speed; }
      const nextX = node.x + node.vx * dt, nextY = node.y + node.vy * dt;
      const { x, y } = dustBounds(nextX, nextY, width, height);
      if (x !== nextX) node.vx = 0;
      if (y !== nextY) node.vy = 0;
      node.x = x; node.y = y;
    });
  }
  return nodes.reduce((movement, node, i) => Math.max(movement,
    Math.hypot(node.x - before[i].x, node.y - before[i].y)), 0);
}

function settleDust(nodes, anchors, width, height, mixed) {
  let quietFrames = 0;
  for (let tick = 0; tick < 480 && quietFrames < DUST_QUIET_FRAMES; tick++) {
    const movement = stepDust(nodes, anchors, width, height, 1 / 60, mixed);
    quietFrames = movement < DUST_QUIET_MOVEMENT ? quietFrames + 1 : 0;
  }
}

function layoutDust(matches, anchors, width, height, mixed = false) {
  if (!matches.length || !anchors.length) return [];
  const nodes = createDustNodes(matches, anchors, width, height, null, mixed);
  settleDust(nodes, anchors, width, height, mixed);
  return nodes;
}

function stopDustChart() {
  dustChart?.stop();
}

// Keep solid magnets distinct during pointer/keyboard moves and restoration.
function constrainMagnetPosition(anchor, x, y, anchors, width, height) {
  const margin = Math.min(76, width * .22);
  const clamp = (point) => ({ x: Math.max(margin, Math.min(width - margin, point.x)),
    y: Math.max(44, Math.min(height - 78, point.y)) });
  const desired = clamp({ x, y });
  const separation = Math.min(110, width * .42);
  const available = (point) => anchors.every((other) => other === anchor
    || Math.hypot(point.x - other.x, point.y - other.y) >= separation - 1e-6);
  if (available(desired)) return desired;
  // Find the nearest valid point, without pushing the other magnets or letting
  // sequential projections bounce a dragged magnet between two neighbors.
  const boundedAnchor = clamp(anchor);
  let best = available(boundedAnchor) ? boundedAnchor : null;
  for (let cy = 44; cy <= height - 78; cy += 4) {
    for (let cx = margin; cx <= width - margin; cx += 4) {
      const point = { x: cx, y: cy };
      if (available(point) && (!best || Math.hypot(cx - desired.x, cy - desired.y)
        < Math.hypot(best.x - desired.x, best.y - desired.y))) best = point;
    }
  }
  return best || desired;
}

function bindDustControls() {
  const deselectOnBackground = event => {
    if (event.defaultPrevented || event.target.closest(".dust-node, .dust-magnet, button")) return;
    hideTooltip();
    AnivizMain.deselectLast();
  };
  for (const selector of ["#recommendation-chart", "#dust-mirror"]) {
    document.querySelector(selector).addEventListener("click", deselectOnBackground);
  }
  document.querySelector("#dust-limit").addEventListener("change", event => AnivizMain.setDustLimit(event.target.value));
  const magnetList = document.querySelector("#movie-magnets");
  magnetList.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-magnet]");
    if (!button) return;
    const hadFocus = document.activeElement === button;
    removeMagnet(button.dataset.removeMagnet);
    if (hadFocus) {
      const next = magnetList.querySelector("[data-remove-magnet]") || document.querySelector('#magnet-type input:checked');
      next.focus({ preventScroll: true });
    }
  });
  document.querySelector("#reset-magnets").addEventListener("click", AnivizMain.resetPositions);
}

function renderDustLegend({ magnets, colorByMagnet, mixed }) {
  const legend = document.querySelector("#dust-legend");
  legend.hidden = !magnets.length;
  if (!magnets.length) { legend.replaceChildren(); return; }
  const colors = colorByMagnet ? magnets.map((magnet, index) => `
    <span title="${mixed ? "Highest attraction percentile for" : "Titles most similar to"} ${escapeAttribute(magnet.title)}"><i class="dust-legend-dot" style="--magnet-color:${AnivizMain.color(magnet.key)}" aria-hidden="true"></i>M${index + 1}</span>`).join("")
    : `<span><i class="dust-legend-dot" style="--magnet-color:${DUST_UNIFORM_COLOR}" aria-hidden="true"></i>Dust</span>`;
  legend.innerHTML = colors + '<span><i class="dust-legend-dot is-selected" aria-hidden="true"></i>Selected</span>';
}

function refreshDustColors() {
  renderDustLegend(AnivizMain.snapshot());
  dustChart?.views?.forEach(view => view.drawColors());
}

function renderDustRecommendations() {
  const snapshot = AnivizMain.snapshot();
  const { magnets, magnetKeys, mixed, displayedDust, direction, example } = snapshot;
  const savedMetrics = AnivizDust.METRIC_MAGNET_TYPES.map(type => snapshot[type]);
  const reverse = direction === AnivizDust.REVERSE, studios = direction === AnivizDust.STUDIOS;
  const group = AnivizDust.groupFor(direction);
  const noun = group?.noun || (reverse ? "movies" : "anime");
  const container = document.querySelector("#recommendation-chart");
  const mirror = document.querySelector("#dust-mirror");
  renderDustLegend(snapshot);
  document.querySelector("#recommendation-content").hidden = false;
  document.querySelector("#recommendation-chart-title").textContent = `${noun[0].toUpperCase() + noun.slice(1)} shown`;
  document.querySelector("#movie-magnets").innerHTML = magnetKeys.map(key => {
    const index = magnets.findIndex(magnet => magnet.key === key);
    const magnet = magnets[index] || savedMetrics.find(magnet => magnet.key === key);
    const description = AnivizDust.isMetricMagnet(magnet) ? (index < 0 ? "Inactive" : "")
      : magnet.kind === "genre" ? AnivizDust.cohortDescription(magnet) : magnet.year || "";
    return `<div class="movie-magnet-chip" style="--magnet-color:${AnivizMain.color(magnet.key) || "currentColor"}">
      <span class="magnet-chip-number">${index < 0 ? "–" : index + 1}</span><span>${escapeHTML(magnet.title)}${description ? ` <small>${escapeHTML(description)}</small>` : ""}${example ? ' <em class="magnet-example">Example</em>' : ""}</span>
      <button type="button" data-remove-magnet="${escapeAttribute(magnet.key)}" aria-label="Remove ${escapeAttribute(magnet.title)} magnet">×</button>
    </div>`;
  }).join("") + `<span class="magnet-empty-slot">${magnetKeys.length}/3 magnets${magnetKeys.length === 3 ? " · remove one to swap" : ""}</span>`;
  document.querySelectorAll("#movie-suggestions button").forEach(button => {
    button.setAttribute("aria-pressed", magnets.some(magnet => magnet.key === button.dataset.magnetKey));
  });
  document.querySelector("#reset-magnets").disabled = !magnets.length;
  if (group && snapshot.metadataStatus !== "ready") {
    const unavailable = snapshot.metadataStatus === "unavailable";
    const credits = studios ? "studio credits" : "voice actor credits";
    const message = unavailable ? `${group.label} credits could not be loaded.` : `Loading AniList ${credits}…`;
    const retryId = studios ? "studio-credits-retry" : "actor-credits-retry";
    container.innerHTML = `<div class="dust-empty" role="status"><p>${message}</p>${unavailable
      ? `<button type="button" class="small-button ghost" id="${retryId}">Retry ${credits}</button>` : ""}</div>`;
    renderEmpty(mirror, message);
    document.querySelector(`#${retryId}`)?.addEventListener("click", AnivizMain.loadMetricData);
    return;
  }
  if (!magnets.length) {
    dustChart = null;
    const message = magnetKeys.length ? "Check the data status of your saved magnets or add another magnet."
      : `Add a magnet to explore the ${noun} sample.`;
    container.innerHTML = `<div class="dust-empty"><p>${message}</p></div>`;
    renderEmpty(mirror, message);
    return;
  }
  if (!recommendationState.scores && magnets.some(magnet => !AnivizDust.isMetricMagnet(magnet))) {
    const error = recommendationState.scoresError;
    const message = error ? `Could not load full similarities: ${error}` : `Gathering ${noun}…`;
    container.innerHTML = `<div class="dust-empty" role="status"><p>${escapeHTML(message)}</p>${error ? `<button type="button" class="small-button ghost" id="dust-retry">Retry full scores</button>` : ""}</div>`;
    renderEmpty(mirror, message);
    document.querySelector("#dust-retry")?.addEventListener("click", () => {
      void loadRecommendationScores();
      renderRecommendations();
    });
    if (!error) void loadRecommendationScores();
    return;
  }
  renderDustChart(container, mirror, magnets, displayedDust, mixed);
  if (group && !displayedDust.length) {
    document.querySelector("[data-dust-scope]").textContent = `No ${noun} with scores match the current filters.`;
  }
  highlightRecommendation();
}

function createDustView(container, matches, anchors, width, height, onMove, { label, mixed, group, zoomContent }) {
  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width).attr("height", height).attr("class", "dust-map")
    .attr("aria-label", `${label} ${mixed ? "attraction to" : "similarity to"} ${anchors.map(({ magnet }) => magnet.title).join(", ")}`);
  const scene = svg.append("g");
  const paths = scene.append("g").attr("aria-hidden", "true");
  const selectedPaths = paths.append("g");
  const previewPaths = paths.append("g");
  const mutedMagnets = scene.append("g").node();
  const temperature = dustTemperature(mixed);
  let positions, hovered, focused;
  let selectedKeys = [];
  function drawLinks(layer, className, keys) {
    const active = activeDustAnchors(anchors);
    const links = keys.flatMap(key => {
      const node = positions.get(key);
      if (!node) return [];
      const scores = dustPullScores(node.scores, active, temperature);
      const best = Math.max(...scores);
      return active.map((anchor, index) => ({ anchor, node,
        affinity: dustAffinity(scores[index], best, temperature) }));
    });
    layer.selectAll("line").data(links).join("line")
      .attr("class", className)
      .attr("stroke", ({ anchor }) => anchor.color)
      .attr("stroke-width", ({ affinity }) => .8 + 1.5 * affinity)
      .attr("stroke-opacity", ({ affinity }) => .14 + .56 * affinity)
      .attr("x1", ({ anchor }) => anchor.x).attr("y1", ({ anchor }) => anchor.y)
      .attr("x2", ({ node }) => node.x).attr("y2", ({ node }) => node.y);
  }
  function drawPreview() {
    const key = hovered || focused;
    drawLinks(previewPaths, "dust-preview-link", key && !selectedKeys.includes(key) ? [key] : []);
  }
  const dots = scene.append("g").selectAll("g").data(matches, (match) => match.key).join("g")
    .attr("class", "dust-node").attr("data-match-id", (match) => match.key)
    .attr("role", "button").attr("tabindex", 0).attr("aria-controls", "dust-focus recommendation-detail")
    .attr("aria-label", (match) => `${match.record.title}. ${group ? `${AnivizDustDetails.groupCoverage(match)}. ` : ""}${anchors.map(({ magnet }, index) => mixed ? AnivizDust.mixedEvidence(match, magnet, index)
      : `${AnivizDust.magnetScoreLabel(magnet)}: ${match.scores[index].toFixed(3)}`).join(". ")}. Toggle selection for details or comparison.`)
    .on("mouseenter focus", (event, match) => {
      if (event.type === "focus") focused = match.key;
      else hovered = match.key;
      drawPreview();
      const rect = event.currentTarget.getBoundingClientRect();
      const pointer = event.type === "focus" ? { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 } : event;
      const subtitle = group ? AnivizDustDetails.groupCoverage(match)
        : `${match.key.startsWith("anilist:") ? escapeHTML(humanize(match.record.format)) + " · " : ""}${match.record.year || "Year unknown"}`;
      showTooltip(pointer, `<strong>${escapeHTML(match.record.title)}</strong><span>${subtitle}</span>`
        + anchors.map(({ magnet, color }, index) => `<span class="dust-tooltip-score"><i style="background:${color}"></i>${mixed
          ? `<span>${escapeHTML(AnivizDust.magnetScoreLabel(magnet))}: ${AnivizDust.formatRawScore(match.rawScores[index], magnet)}<br>
            Attraction percentile: ${AnivizDust.formatPercentile(match.scores[index])}</span>`
          : `${escapeHTML(magnet.kind === "genre" ? AnivizDust.magnetScoreLabel(magnet) : magnet.title)} <b>${match.scores[index].toFixed(3)}</b>`}</span>`).join("")
        + (mixed ? `<span>${AnivizDust.averageLabel(true)}: ${AnivizDust.formatPercentile(match.score)}</span>` : "")
        + '<span class="dust-tooltip-hint">Click to toggle selection</span>');
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave blur", (event) => {
      if (event.type === "blur") focused = null;
      else hovered = null;
      drawPreview();
      hideTooltip();
    })
    .on("click", (event, match) => { hideTooltip(); AnivizMain.select(match.key); })
    .on("keydown", (event, match) => {
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); hideTooltip(); AnivizMain.select(match.key); }
      if (event.key === "Escape") {
        hovered = focused = null;
        drawPreview();
        hideTooltip();
      }
    });
  dots.append("circle").attr("class", "dust-hit-area").attr("r", DUST_HIT_RADIUS);
  const grains = dots.append("circle").attr("class", "dust-grain").attr("r", 4.5).attr("fill", AnivizMain.dustColor);
  let posterImages, posterTitles;
  function drawArtwork() {
    if (!posterImages) return;
    const { lookup } = AnivizMain.snapshot();
    AnivizPosterZoom.drawArtwork(posterImages, match => {
      const record = lookup.get(match.key)?.record || match.record;
      return AnivizArtwork.dustThumbnail(record, match.key);
    });
  }
  function addPosters() {
    const posters = dots.append("foreignObject").attr("class", "dust-poster").attr("aria-hidden", "true")
      .attr("x", -34).attr("y", -62);
    const { images, titles } = AnivizPosterZoom.addCards(posters, {
      title: match => match.record.title, color: AnivizMain.dustColor
    });
    posterImages = images;
    posterTitles = titles;
    drawArtwork();
  }
  const activeMagnets = scene.append("g");
  const magnets = activeMagnets.selectAll("g").data(anchors, anchor => anchor.magnet.key).join("g").attr("class", "dust-magnet")
    .attr("role", ({ magnet }) => magnet.kind === undefined ? "button" : "group").attr("tabindex", 0)
    .attr("aria-controls", ({ magnet }) => magnet.kind === undefined ? "dust-focus" : null)
    .attr("aria-label", ({ magnet }) => `${magnet.title} magnet.${magnet.kind === undefined ? " Activate to view details." : ""} Drag or use arrow keys to move.`)
    .on("click", (event, { magnet }) => {
      if (magnet.kind === undefined) AnivizMain.focusMagnet(magnet.key);
    })
    .on("keydown", (event, anchor) => {
      if (anchor.magnet.kind === undefined && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        AnivizMain.focusMagnet(anchor.magnet.key);
        return;
      }
      const delta = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[event.key];
      if (!delta) return;
      event.preventDefault();
      onMove(anchor, anchor.x + delta[0], anchor.y + delta[1]);
    })
    .call(d3.drag().clickDistance(4).on("start", () => {
      hovered = focused = null;
      drawPreview();
      hideTooltip();
    })
      .on("drag", (event, anchor) => onMove(anchor, event.x, event.y)));
  const magnetArt = magnets.append("g").attr("class", "dust-magnet-art");
  magnetArt.append("circle").attr("class", "magnet-halo").attr("r", DUST_CLEARANCE).attr("stroke", (anchor) => anchor.color);
  magnetArt.append("circle").attr("class", "magnet-core").attr("r", MAGNET_CORE_RADIUS).attr("stroke", (anchor) => anchor.color);
  magnetArt.append("text").attr("class", "magnet-number").attr("text-anchor", "middle").attr("dy", 5)
    .attr("fill", (anchor) => anchor.color).text((_, index) => `M${index + 1}`);
  magnetArt.append("text").attr("class", "magnet-title").attr("text-anchor", "middle").attr("y", 49)
    .text((anchor) => truncate(anchor.magnet.title, width < 400 ? 16 : 23));
  magnets.append("title").text(({ magnet }) => {
    if (AnivizDust.isMetricMagnet(magnet)) return magnet.title;
    const description = magnet.kind === "genre" ? AnivizDust.cohortDescription(magnet) : magnet.year || "Year unknown";
    return `${magnet.title} (${description})`;
  });

  const camera = AnivizPosterZoom.attach({
    container, svg, d3, label, extent: [[0, 0], [width, height]],
    zoomContent,
    canDragFrom: target => !target.closest(".dust-magnet"),
    onStart() {
      hovered = focused = null;
      drawPreview();
      hideTooltip();
    },
    onZoom(transform, showPosters) {
      scene.attr("transform", transform);
      scene.style("--dust-magnet-scale", Math.min(1, 2 / transform.k));
      if (showPosters) {
        if (!posterImages) addPosters();
        scene.style("--dust-poster-scale", 1 / transform.k);
      }
    }
  });

  return {
    drawArtwork,
    drawColors() {
      grains.attr("fill", AnivizMain.dustColor);
      posterTitles?.style("color", AnivizMain.dustColor);
    },
    ...camera,
    draw(nextPositions) {
      positions = nextPositions;
      dots.attr("transform", (match) => { const node = positions.get(match.key); return `translate(${node.x},${node.y})`; });
      magnets.attr("transform", (anchor) => `translate(${anchor.x},${anchor.y})`)
        .classed("is-muted", anchor => anchor.strength === 0)
        .each(function (anchor) {
          // Let the dust remain selectable where it overlaps a magnet at 0×.
          const layer = anchor.strength === 0 ? mutedMagnets : activeMagnets.node();
          if (this.parentNode !== layer) layer.appendChild(this);
        });
    },
    drawLinks(keys) {
      selectedKeys = keys;
      drawLinks(selectedPaths, "dust-selected-link", keys);
      drawPreview();
    }
  };
}

function renderDustChart(container, mirror, magnets, matches, mixed) {
  const previousChart = dustChart;
  // Clear the field before measuring so the old SVG cannot size the flex item.
  container.innerHTML = "";
  mirror.innerHTML = "";
  const width = Math.max(240, container.clientWidth);
  const height = Math.max(260, container.clientHeight || (width < 400 ? 440 : 500));
  const initial = defaultMagnetPositions(magnets.length, width, height);
  const snapshot = AnivizMain.snapshot();
  const anchors = magnets.map((magnet, index) => {
    const saved = recommendationState.magnetPositions[`${magnets.length}:${magnet.key}`];
    const hasPosition = Number.isFinite(saved?.x) && Number.isFinite(saved?.y);
    const position = hasPosition ? { x: saved.x * width, y: saved.y * height } : initial[index];
    return { magnet, color: AnivizMain.color(magnet.key), strength: snapshot.magnetStrengths[magnet.key] ?? 1, ...position };
  });
  for (const anchor of anchors) {
    Object.assign(anchor, constrainMagnetPosition(anchor, anchor.x, anchor.y, anchors, width, height));
  }
  const group = AnivizDust.groupFor(snapshot.direction);
  const noun = group?.noun || (snapshot.direction === AnivizDust.REVERSE ? "movies" : "anime");
  const zoomContent = snapshot.direction === AnivizDust.STUDIOS ? "studio names"
    : snapshot.direction === AnivizDust.ACTORS ? "portraits" : "posters";
  const views = [createDustView(container, matches, anchors, width, height, moveAnchor, {
    label: `Displayed ${noun}`, mixed, group, zoomContent
  }), createDustView(mirror, matches, anchors, width, height, moveAnchor, {
    label: `Mirror of ${noun}`, mixed, group, zoomContent
  })];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nodes = createDustNodes(matches, anchors, width, height, dustChart, mixed);
  // First entry is already gathered. Later changes start from the previous positions.
  if (!dustChart || reducedMotion) settleDust(nodes, anchors, width, height, mixed);
  const positions = new Map(nodes.map((node) => [node.key, node]));
  let frame = null, lastTime = null, quietFrames = 0;
  dustChart = { views, positions, anchors, width, height, setMagnetStrengths(strengths) {
    anchors.forEach(anchor => { anchor.strength = strengths[anchor.magnet.key] ?? 1; });
    if (reducedMotion) {
      settleDust(nodes, anchors, width, height, mixed);
      draw();
      AnivizMain.saveLayout();
    } else {
      wake();
    }
  }, stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; lastTime = null;
  } };
  function moveAnchor(anchor, x, y) {
    const position = constrainMagnetPosition(anchor, x, y, anchors, width, height);
    if (position.x === anchor.x && position.y === anchor.y) return;
    Object.assign(anchor, position);
    recommendationState.magnetPositions[`${magnets.length}:${anchor.magnet.key}`] = { x: anchor.x / width, y: anchor.y / height };
    if (reducedMotion) settleDust(nodes, anchors, width, height, mixed);
    draw();
    if (!reducedMotion) wake();
    AnivizMain.saveLayout();
  }
  function draw() {
    views.forEach(view => view.draw(positions));
    highlightDustConnections();
  }
  function animate(time) {
    frame = null;
    if (!container.isConnected) return;
    const elapsed = lastTime === null ? 1 / 60 : (time - lastTime) / 1000;
    const movement = stepDust(nodes, anchors, width, height, elapsed, mixed);
    lastTime = time;
    draw();
    quietFrames = movement < DUST_QUIET_MOVEMENT ? quietFrames + 1 : 0;
    if (quietFrames < DUST_QUIET_FRAMES) frame = requestAnimationFrame(animate);
    else { lastTime = null; AnivizMain.saveLayout(); }
  }
  function wake() {
    quietFrames = 0;
    if (frame === null) frame = requestAnimationFrame(animate);
  }
  draw();
  views.forEach((view, index) => {
    const previous = previousChart?.views?.[index].getTransform();
    if (!previous || previous.k === 1) return;
    view.setTransform(d3.zoomIdentity.translate(previous.x * width / previousChart.width,
      previous.y * height / previousChart.height).scale(previous.k));
  });
  if (!reducedMotion) wake();
}

function highlightDustConnections() {
  if (!dustChart?.views) return;
  const { selectedKeys } = AnivizMain.snapshot();
  dustChart.views.forEach(view => view.drawLinks(selectedKeys));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getDustMatches, defaultMagnetPositions, dustAttraction, createDustNodes, stepDust, layoutDust, constrainMagnetPosition };
}
