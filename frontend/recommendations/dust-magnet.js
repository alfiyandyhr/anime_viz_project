"use strict";

const MAGNET_COLORS = ["#43d9e6", "#ff6fae", "#ffcc70"];
let dustChart = null;

// Keep the original forward helper available to existing callers.
function getDustMatches(data, scores, movieIds, limit = 60) {
  const engine = typeof module !== "undefined" && module.exports ? require("../common/dust-context.js") : AnivizDust;
  const count = [30, 60, 90].includes(Number(limit)) ? Number(limit) : 60;
  return engine.sampleDust(engine.forwardVectors(data, scores, movieIds), movieIds.length, count)
    .map(({ record, key, sortScore, ...match }) => ({ ...match, anime: record }));
}

function defaultMagnetPositions(count, width, height) {
  const positions = count === 1 ? [[.5, .22]] : count === 2 ? [[.24, .5], [.76, .5]]
    : [[.5, .23], [.23, .70], [.77, .70]];
  return positions.slice(0, count).map(([x, y]) => ({ x: x * width, y: y * height }));
}

const DUST_INPUT_STEP = 1 / 60;
const DUST_MAX_FRAME_TIME = 1 / 40;
const DUST_MAX_SPEED = 120;
const DUST_PULL_SPEED = 36;
const DUST_DRAG_CLEARANCE = 48;
const DUST_CLEARANCE_SPEED = 240;
const DUST_DRAG_SPACING = 28;
const DUST_SPACING_SPEED = 60;

function seedDustPoint(index, count, width, height) {
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const spacing = Math.min(12, Math.min(width / 2 - 14, height / 2 - 18) / Math.sqrt(count));
  const radius = spacing * Math.sqrt(index + .5);
  return { x: width / 2 + radius * Math.cos(angle), y: height / 2 + radius * Math.sin(angle) };
}

function rebaseDustPositions(previous, width, height) {
  if (!previous) return new Map();
  return new Map([...previous.positions].map(([key, point]) => [key, {
    x: Math.max(14, Math.min(width - 14, point.x * (width / previous.width))),
    y: Math.max(18, Math.min(height - 18, point.y * (height / previous.height)))
  }]));
}

function dustGrid(width, height) {
  const columns = Math.floor((width - 28) / 18);
  const rows = Math.floor((height - 36) / 18);
  const points = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      points.push({ x: 14 + column * (width - 28) / columns, y: 18 + row * (height - 36) / rows });
    }
  }
  return points;
}

function createDustNodes(matches, width, height, positions = new Map()) {
  if (!positions.size) {
    return matches.map((match, index) => ({ ...match, ...seedDustPoint(index, matches.length, width, height) }));
  }
  const occupied = [...positions.values()];
  const visible = matches.map(match => positions.get(match.key)).filter(Boolean);
  let seeds, grid;
  function findSpace(points) {
    const available = point => points.every(other => (point.x - other.x) ** 2 + (point.y - other.y) ** 2 >= 12 ** 2);
    const seed = seeds.find(available);
    if (seed) return seed;
    const centerDistance = ({ x, y }) => Math.hypot(x - width / 2, y - height / 2);
    grid ??= dustGrid(width, height).sort((a, b) => centerDistance(a) - centerDistance(b));
    return grid.find(available);
  }
  return matches.map(match => {
    const saved = positions.get(match.key);
    if (saved) return { ...match, x: saved.x, y: saved.y };
    seeds ??= matches.map((_, index) => seedDustPoint(index, matches.length, width, height));
    // Prefer room for filtered grains to return to their saved positions.
    const point = findSpace(occupied) ?? findSpace(visible)
      ?? grid.find(point => visible.every(other => point.x !== other.x || point.y !== other.y));
    occupied.push(point);
    visible.push(point);
    return { ...match, ...point };
  });
}

function dustFrameTime(elapsed) {
  return Math.min(Math.max(elapsed, 0), DUST_MAX_FRAME_TIME);
}

