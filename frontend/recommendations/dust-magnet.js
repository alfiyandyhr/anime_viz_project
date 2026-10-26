"use strict";

const MAGNET_COLORS = ["#43d9e6", "#b49aff", "#ffcc70"];
let dustChart = null;

// Keep a fair share of each magnet's strongest matches, then fill by mean score.
// Every candidate is scored against every movie using the complete matrix.
function getDustMatches(data, scores, movieIds, limit = 60) {
  if (!movieIds.length || !scores) return [];
  const movieIndices = movieIds.map((id) => data.movies.findIndex((movie) => movie.id === id));
  if (movieIndices.some((index) => index < 0)) return [];
  const candidates = data.anime.map((anime, index) => {
    const values = movieIndices.map((movieIndex) => scores[movieIndex * data.anime.length + index]);
    return { anime, index, scores: values, score: values.reduce((a, b) => a + b, 0) / values.length,
      closest: values.indexOf(Math.max(...values)), group: "dust" };
  });
  const ranked = candidates.slice().sort((a, b) => b.score - a.score || a.index - b.index);
  ranked.forEach((match, index) => { match.rank = index + 1; });
  const count = Math.min(data.anime.length, [30, 60, 90].includes(Number(limit)) ? Number(limit) : 60);
  const chosen = new Set();
  const perMovie = Math.floor(count / (movieIds.length * 2));
  movieIds.forEach((_, movieIndex) => {
    candidates.slice().sort((a, b) => b.scores[movieIndex] - a.scores[movieIndex] || a.index - b.index)
      .slice(0, perMovie).forEach((match) => chosen.add(match.index));
  });
  for (const match of ranked) {
    if (chosen.size >= count) break;
    chosen.add(match.index);
  }
  return ranked.filter((match) => chosen.has(match.index));
}

function defaultMagnetPositions(count, width, height) {
  const positions = count === 1 ? [[.5, .5]] : count === 2 ? [[.24, .5], [.76, .5]]
    : [[.5, .23], [.23, .70], [.77, .70]];
  return positions.slice(0, count).map(([x, y]) => ({ x: x * width, y: y * height }));
}

const DUST_SPACING = 18;
const DUST_CLEARANCE = 34;
const DUST_STEP = 1 / 120;

// A score order is a set of linear half-planes: being closer to A than B
// means (B - A) dot (point - midpoint(A, B)) < 0. Unlike weighted springs,
// this remains true for an uneven triangle and after collision separation.
function clipDustRegion(polygon, a, b, gap) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-6) return polygon;
  const nx = (b.x - a.x) / length, ny = (b.y - a.y) / length;
  const boundary = nx * (a.x + b.x) / 2 + ny * (a.y + b.y) / 2 - gap;
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const dp = nx * p.x + ny * p.y - boundary;
    const dq = nx * q.x + ny * q.y - boundary;
    if (dp <= 0) result.push(p);
    if ((dp <= 0) !== (dq <= 0)) {
      const t = dp / (dp - dq);
      result.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return result;
}

function projectDustPoint(point, region) {
  let inside = true, best = null, distance = Infinity;
  for (let i = 0; i < region.length; i++) {
    const a = region[i], b = region[(i + 1) % region.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx * (point.y - a.y) - dy * (point.x - a.x) < -1e-7) inside = false;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const candidate = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2;
    if (d < distance) { best = candidate; distance = d; }
  }
  return inside ? { x: point.x, y: point.y } : best;
}

