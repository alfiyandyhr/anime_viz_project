"use strict";

const MAGNET_COLORS = ["#43d9e6", "#ff6fae", "#ffcc70"];
const DUST_UNIFORM_COLOR = "#c3cbe1";
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
const DUST_RANK_CURVE = .125;
const DUST_RADIAL_STIFFNESS = 185;
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

function dustScoreTarget(scores, anchors, temperature) {
  // Subtract the maximum so the weights stay finite for signed scores.
  const best = Math.max(...scores);
  let x = 0, y = 0, total = 0;
  anchors.forEach((anchor, index) => {
    // Give every magnet a small share of the pull, even for large leads.
    const weight = .06 + dustAffinity(scores[index], best, temperature);
    x += anchor.x * weight;
    y += anchor.y * weight;
    total += weight;
  });
  return { x: x / total, y: y / total };
}

function dustRankSpreads(anchors, width, height, rankSpread) {
  const fieldCap = Math.min(width - 2 * DUST_INSET_X, height - 2 * DUST_INSET_Y) / 3;
  return anchors.map((anchor, index) => {
    const gap = Math.min(...anchors.map((other, i) =>
      i === index ? Infinity : Math.hypot(other.x - anchor.x, other.y - anchor.y)));
    const available = 1.25 * (Math.min(fieldCap, .7 * gap) - DUST_CLEARANCE);
    return Math.max(0, Math.min(DUST_MAX_RANK_SPREAD, available)) * (rankSpread / 100);
  });
}

function dustScoreLayout(node, anchors, temperature, key, spreads) {
  const { scoreLayout, winnerPercentile } = node;
  if (scoreLayout?.key === key && scoreLayout.scores === node.scores
      && scoreLayout.winnerPercentile === winnerPercentile) return scoreLayout;
  const scores = node.scores;
  const winner = scores.indexOf(Math.max(...scores));
  const runnerUp = Math.max(...scores.filter((_, index) => index !== winner));
  const lead = scores[winner] - runnerUp;
  const confidence = 1 - Math.exp(-((lead / temperature) ** 2));
  const winnerPreference = dustPreference(lead, temperature);
  const weakness = 1 - winnerPercentile;
  const clearance = anchors.length > 1 ? DUST_MULTI_CLEARANCE : DUST_CLEARANCE;
  const preferredRadius = spreads[winner] > 0 && Number.isFinite(winnerPercentile)
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
  return (node.scoreLayout = { key, scores, winnerPercentile, target, comparisons, winner, confidence, preferredRadius });
}