// Return the next positions for one drag-driven step. Scores are signed cosines
// in semantic fields and already-calibrated percentiles in mixed fields.
function dragDustStep(nodes, anchors, width, height, elapsed = DUST_INPUT_STEP) {
  const duration = dustFrameTime(elapsed);
  const active = anchors.map(({ x, y, strength = 1 }, index) => ({ x, y, strength, index }))
    .filter(({ strength }) => strength > 0);
  if (!duration || !active.length) return nodes.map(({ x, y }) => ({ x, y }));
  const budget = DUST_MAX_SPEED * duration;

  const spacing = nodes.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= DUST_DRAG_SPACING ** 2) continue;
      const distance = Math.sqrt(distanceSquared);
      const push = DUST_SPACING_SPEED * (1 - distance / DUST_DRAG_SPACING);
      // Give coincident grains equal and opposite nudges.
      const x = push * (distance ? dx / distance : Math.cos(i + j));
      const y = push * (distance ? dy / distance : Math.sin(i + j));
      spacing[i].x += x; spacing[i].y += y;
      spacing[j].x -= x; spacing[j].y -= y;
    }
  }
  return nodes.map((node, i) => {
    const local = spacing[i];
    const spacingScale = DUST_SPACING_SPEED / Math.max(DUST_SPACING_SPEED, Math.hypot(local.x, local.y));
    let vx = local.x * spacingScale, vy = local.y * spacingScale;
    for (const anchor of active) {
      const score = node.scores?.[anchor.index];
      if (!Number.isFinite(score)) continue;
      const affinity = Math.max(0, Math.min(1, score));
      const dx = anchor.x - node.x, dy = anchor.y - node.y;
      const distance = Math.hypot(dx, dy);
      const clearance = DUST_CLEARANCE_SPEED * Math.max(0, 1 - distance / DUST_DRAG_CLEARANCE);
      const rate = anchor.strength * (DUST_PULL_SPEED * affinity - clearance) / Math.max(distance, DUST_DRAG_CLEARANCE);
      vx += dx * rate; vy += dy * rate;
    }
    const x = Math.max(14, Math.min(width - 14, node.x + vx * duration));
    const y = Math.max(18, Math.min(height - 18, node.y + vy * duration));
    const dx = x - node.x, dy = y - node.y;
    const scale = budget / Math.max(budget, Math.hypot(dx, dy));
    return { x: node.x + dx * scale, y: node.y + dy * scale };
  });
}

function stopDustChart() {
  dustChart?.stop?.();
}

// Keep solid magnets distinct during pointer/keyboard moves and restoration.
function constrainMagnetPosition(anchor, x, y, anchors, width, height) {
  const margin = Math.min(76, width * .22);
  const clamp = (point) => ({ x: Math.max(margin, Math.min(width - margin, point.x)),
    y: Math.max(44, Math.min(height - 78, point.y)) });
  const desired = clamp({ x, y });
  // Allow a few pixels of pointer tolerance when magnets line up in a narrow field.
  const separation = Math.min(110, width * .42, (width - 2 * margin - 8) / Math.max(1, anchors.length - 1));
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
    AnivizMain.setMagnets(AnivizMain.snapshot().magnetKeys.filter(key => key !== button.dataset.removeMagnet));
    document.querySelector("#recommendation-status").textContent = "";
    if (hadFocus) {
      const next = magnetList.querySelector("[data-remove-magnet]") || document.querySelector('#magnet-type input:checked');
      next.focus({ preventScroll: true });
    }
  });
  document.querySelector("#reset-magnets").addEventListener("click", AnivizMain.resetPositions);
  document.querySelector("#reset-strengths").addEventListener("click", AnivizMain.resetStrengths);
  document.querySelector("#attract-dust").addEventListener("click", () => dustChart?.attractDust?.());
  document.querySelector("#center-dust").addEventListener("click", () => dustChart?.centerDust?.());
  document.querySelector("#spread-dust").addEventListener("click", () => dustChart?.spreadDust?.());
  const setStrength = (event) => {
    const slider = event.target;
    if (!slider.matches("[data-magnet-strength]") || slider.disabled) return;
    AnivizMain.setMagnetStrength(slider.dataset.magnetStrength, slider.valueAsNumber, { commit: event.type === "change" });
  };
  magnetList.addEventListener("input", setStrength);
  magnetList.addEventListener("change", setStrength);
}