function dustScoreLayout(node, anchors, width, height) {
  const key = `${width}:${height}:${anchors.map((a) => `${a.x},${a.y}`).join(":")}`;
  if (node.scoreLayout?.key === key) return node.scoreLayout;
  const box = [{ x: 14, y: 18 }, { x: width - 14, y: 18 },
    { x: width - 14, y: height - 18 }, { x: 14, y: height - 18 }];
  let region = box, approximate = false;
  const order = anchors.map((_, i) => i).sort((a, b) => node.scores[b] - node.scores[a]);
  // Prioritize the best movie if a dragged, nearly collinear arrangement
  // cannot express all three preferences within the visible field.
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const gap = node.scores[order[i]] - node.scores[order[j]];
      if (gap <= 0) continue; // Ties have no arbitrary movie-order preference.
      const clipped = clipDustRegion(region, anchors[order[i]], anchors[order[j]], Math.min(.5, gap * 20));
      if (clipped.length >= 3) region = clipped;
      else approximate = true;
    }
  }
  // Fit squared-distance differences to score differences. Three magnets give
  // two linear equations; two magnets leave the perpendicular direction free.
  // This uses signed scores, so zero/negative scores retain their true order.
  const a = anchors[0], b = anchors[1];
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const scale = Math.min(width, height) ** 2 * 1.5;
  const rhs = (b.x * b.x + b.y * b.y - a.x * a.x - a.y * a.y
    - scale * (node.scores[0] - node.scores[1])) / 2;
  let target = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const offset = (rhs - dx * target.x - dy * target.y) / (length2 || 1);
  target.x += dx * offset; target.y += dy * offset;
  if (anchors.length === 3) {
    const c = anchors[2], ex = c.x - a.x, ey = c.y - a.y;
    const determinant = dx * ey - dy * ex;
    if (Math.abs(determinant) > 1e-6) {
      const other = (c.x * c.x + c.y * c.y - a.x * a.x - a.y * a.y
        - scale * (node.scores[0] - node.scores[2])) / 2;
      target = { x: (rhs * ey - dy * other) / determinant, y: (dx * other - rhs * ex) / determinant };
    }
  }
  return (node.scoreLayout = { key, region, target: projectDustPoint(target, region), approximate });
}

function dustAttraction(node, anchors, target) {
  if (target) return { x: 10 * (target.x - node.x), y: 10 * (target.y - node.y) };
  let x = 0, y = 0;
  anchors.forEach((anchor, index) => {
    const strength = 18 * Math.max(0, Math.min(1, node.scores[index] || 0)) / anchors.length;
    x += strength * (anchor.x - node.x);
    y += strength * (anchor.y - node.y);
  });
  return { x, y };
}

function createDustNodes(matches, anchors, width, height, previous) {
  return matches.map((match, index) => {
    const saved = previous?.positions.get(match.anime.id);
    if (saved) return { ...match, x: saved.x * width / previous.width,
      y: saved.y * height / previous.height, vx: saved.vx || 0, vy: saved.vy || 0 };
    const layout = anchors.length > 1 ? dustScoreLayout({ ...match }, anchors, width, height) : null;
    const weights = anchors.map((_, i) => Math.max(0, match.scores[i] || 0));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const center = layout?.target || (total ? anchors.reduce((point, anchor, i) => ({
      x: point.x + anchor.x * weights[i] / total,
      y: point.y + anchor.y * weights[i] / total
    }), { x: 0, y: 0 }) : { x: width / 2, y: height / 2 });
    // A filled spiral seeds a compact cloud, never a similarity-radius ring.
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = 10 * Math.sqrt(index + .5);
    const point = { x: Math.max(14, Math.min(width - 14, center.x + radius * Math.cos(angle))),
      y: Math.max(18, Math.min(height - 18, center.y + radius * Math.sin(angle))) };
    return { ...match, ...(layout ? projectDustPoint(point, layout.region) : point), vx: 0, vy: 0 };
  });
}