function dustAttraction(node, anchors, target) {
  if (target) return { x: 21 * (target.x - node.x), y: 21 * (target.y - node.y) };
  let x = 0, y = 0;
  anchors.forEach((anchor, index) => {
    const strength = 18 * Math.max(0, Math.min(1, node.scores[index] || 0)) / anchors.length;
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
  return matches.map((match) => {
    const key = match.key ?? match.anime.id;
    const saved = previous?.positions.get(key);
    if (saved) {
      const position = dustBounds(saved.x * width / previous.width, saved.y * height / previous.height, width, height);
      return { ...match, ...position, vx: saved.vx || 0, vy: saved.vy || 0 };
    }
    let center, radius;
    if (anchors.length > 1) {
      center = dustScoreTarget(match.scores, anchors, temperature);
      const [best, next] = match.scores.slice().sort((a, b) => b - a);
      radius = 30 + 50 * Math.exp((next - best) / temperature);
    } else {
      center = match.scores[0] > 0 ? anchors[0] : { x: width / 2, y: height / 2 };
      radius = 90;
    }
    const offset = dustSeed(key, radius);
    const position = dustBounds(center.x + offset.x, center.y + offset.y, width, height);
    return { ...match, ...position, vx: 0, vy: 0 };
  });
}

// Particle motion, including the response to moving bisectors, goes through velocity.
function stepDust(nodes, anchors, width, height, elapsed = 1 / 60, mixed = false, motion = DUST_ENGINE.DEFAULT_MOTION) {
  if (elapsed <= 0) return 0;
  const duration = Math.min(elapsed, 1 / 30);
  const steps = Math.ceil(duration / DUST_STEP);
  const dt = duration / steps;
  const damping = Math.exp(-motion.damping * dt);
  const temperature = dustTemperature(mixed);
  const key = `${temperature}:${width},${height}:${motion.rankSpread}:${anchors.map((a) => `${a.x},${a.y}`).join(":")}`;
  const spreads = dustRankSpreads(anchors, width, height, motion.rankSpread);
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
      const force = dustAttraction(node, anchors, layout?.target);
      if (layout) {
        // Let the other magnets influence position even when one leads.
        applyDustRankForce(force, node, anchors[layout.winner], layout, rankScale);
      }
      force.x *= motion.strength;
      force.y *= motion.strength;
      // The edge buffer gives crowded dots a way back from the hard field limits.
      force.x += edgeForce * (Math.max(0, DUST_INSET_X + DUST_EDGE_BUFFER - node.x)
        - Math.max(0, node.x - (width - DUST_INSET_X - DUST_EDGE_BUFFER)));
      force.y += edgeForce * (Math.max(0, DUST_INSET_Y + DUST_EDGE_BUFFER - node.y)
        - Math.max(0, node.y - (height - DUST_INSET_Y - DUST_EDGE_BUFFER)));
      for (const { x, y, boundary, stiffness, maxPull } of layout?.comparisons || []) {
        const crossed = x * node.x + y * node.y - boundary;
        if (crossed <= 0) continue;
        const pull = Math.min(maxPull, stiffness * crossed) * motion.strength;
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

function settleDust(nodes, anchors, width, height, mixed, motion) {
  let quietFrames = 0;
  for (let tick = 0; tick < 480 && quietFrames < DUST_QUIET_FRAMES; tick++) {
    const movement = stepDust(nodes, anchors, width, height, 1 / 60, mixed, motion);
    quietFrames = movement < DUST_QUIET_MOVEMENT ? quietFrames + 1 : 0;
  }
}

function layoutDust(matches, anchors, width, height, mixed = false, motion = DUST_ENGINE.DEFAULT_MOTION) {
  if (!matches.length || !anchors.length) return [];
  const nodes = createDustNodes(matches, anchors, width, height, null, mixed);
  settleDust(nodes, anchors, width, height, mixed, motion);
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
  const { magnets, magnetKeys, popularity, mixed, displayedDust, direction, example } = snapshot;
  const reverse = direction === AnivizDust.REVERSE;
  const noun = reverse ? "movies" : "anime";
  const container = document.querySelector("#recommendation-chart");
  const mirror = document.querySelector("#dust-mirror");
  renderDustLegend(snapshot);
  document.querySelector("#recommendation-content").hidden = false;
  document.querySelector("#recommendation-chart-title").textContent = reverse ? "Movies shown" : "Anime shown";
  document.querySelector("#movie-magnets").innerHTML = magnetKeys.map(key => {
    const index = magnets.findIndex(magnet => magnet.key === key);
    const magnet = magnets[index] || popularity;
    const description = magnet.kind === "popularity" ? (index < 0 ? "Inactive" : popularityDescription(magnet))
      : magnet.kind === "genre" ? AnivizDust.cohortDescription(magnet) : magnet.year || "";
    return `<div class="movie-magnet-chip" style="--magnet-color:${AnivizMain.color(magnet.key) || "currentColor"}">
      <span class="magnet-chip-number">${index < 0 ? "–" : index + 1}</span><span>${escapeHTML(magnet.title)} <small>${escapeHTML(description)}</small>${example ? ' <em class="magnet-example">Example</em>' : ""}</span>
      <button type="button" data-remove-magnet="${escapeAttribute(magnet.key)}" aria-label="Remove ${escapeAttribute(magnet.title)} magnet">×</button>
    </div>`;
  }).join("") + `<span class="magnet-empty-slot">${magnetKeys.length}/3 magnets${magnetKeys.length === 3 ? " · remove one to swap" : ""}</span>`;
  document.querySelectorAll("#movie-suggestions button").forEach(button => {
    button.setAttribute("aria-pressed", magnets.some(magnet => magnet.key === button.dataset.magnetKey));
  });
  document.querySelector("#reset-magnets").disabled = !magnets.length;
  if (!magnets.length) {
    dustChart = null;
    const message = magnetKeys.length ? "The saved popularity magnet is inactive. Check its data status or add another magnet."
      : `Add a magnet to explore the ${noun} sample.`;
    container.innerHTML = `<div class="dust-empty"><p>${message}</p></div>`;
    renderEmpty(mirror, message);
    return;
  }
  if (!recommendationState.scores && magnets.some(magnet => magnet.kind !== "popularity")) {
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
  highlightRecommendation();
}

function createDustView(container, matches, anchors, width, height, onMove, label, mixed) {
  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width).attr("height", height).attr("class", "dust-map").attr("role", "group")
    .attr("aria-label", `${label} ${mixed ? "attraction to" : "similarity to"} ${anchors.map(({ magnet }) => magnet.title).join(", ")}`);
  const paths = svg.append("g").attr("aria-hidden", "true");
  const selectedPaths = paths.append("g");
  const previewPaths = paths.append("g");
  const temperature = dustTemperature(mixed);
  let positions, hovered, focused;
  let selectedKeys = [];
  function drawLinks(layer, className, keys) {
    const links = keys.flatMap(key => {
      const node = positions.get(key);
      if (!node) return [];
      const best = Math.max(...node.scores);
      return anchors.map((anchor, index) => ({ anchor, node,
        affinity: dustAffinity(node.scores[index], best, temperature) }));
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
  const dots = svg.append("g").selectAll("g").data(matches, (match) => match.key).join("g")
    .attr("class", "dust-node").attr("data-match-id", (match) => match.key)
    .attr("role", "button").attr("tabindex", 0).attr("aria-controls", "dust-focus recommendation-detail")
    .attr("aria-label", (match) => `${match.record.title}. ${anchors.map(({ magnet }, index) => mixed ? AnivizDust.mixedEvidence(match, magnet, index)
      : `${AnivizDust.magnetScoreLabel(magnet)}: ${match.scores[index].toFixed(3)}`).join(". ")}. Toggle selection for details or comparison.`)
    .on("mouseenter focus", (event, match) => {
      if (event.type === "focus") focused = match.key;
      else hovered = match.key;
      drawPreview();
      const rect = event.currentTarget.getBoundingClientRect();
      const pointer = event.type === "focus" ? { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 } : event;
      showTooltip(pointer, `<strong>${escapeHTML(match.record.title)}</strong><span>${match.key.startsWith("anilist:") ? escapeHTML(humanize(match.record.format)) + " · " : ""}${match.record.year || "Year unknown"}</span>`
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
  const magnets = svg.append("g").selectAll("g").data(anchors, anchor => anchor.magnet.key).join("g").attr("class", "dust-magnet")
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
  magnets.append("circle").attr("class", "magnet-halo").attr("r", DUST_CLEARANCE).attr("stroke", (anchor) => anchor.color);
  magnets.append("circle").attr("class", "magnet-core").attr("r", MAGNET_CORE_RADIUS).attr("stroke", (anchor) => anchor.color);
  magnets.append("text").attr("class", "magnet-number").attr("text-anchor", "middle").attr("dy", 5)
    .attr("fill", (anchor) => anchor.color).text((_, index) => `M${index + 1}`);
  magnets.append("text").attr("class", "magnet-title").attr("text-anchor", "middle").attr("y", 49)
    .text((anchor) => truncate(anchor.magnet.title, width < 400 ? 16 : 23));
  magnets.append("title").text(({ magnet }) => `${magnet.title} (${magnet.kind === "popularity" ? popularityDescription(magnet)
    : magnet.kind === "genre" ? AnivizDust.cohortDescription(magnet) : magnet.year || "Year unknown"})`);

  return {
    drawColors() {
      grains.attr("fill", AnivizMain.dustColor);
    },
    draw(nextPositions) {
      positions = nextPositions;
      dots.attr("transform", (match) => { const node = positions.get(match.key); return `translate(${node.x},${node.y})`; });
      magnets.attr("transform", (anchor) => `translate(${anchor.x},${anchor.y})`);
    },
    drawLinks(keys) {
      selectedKeys = keys;
      drawLinks(selectedPaths, "dust-selected-link", keys);
      drawPreview();
    }
  };
}

function renderDustChart(container, mirror, magnets, matches, mixed) {
  // Clear the field before measuring so the old SVG cannot size the flex item.
  container.innerHTML = "";
  mirror.innerHTML = "";
  const width = Math.max(240, container.clientWidth);
  const height = Math.max(260, container.clientHeight || (width < 400 ? 440 : 500));
  const initial = defaultMagnetPositions(magnets.length, width, height);
  const anchors = magnets.map((magnet, index) => {
    const saved = recommendationState.magnetPositions[`${magnets.length}:${magnet.key}`];
    const hasPosition = Number.isFinite(saved?.x) && Number.isFinite(saved?.y);
    const position = hasPosition ? { x: saved.x * width, y: saved.y * height } : initial[index];
    return { magnet, color: AnivizMain.color(magnet.key), ...position };
  });
  for (const anchor of anchors) {
    Object.assign(anchor, constrainMagnetPosition(anchor, anchor.x, anchor.y, anchors, width, height));
  }
  const snapshot = AnivizMain.snapshot();
  const noun = snapshot.direction === AnivizDust.REVERSE ? "movies" : "anime";
  let motion = snapshot.motion;
  const views = [createDustView(container, matches, anchors, width, height, moveAnchor, `Displayed ${noun}`, mixed),
    createDustView(mirror, matches, anchors, width, height, moveAnchor, `Mirror of ${noun}`, mixed)];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nodes = createDustNodes(matches, anchors, width, height, dustChart, mixed);
  // First entry is already gathered. Later changes start from the previous positions.
  if (!dustChart || reducedMotion) settleDust(nodes, anchors, width, height, mixed, motion);
  const positions = new Map(nodes.map((node) => [node.key, node]));
  let frame = null, lastTime = null, quietFrames = 0;
  dustChart = { views, positions, anchors, width, height, setMotion(next) {
    motion = next;
    if (reducedMotion) {
      settleDust(nodes, anchors, width, height, mixed, motion);
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
    if (reducedMotion) settleDust(nodes, anchors, width, height, mixed, motion);
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
    const movement = stepDust(nodes, anchors, width, height, elapsed, mixed, motion);
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