function formatDustStrength(strength) {
  return strength === 0 ? "0× · Muted" : `${Number(strength.toPrecision(3))}×`;
}

function updateDustStrengths(key, strength) {
  for (const slider of document.querySelectorAll("#movie-magnets [data-magnet-strength]")) {
    const magnetKey = slider.dataset.magnetStrength;
    if (key !== undefined && key !== magnetKey) continue;
    const value = strength ?? AnivizMain.magnetStrength(magnetKey);
    if (slider.valueAsNumber !== value) slider.value = value;
    const label = formatDustStrength(value);
    slider.setAttribute("aria-valuetext", label);
    slider.nextElementSibling.textContent = label;
    slider.closest(".movie-magnet-chip").classList.toggle("is-muted", value === 0);
  }
  if (!dustChart?.views) return;
  for (const anchor of dustChart.anchors) {
    if (key === undefined || key === anchor.magnet.key) {
      anchor.strength = strength ?? AnivizMain.magnetStrength(anchor.magnet.key);
    }
  }
  dustChart.views.forEach(view => view.drawStrengths());
  dustChart.updateStatus();
}

function renderDustRecommendations() {
  const { magnets, magnetKeys, popularity, mixed, displayedDust, direction, example } = AnivizMain.snapshot();
  const reverse = direction === AnivizDust.REVERSE;
  const noun = reverse ? "movies" : "anime";
  const container = document.querySelector("#recommendation-chart");
  const mirror = document.querySelector("#dust-mirror");
  const legend = document.querySelector("#dust-legend");
  legend.hidden = !magnets.length;
  legend.innerHTML = (magnets.length ? '<span>Strongest base score</span>' : "") + magnets.map((magnet, index) => `
    <span title="${mixed ? "Highest base percentile for" : "Highest cosine similarity to"} ${escapeAttribute(magnet.title)}"><i class="dust-legend-dot" style="--magnet-color:${AnivizMain.color(magnet.key)}" aria-hidden="true"></i>M${index + 1}</span>`).join("")
    + (magnets.length ? `<span><i class="dust-legend-dot is-selected" aria-hidden="true"></i>Selected</span>` : "");
  document.querySelector("#dust-layout-status").hidden = true;
  document.querySelector("#dust-layout-status").textContent = "";
  document.querySelector("#recommendation-content").hidden = false;
  document.querySelector("#recommendation-chart-title").textContent = reverse ? "Movies shown" : "Anime shown";
  document.querySelector("#movie-magnets").innerHTML = magnetKeys.map(key => {
    const index = magnets.findIndex(magnet => magnet.key === key);
    const magnet = magnets[index] || popularity;
    const description = magnet.kind === "popularity" ? (index < 0 ? "Inactive" : popularityDescription(magnet))
      : magnet.kind === "genre" ? AnivizDust.cohortDescription(magnet) : magnet.year || "";
    const strength = AnivizMain.magnetStrength(key);
    const label = formatDustStrength(strength);
    return `<div class="movie-magnet-chip${index >= 0 && strength === 0 ? " is-muted" : ""}" style="--magnet-color:${AnivizMain.color(magnet.key) || "currentColor"}">
      <span class="magnet-chip-number">${index < 0 ? "–" : index + 1}</span><span>${escapeHTML(magnet.title)} <small>${escapeHTML(description)}</small>${example ? ' <em class="magnet-example">Example</em>' : ""}</span>
      <button type="button" data-remove-magnet="${escapeAttribute(magnet.key)}" aria-label="Remove ${escapeAttribute(magnet.title)} magnet">×</button>
      ${index < 0 ? "" : `<label class="magnet-strength-control">
        <span>Strength</span>
        <input type="range" min="0" max="2" step="any" value="${strength}" data-magnet-strength="${escapeAttribute(key)}"
          aria-label="Strength for ${escapeAttribute(magnet.title)}" aria-valuetext="${label}">
        <span aria-hidden="true">${label}</span>
      </label>`}
    </div>`;
  }).join("") + `<span class="magnet-empty-slot">${magnetKeys.length}/3 magnets${magnetKeys.length === 3 ? " · remove one to swap" : ""}</span>`;
  document.querySelectorAll("#movie-suggestions button").forEach(button => {
    button.setAttribute("aria-pressed", magnets.some(magnet => magnet.key === button.dataset.magnetKey));
  });
  document.querySelector("#reset-magnets").disabled = !magnets.length;
  document.querySelector("#reset-strengths").disabled = !magnets.length;
  for (const id of ["attract-dust", "center-dust", "spread-dust"]) document.getElementById(id).disabled = true;
  // Keep cached positions through empty fields and temporary score loading.
  if (dustChart) {
    const { width, height, positions } = dustChart;
    dustChart = { width, height, positions };
  }
  if (!magnets.length) {
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

function createDustView(container, matches, anchors, width, height, movement, label, mixed) {
  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width).attr("height", height).attr("class", "dust-map").attr("role", "group")
    .attr("aria-label", `${label} ${mixed ? "attraction to" : "similarity to"} ${anchors.map(({ magnet }) => magnet.title).join(", ")}`);
  const paths = svg.append("g").attr("aria-hidden", "true");
  const dots = svg.append("g").selectAll("g").data(matches, (match) => match.key).join("g")
    .attr("class", "dust-node").attr("data-match-id", (match) => match.key)
    .attr("role", "button").attr("tabindex", 0).attr("aria-controls", "dust-focus recommendation-detail")
    .attr("aria-label", (match) => `${match.record.title}. ${anchors.map(({ magnet }, index) => mixed ? AnivizDust.mixedEvidence(match, magnet, index)
      : `${AnivizDust.magnetScoreLabel(magnet)}: ${match.scores[index].toFixed(3)}`).join(". ")}. Toggle selection for details or comparison.`)
    .on("mouseenter focus", (event, match) => {
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
    .on("mouseleave blur", hideTooltip)
    .on("click", (event, match) => { hideTooltip(); AnivizMain.select(match.key); })
    .on("keydown", (event, match) => {
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); hideTooltip(); AnivizMain.select(match.key); }
      if (event.key === "Escape") hideTooltip();
    });
  dots.append("circle").attr("class", "dust-hit-area").attr("r", 9);
  dots.append("circle").attr("class", "dust-grain").attr("r", 4.5).attr("fill", (match) => anchors[match.closest].color);
  const magnets = svg.append("g").selectAll("g").data(anchors, anchor => anchor.magnet.key).join("g").attr("class", "dust-magnet")
    .attr("role", ({ magnet }) => magnet.kind === undefined ? "button" : "group").attr("tabindex", 0)
    .attr("aria-controls", ({ magnet }) => magnet.kind === undefined ? "dust-focus" : null)
    .style("--magnet-color", ({ color }) => color)
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
      movement.nudgeAnchor(anchor, ...delta);
    })
    .call(d3.drag().clickDistance(4).on("start", (event, anchor) => {
      hideTooltip();
      const gesture = movement.startMove(anchor);
      event.on("drag", event => movement.moveAnchor(gesture, event.x, event.y))
        .on("end", event => movement.endMove(gesture, event.sourceEvent.type === "touchcancel"));
    }));
  magnets.append("circle").attr("class", "magnet-halo").attr("r", 34);
  magnets.append("circle").attr("class", "magnet-core").attr("r", 25);
  magnets.append("text").attr("class", "magnet-number").attr("text-anchor", "middle").attr("dy", 5)
    .text((_, index) => `M${index + 1}`);
  magnets.append("text").attr("class", "magnet-title").attr("text-anchor", "middle").attr("y", 49)
    .text((anchor) => truncate(anchor.magnet.title, width < 400 ? 16 : 23));
  magnets.append("title").text(({ magnet }) => `${magnet.title} (${magnet.kind === "popularity" ? popularityDescription(magnet)
    : magnet.kind === "genre" ? AnivizDust.cohortDescription(magnet) : magnet.year || "Year unknown"})`);

  function drawStrengths() {
    magnets.classed("is-muted", ({ strength }) => strength === 0)
      .style("--magnet-halo-opacity", ({ strength }) => .06 + .08 * strength)
      .attr("aria-label", ({ magnet, strength }) => `${magnet.title} magnet. Strength ${formatDustStrength(strength)}.${magnet.kind === undefined ? " Activate to view details." : ""} Drag or use arrow keys to move.`);
  }
  drawStrengths();
  return {
    drawStrengths,
    draw(positions) {
      dots.attr("transform", (match) => { const node = positions.get(match.key); return `translate(${node.x},${node.y})`; });
      magnets.attr("transform", (anchor) => `translate(${anchor.x},${anchor.y})`);
    },
    drawLinks(links) {
      paths.selectAll("line").data(links).join("line")
        .attr("class", "dust-selected-link")
        .attr("stroke", link => link.anchor.color)
        .attr("x1", link => link.anchor.x).attr("y1", link => link.anchor.y)
        .attr("x2", link => link.node.x).attr("y2", link => link.node.y);
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
    const saved = recommendationState.magnetPositions[positionKey(magnet)];
    const hasPosition = Number.isFinite(saved?.x) && Number.isFinite(saved?.y);
    const position = hasPosition ? { x: saved.x * width, y: saved.y * height } : initial[index];
    return { magnet, color: AnivizMain.color(magnet.key), strength: AnivizMain.magnetStrength(magnet.key), ...position };
  });
  constrainAnchors();
  const noun = AnivizMain.snapshot().direction === AnivizDust.REVERSE ? "movies" : "anime";
  const movement = { startMove, moveAnchor, nudgeAnchor, endMove };
  const views = [createDustView(container, matches, anchors, width, height, movement, `Displayed ${noun}`, mixed),
    createDustView(mirror, matches, anchors, width, height, movement, `Mirror of ${noun}`, mixed)];
  const positions = rebaseDustPositions(dustChart, width, height);
  const nodes = createDustNodes(matches, width, height, positions);
  nodes.forEach(node => positions.set(node.key, node));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gestures = new Set();
  const pendingMoves = new Map();
  const status = document.querySelector("#dust-layout-status");
  const attractButton = document.querySelector("#attract-dust");
  let frame = null, lastMoveTime = null, stopped = false;
  dustChart = { views, positions, anchors, width, height, updateStatus, resetPositions,
    attractDust, centerDust, spreadDust, stop() {
      clearMoves();
      stopped = true;
    }
  };

  function positionKey(magnet) {
    return `${magnets.length}:${magnet.key}`;
  }
  function constrainAnchors() {
    for (const anchor of anchors) {
      Object.assign(anchor, constrainMagnetPosition(anchor, anchor.x, anchor.y, anchors, width, height));
    }
  }
  function applyMove(anchor, { x, y }) {
    const next = constrainMagnetPosition(anchor, x, y, anchors, width, height);
    if (next.x === anchor.x && next.y === anchor.y) return false;
    Object.assign(anchor, next);
    recommendationState.magnetPositions[positionKey(anchor.magnet)] = { x: anchor.x / width, y: anchor.y / height };
    return true;
  }
  function startMove(anchor) {
    const gesture = { anchor, moved: false };
    if (!stopped) gestures.add(gesture);
    return gesture;
  }
  function moveAnchor(gesture, x, y) {
    if (!gestures.has(gesture)) return;
    pendingMoves.set(gesture, { x, y });
    if (frame === null) frame = requestAnimationFrame(applyDragFrame);
  }
  function endMove(gesture, cancelled) {
    if (!gestures.delete(gesture)) return;
    const point = pendingMoves.get(gesture);
    pendingMoves.delete(gesture);
    if (!pendingMoves.size) cancelFrame();
    if (!gestures.size) lastMoveTime = null;
    const movedAtEnd = !cancelled && point && applyMove(gesture.anchor, point);
    const updateDust = !cancelled && reducedMotion && (gesture.moved || movedAtEnd);
    if (updateDust) step();
    if (movedAtEnd || updateDust) draw();
    if (gesture.moved || movedAtEnd) AnivizMain.saveLayout();
  }
  function applyDragFrame(time) {
    frame = null;
    let moved = false;
    for (const [gesture, point] of pendingMoves) {
      if (!applyMove(gesture.anchor, point)) continue;
      gesture.moved = true;
      moved = true;
    }
    pendingMoves.clear();
    if (!moved) return;
    if (!reducedMotion) {
      const elapsed = lastMoveTime === null ? DUST_INPUT_STEP : (time - lastMoveTime) / 1000;
      // A pause in pointer input leaves no simulation time to catch up.
      step(elapsed > 2 * DUST_MAX_FRAME_TIME ? DUST_INPUT_STEP : elapsed);
      lastMoveTime = time;
    }
    draw();
  }
  function cancelFrame() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function clearMoves() {
    cancelFrame();
    pendingMoves.clear();
    gestures.clear();
    lastMoveTime = null;
  }
  function nudgeAnchor(anchor, dx, dy) {
    if (stopped || !applyMove(anchor, { x: anchor.x + dx, y: anchor.y + dy })) return;
    clearMoves();
    step();
    draw();
    AnivizMain.saveLayout();
  }
  function step(elapsed = DUST_INPUT_STEP) {
    const next = dragDustStep(nodes, anchors, width, height, elapsed);
    nodes.forEach((node, index) => Object.assign(node, next[index]));
  }
  function attractDust() {
    if (stopped) return;
    clearMoves();
    step();
    draw();
    AnivizMain.saveLayout();
  }
  function centerDust() {
    if (stopped) return;
    clearMoves();
    nodes.forEach((node, index) => Object.assign(node, seedDustPoint(index, nodes.length, width, height)));
    draw();
    AnivizMain.saveLayout();
  }
  function spreadDust() {
    if (stopped) return;
    clearMoves();
    const grid = dustGrid(width, height).filter(point =>
      anchors.every(anchor => Math.hypot(point.x - anchor.x, point.y - anchor.y) >= 38));
    nodes.forEach((node, index) => Object.assign(node, grid[Math.floor(index * grid.length / nodes.length)]));
    draw();
    AnivizMain.saveLayout();
  }
  function resetPositions() {
    if (stopped) return;
    clearMoves();
    anchors.forEach((anchor, index) => Object.assign(anchor, initial[index]));
    constrainAnchors();
    draw();
  }
  function updateStatus() {
    const allMuted = anchors.every(anchor => anchor.strength === 0);
    const message = !nodes.length ? "" : allMuted ? "All magnets are muted. Increase a strength to pull dust."
      : reducedMotion ? "Reduced motion is on. Dust takes one short step when you release a moved magnet." : "";
    if (status.textContent !== message) status.textContent = message;
    status.hidden = !message;
    attractButton.disabled = !nodes.length || allMuted;
  }
  function draw() {
    views.forEach(view => view.draw(positions));
    highlightDustConnections();
  }
  document.querySelector("#center-dust").disabled = !nodes.length;
  document.querySelector("#spread-dust").disabled = !nodes.length;
  updateStatus();
  draw();
}

function highlightDustConnections() {
  if (!dustChart?.views) return;
  const links = AnivizMain.snapshot().selectedKeys.flatMap(key => {
    const node = dustChart.positions.get(key);
    return node ? dustChart.anchors.map(anchor => ({ anchor, node })) : [];
  });
  dustChart.views.forEach(view => view.drawLinks(links));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getDustMatches, defaultMagnetPositions, createDustNodes, rebaseDustPositions, dragDustStep, constrainMagnetPosition };
}