// Persistent positions and velocities are integrated in small fixed substeps.
// Project collision motion back into each dot's score-order region so crowding
// cannot make a lower-scoring movie appear closer.
function stepDust(nodes, anchors, width, height, elapsed = 1 / 60) {
  const steps = Math.max(1, Math.ceil(Math.min(Math.max(elapsed, 0), 1 / 30) / DUST_STEP));
  const dt = Math.min(Math.max(elapsed, 0), 1 / 30) / steps;
  const layouts = nodes.map((node) => anchors.length > 1 ? dustScoreLayout(node, anchors, width, height) : null);
  const before = nodes.map((node) => ({ x: node.x, y: node.y }));
  for (let step = 0; step < steps; step++) {
    const forces = nodes.map((node, index) => dustAttraction(node, anchors, layouts[index]?.target));
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = node.x - nodes[j].x, dy = node.y - nodes[j].y;
        let distance = Math.hypot(dx, dy);
        if (distance >= DUST_SPACING) continue;
        if (distance < 1e-6) { dx = Math.cos(i + j); dy = Math.sin(i + j); distance = 1; }
        const push = (DUST_SPACING - distance) * 2500 / distance;
        forces[i].x += dx * push; forces[i].y += dy * push;
        forces[j].x -= dx * push; forces[j].y -= dy * push;
      }
      for (const anchor of anchors) {
        let dx = node.x - anchor.x, dy = node.y - anchor.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= DUST_CLEARANCE) continue;
        if (distance < 1e-6) { dx = Math.cos(i); dy = Math.sin(i); distance = 1; }
        const push = (DUST_CLEARANCE - distance) * 900 / distance;
        forces[i].x += dx * push; forces[i].y += dy * push;
      }
    }
    nodes.forEach((node, index) => {
      node.vx = ((node.vx || 0) + forces[index].x * dt) * Math.exp(-10 * dt);
      node.vy = ((node.vy || 0) + forces[index].y * dt) * Math.exp(-10 * dt);
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 300) { node.vx *= 300 / speed; node.vy *= 300 / speed; }
      let x = Math.max(14, Math.min(width - 14, node.x + node.vx * dt));
      let y = Math.max(18, Math.min(height - 18, node.y + node.vy * dt));
      if (layouts[index]) {
        const point = projectDustPoint({ x, y }, layouts[index].region);
        // Remove velocity into a score boundary, retaining motion along it.
        const dx = x - point.x, dy = y - point.y, d2 = dx * dx + dy * dy;
        const outward = node.vx * dx + node.vy * dy;
        if (d2 > 1e-12 && outward > 0) { node.vx -= outward * dx / d2; node.vy -= outward * dy / d2; }
        x = point.x; y = point.y;
      }
      if (x === 14 || x === width - 14) node.vx = 0;
      if (y === 18 || y === height - 18) node.vy = 0;
      node.x = x; node.y = y;
    });
  }
  // At a narrow score-region corner, a grain cannot yield in every direction.
  // Pass its blocked share of a contact correction to its neighbor instead of
  // leaving two visible grains stacked at the corner.
  if (anchors.length > 1) for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = a.x - b.x, dy = a.y - b.y, distance = Math.hypot(dx, dy);
      if (distance >= 11 || distance < 1e-8) continue;
      const nx = dx / distance, ny = dy / distance, overlap = 11 - distance;
      const p = projectDustPoint({ x: a.x + nx * overlap / 2, y: a.y + ny * overlap / 2 }, layouts[i].region);
      const moved = (p.x - a.x) * nx + (p.y - a.y) * ny;
      const q = projectDustPoint({ x: b.x - nx * (overlap - moved), y: b.y - ny * (overlap - moved) }, layouts[j].region);
      const remaining = overlap - moved - ((b.x - q.x) * nx + (b.y - q.y) * ny);
      const next = projectDustPoint({ x: p.x + nx * remaining, y: p.y + ny * remaining }, layouts[i].region);
      Object.assign(a, next); Object.assign(b, q);
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing < 0) {
        a.vx -= closing * nx / 2; a.vy -= closing * ny / 2;
        b.vx += closing * nx / 2; b.vy += closing * ny / 2;
      }
    }
  }
  return nodes.reduce((movement, node, i) => Math.max(movement,
    Math.hypot(node.x - before[i].x, node.y - before[i].y)), 0);
}

function layoutDust(matches, anchors, width, height) {
  if (!matches.length || !anchors.length) return [];
  const nodes = createDustNodes(matches, anchors, width, height);
  for (let tick = 0; tick < 480; tick++) stepDust(nodes, anchors, width, height);
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

function selectedMagnetMovies() {
  return recommendationState.movieIds.map((id) => recommendationState.data.movies.find((movie) => movie.id === id));
}

function bindDustControls() {
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".dust-node")) clearDustSelection();
  });
  document.querySelector("#dust-limit").addEventListener("change", (event) => {
    recommendationState.dustLimit = Number(event.target.value);
    renderRecommendations();
  });
  document.querySelector("#movie-magnets").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-magnet]");
    if (!button) return;
    recommendationState.movieIds = recommendationState.movieIds.filter((id) => id !== button.dataset.removeMagnet);
    if (!recommendationState.movieIds.includes(recommendationState.movieId) && recommendationState.movieIds.length) {
      recommendationState.movieId = recommendationState.movieIds.at(-1);
      recommendationState.tablePage = 0;
    }
    recommendationState.animeId = null;
    renderRecommendations();
    document.querySelector("#movie-search").focus();
  });
  document.querySelector("#reset-magnets").addEventListener("click", () => {
    recommendationState.magnetPositions = {};
    recommendationState.animeId = null;
    renderRecommendations();
  });
}

function clearDustSelection() {
  if (recommendationState.viz !== "magnets" || recommendationState.animeId === null) return;
  recommendationState.animeId = null;
  hideTooltip();
  renderDustDetail();
  highlightRecommendation();
}

function renderDustRecommendations() {
  const movies = selectedMagnetMovies();
  const data = recommendationState.data;
  const container = document.querySelector("#recommendation-chart");
  stopDustChart();
  document.querySelector("#dust-layout-status").hidden = true;
  document.querySelector("#dust-layout-status").textContent = "";
  document.querySelector("#recommendation-content").hidden = false;
  document.querySelector("#recommendation-chart-kicker").textContent = "A constellation of your taste";
  document.querySelector("#recommendation-chart-title").textContent = movies.length > 1
    ? "Find the stories between your favorites." : "Follow the pull of a familiar story.";
  document.querySelector("#recommendation-chart-guide").textContent = "Compare a dot’s distances to your movies: higher similarity places it nearer that magnet. Drag magnets to rearrange the field, or use arrow keys on a focused magnet. Hover or focus a dot for scores; select it to explore.";
  document.querySelector("#recommendation-score-note").textContent = "With multiple movies, each dot stays closer to its higher-scoring magnets. Distances show preference order, not an exact cosine scale; compare scores on hover or focus. Color = highest-scoring movie; pink = selected anime. Anime-to-anime distances have no meaning.";
  document.querySelector("#movie-magnets").innerHTML = movies.map((movie, index) => `
    <div class="movie-magnet-chip" style="--magnet-color:${MAGNET_COLORS[index]}">
      <span class="magnet-chip-number">${index + 1}</span><span>${escapeHTML(movie.title)} <small>${movie.year || ""}</small></span>
      <button type="button" data-remove-magnet="${escapeAttribute(movie.id)}" aria-label="Remove ${escapeAttribute(movie.title)} magnet">×</button>
    </div>`).join("") + (movies.length < 3 ? `<span class="magnet-empty-slot">${movies.length ? `${movies.length}/3 movies · add another above` : "Search above to add your first movie"}</span>` : `<span class="magnet-empty-slot">3/3 movies · remove one to swap</span>`);
  document.querySelectorAll("#movie-suggestions button").forEach((button) => {
    const selected = recommendationState.movieIds.includes(button.dataset.movieId);
    button.setAttribute("aria-pressed", selected);
    button.disabled = !selected && movies.length >= 3;
  });
  document.querySelector("#reset-magnets").disabled = !movies.length;
  if (!movies.length) {
    container.innerHTML = `<div class="dust-empty"><span aria-hidden="true">✦</span><h4>It starts with a movie you love.</h4><p>Add up to three favorites. We’ll find anime drawn to their stories.</p></div>`;
    recommendationState.dustMatches = [];
    renderDustDetail();
    document.querySelector("#recommendation-status").textContent = "No magnets selected. Search for a movie or choose a suggestion.";
    return;
  }
  if (!recommendationState.scores) {
    container.innerHTML = `<div class="dust-empty" role="status"><p>${recommendationState.scoresError
      ? `Could not load full similarities: ${escapeHTML(recommendationState.scoresError)}` : "Gathering the anime dust…"}</p>${recommendationState.scoresError ? `<button type="button" class="small-button ghost" id="dust-retry">Retry full scores</button>` : ""}</div>`;
    recommendationState.dustMatches = [];
    renderDustDetail();
    document.querySelector("#dust-retry")?.addEventListener("click", () => {
      recommendationState.scoresError = null;
      void loadRecommendationScores();
      renderRecommendations();
    });
    if (!recommendationState.scoresError && !recommendationState.scoresLoading) void loadRecommendationScores();
    return;
  }
  const matches = getDustMatches(data, recommendationState.scores, recommendationState.movieIds, recommendationState.dustLimit);
  recommendationState.dustMatches = matches;
  if (!matches.some((match) => match.anime.id === recommendationState.animeId)) recommendationState.animeId = null;
  if (!document.querySelector("#movie-search").value) document.querySelector("#recommendation-status").textContent =
    `${movies.length}/3 movie magnets · ${matches.length} of ${numberFormatter.format(data.anime.length)} anime shown · strong matches to each movie + shared favorites.`;
  renderDustChart(container, movies, matches);
  renderDustDetail();
  highlightRecommendation();
}

function renderDustChart(container, movies, matches) {
  container.innerHTML = "";
  const width = Math.max(240, container.clientWidth), height = width < 400 ? 440 : 500;
  const initial = defaultMagnetPositions(movies.length, width, height);
  const anchors = movies.map((movie, index) => {
    const saved = recommendationState.magnetPositions[`${movies.length}:${movie.id}`];
    return { movie, color: MAGNET_COLORS[index], ...(saved ? { x: saved.x * width, y: saved.y * height } : initial[index]) };
  });
  for (const anchor of anchors) {
    Object.assign(anchor, constrainMagnetPosition(anchor, anchor.x, anchor.y, anchors, width, height));
  }
  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width).attr("height", height).attr("class", "dust-map").attr("role", "group")
    .attr("aria-label", `Anime similarity to ${movies.map((movie) => movie.title).join(", ")}`);
  const paths = svg.append("g").attr("aria-hidden", "true").selectAll("line").data(anchors).join("line")
    .attr("class", "dust-selected-link").attr("visibility", "hidden").attr("stroke", (anchor) => anchor.color);
  const dots = svg.append("g").selectAll("g").data(matches, (match) => match.anime.id).join("g")
    .attr("class", "dust-node").attr("data-match-id", (match) => match.anime.id)
    .attr("role", "button").attr("tabindex", 0).attr("aria-controls", "recommendation-detail")
    .attr("aria-label", (match) => `${match.anime.title}. ${movies.map((movie, index) => `${movie.title}: cosine ${match.scores[index].toFixed(3)}`).join(". ")}. Select for details.`)
    .on("mouseenter focus", (event, match) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const pointer = event.type === "focus" ? { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 } : event;
      showTooltip(pointer, `<strong>${escapeHTML(match.anime.title)}</strong><span>${escapeHTML(humanize(match.anime.format))} · ${match.anime.year || "Year unknown"}</span>`
        + movies.map((movie, index) => `<span class="dust-tooltip-score"><i style="background:${MAGNET_COLORS[index]}"></i>${escapeHTML(movie.title)} <b>${match.scores[index].toFixed(3)}</b></span>`).join("")
        + `<span>Click or press Enter to explore ↗</span>`);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave blur", hideTooltip)
    .on("click", (event, match) => { hideTooltip(); selectRecommendationAnime(match.anime.id); })
    .on("keydown", (event, match) => {
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); hideTooltip(); selectRecommendationAnime(match.anime.id); }
      if (event.key === "Escape") { hideTooltip(); clearDustSelection(); }
    });
  dots.append("circle").attr("class", "dust-hit-area").attr("r", 9);
  dots.append("circle").attr("class", "dust-grain").attr("r", 4.5).attr("fill", (match) => MAGNET_COLORS[match.closest]);
  const magnets = svg.append("g").selectAll("g").data(anchors).join("g").attr("class", "dust-magnet")
    .attr("role", "group").attr("tabindex", 0)
    .attr("aria-label", (anchor) => `${anchor.movie.title} magnet. Drag or use arrow keys to move.`)
    .on("keydown", (event, anchor) => {
      const delta = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[event.key];
      if (!delta) return;
      event.preventDefault();
      moveAnchor(anchor, anchor.x + delta[0], anchor.y + delta[1]);
    })
    .call(d3.drag().on("start", hideTooltip)
      .on("drag", (event, anchor) => moveAnchor(anchor, event.x, event.y)));
  magnets.append("circle").attr("class", "magnet-halo").attr("r", 34).attr("stroke", (anchor) => anchor.color);
  magnets.append("circle").attr("class", "magnet-core").attr("r", 25).attr("stroke", (anchor) => anchor.color);
  magnets.append("text").attr("class", "magnet-number").attr("text-anchor", "middle").attr("dy", 5)
    .attr("fill", (anchor) => anchor.color).text((_, index) => `M${index + 1}`);
  magnets.append("text").attr("class", "magnet-title").attr("text-anchor", "middle").attr("y", 49)
    .text((anchor) => truncate(anchor.movie.title, width < 400 ? 16 : 23));
  magnets.append("title").text((anchor) => `${anchor.movie.title} (${anchor.movie.year || "Year unknown"})`);

  const nodes = createDustNodes(matches, anchors, width, height, dustChart);
  // First entry is already gathered; subsequent changes retain the same grains.
  if (!dustChart) for (let tick = 0; tick < 360; tick++) stepDust(nodes, anchors, width, height);
  const positions = new Map(nodes.map((node) => [node.anime.id, node]));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = null, lastTime = null, quietFrames = 0;
  dustChart = { paths, positions, anchors, width, height, stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; lastTime = null;
  } };
  function moveAnchor(anchor, x, y) {
    Object.assign(anchor, constrainMagnetPosition(anchor, x, y, anchors, width, height));
    recommendationState.magnetPositions[`${movies.length}:${anchor.movie.id}`] = { x: anchor.x / width, y: anchor.y / height };
    // Keep each grain's identity and project only as far as needed to preserve
    // its score order when the moving bisectors cross it.
    stepDust(nodes, anchors, width, height, 0);
    draw();
    wake();
  }
  function draw() {
    dots.attr("transform", (match) => { const node = positions.get(match.anime.id); return `translate(${node.x},${node.y})`; });
    magnets.attr("transform", (anchor) => `translate(${anchor.x},${anchor.y})`);
    highlightDustConnections(recommendationState.animeId);
    const status = document.querySelector("#dust-layout-status");
    const approximate = nodes.some((node) => node.scoreLayout?.approximate);
    const message = approximate
      ? "This magnet arrangement cannot show every score order. Each dot is still nearest its highest-scoring movie. Spread the magnets into a triangle or use Reset positions to compare all three distances."
      : "";
    if (status.textContent !== message) status.textContent = message;
    status.hidden = !approximate;
  }
  function animate(time) {
    frame = null;
    if (!svg.node().isConnected) return;
    const movement = stepDust(nodes, anchors, width, height, lastTime === null ? 1 / 60 : (time - lastTime) / 1000);
    lastTime = time;
    draw();
    quietFrames = movement < .015 ? quietFrames + 1 : 0;
    if (quietFrames < 24) frame = requestAnimationFrame(animate);
    else lastTime = null;
  }
  function wake() {
    quietFrames = 0;
    if (reducedMotion) {
      for (let tick = 0; tick < 480; tick++) stepDust(nodes, anchors, width, height);
      draw();
    } else if (frame === null) frame = requestAnimationFrame(animate);
  }
  stepDust(nodes, anchors, width, height, 0);
  draw();
  wake();
}

function highlightDustConnections(id) {
  if (!dustChart) return;
  const node = dustChart.positions.get(id);
  dustChart.paths.attr("visibility", node ? "visible" : "hidden")
    .attr("x1", (anchor) => anchor.x).attr("y1", (anchor) => anchor.y)
    .attr("x2", node?.x || 0).attr("y2", node?.y || 0);
}

function renderDustDetail() {
  const detail = document.querySelector("#recommendation-detail");
  const match = recommendationState.dustMatches?.find((item) => item.anime.id === recommendationState.animeId);
  const selection = document.querySelector("#dust-selection");
  selection.hidden = !match;
  detail.classList.remove("is-bottom");
  if (!match) {
    selection.innerHTML = "";
    detail.innerHTML = `<div class="dust-detail-placeholder"><p class="chart-kicker">Anime in focus</p><h3>Every dot has a story.</h3><p>Click any anime dot, or focus it and press Enter, to discover its storyline, genres, tags, and similarity to your movies.</p></div>`;
    return;
  }
  const anime = match.anime, movies = selectedMagnetMovies();
  selection.innerHTML = `<span>In focus · <strong>${escapeHTML(anime.title)}</strong></span>`;
  detail.innerHTML = `
    <p class="chart-kicker">Anime in focus</p><h3 tabindex="-1" aria-live="polite">${escapeHTML(anime.title)}</h3>
    <p class="recommendation-detail-meta">${escapeHTML(humanize(anime.format))} · ${anime.year || "Year unknown"}</p>
    <div class="dust-detail-scores">${movies.map((movie, index) => `
      <div style="--magnet-color:${MAGNET_COLORS[index]}"><span><i></i>${escapeHTML(movie.title)}</span><strong>${match.scores[index].toFixed(3)}</strong></div>`).join("")}
      <small>Cosine similarity · higher means closer</small>
    </div>
    <div class="genre-list">${anime.genres.map((genre) => `<span class="tag">${escapeHTML(genre)}</span>`).join("")}</div>
    <div class="dust-story"><h4>Storyline</h4><p>${escapeHTML(anime.synopsis || "No synopsis available for this anime.")}</p></div>
    <div class="recommendation-context"><h4>Story tags</h4><div class="genre-list">${anime.tags.slice(0, 8).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("") || "<small>No tags available.</small>"}</div>
      ${anime.tags.length > 8 ? `<details class="dust-more-tags"><summary>All ${anime.tags.length} tags</summary><div class="genre-list">${anime.tags.slice(8).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}</div></details>` : ""}
    </div>
    <a class="button button-secondary" href="${escapeAttribute(anime.url)}" target="_blank" rel="noopener noreferrer">Explore on AniList ↗</a>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getDustMatches, defaultMagnetPositions, dustAttraction, createDustNodes, stepDust, layoutDust, constrainMagnetPosition };
}
