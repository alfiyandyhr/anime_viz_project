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

function dustTargetDistance(score, scale) {
  return Math.sqrt(2 - 2 * Math.max(-1, Math.min(1, score))) * scale;
}

// Search the whole field instead of following a local force minimum. Each site
// is a possible dot position; reserving sites keeps spacing in the optimization,
// rather than pushing settled dots away from their similarity distances later.
const DUST_SPACING = 16;
const DUST_CLEARANCE = 48;

function dustSites(anchors, width, height) {
  const sites = [];
  const rowHeight = DUST_SPACING * Math.sqrt(3) / 2;
  for (let row = 0, y = 18; y <= height - 18; row++, y += rowHeight) {
    for (let x = 14 + (row % 2) * DUST_SPACING / 2; x <= width - 14; x += DUST_SPACING) {
      const distances = anchors.map((anchor) => Math.hypot(x - anchor.x, y - anchor.y));
      if (anchors.some((anchor, index) => distances[index] < DUST_CLEARANCE
        || (Math.abs(x - anchor.x) < Math.min(75, width * .19)
          && y > anchor.y + 27 && y < anchor.y + 66))) continue;
      sites.push({ x, y, distances });
    }
  }
  return sites;
}

// Penalize score-order reversals independently of distance error. Close scores
// may share a bisector; ties impose no arbitrary movie-order preference.
function dustOrderError(scores, distances) {
  let error = 0;
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      const gap = scores[i] - scores[j];
      if (Math.abs(gap) > 1e-7 && gap * (distances[i] - distances[j]) > 1e-7) {
        error += 1 + Math.abs(distances[i] - distances[j]);
      }
    }
  }
  return error;
}

function layoutDust(matches, anchors, width, height) {
  if (!matches.length || !anchors.length) return [];
  const scale = Math.min(width, height) * .38;
  const sites = dustSites(anchors, width, height);
  // A very small/degenerate viewport is still handled without NaN coordinates.
  if (!sites.length) return matches.map((match) => ({ ...match, x: width / 2, y: 18, approximate: true }));
  const targets = matches.map((match) => match.scores.map((score) =>
    Math.max(DUST_CLEARANCE, dustTargetDistance(score, scale))));
  const orderWeight = (width * width + height * height) * anchors.length;
  const costs = matches.map((match, index) => Float64Array.from(sites, (site) => {
    const stress = site.distances.reduce((sum, distance, magnet) =>
      sum + (distance - targets[index][magnet]) ** 2, 0);
    return stress + dustOrderError(match.scores, site.distances) * orderWeight;
  }));
  const assigned = new Int32Array(matches.length).fill(-1);
  const occupied = new Int32Array(sites.length).fill(-1);
  // Give the most distinctive matches first choice, with stable record-order ties.
  const order = matches.map((_, index) => index).sort((a, b) =>
    Math.max(...matches[b].scores) - Math.max(...matches[a].scores) || matches[a].index - matches[b].index);
  for (const index of order) {
    let best = -1;
    for (let site = 0; site < sites.length; site++) {
      if (occupied[site] < 0 && (best < 0 || costs[index][site] < costs[index][best])) best = site;
    }
    if (best < 0) best = costs[index].indexOf(Math.min(...costs[index]));
    assigned[index] = best;
    occupied[best] = index;
  }
  // Refine the assignment jointly: a dot may move to a free site or swap with
  // another dot, but only when the combined similarity error improves. Every
  // step retains the collision spacing and score-order penalty.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const index of order) {
      const current = assigned[index];
      let best = current, improvement = 1e-6;
      for (let site = 0; site < sites.length; site++) {
        const other = occupied[site];
        const gain = costs[index][current] - costs[index][site]
          + (other < 0 ? 0 : costs[other][site] - costs[other][current]);
        if (gain > improvement) { best = site; improvement = gain; }
      }
      if (best === current) continue;
      const other = occupied[best];
      if (other >= 0) assigned[other] = current;
      occupied[current] = other;
      occupied[best] = index;
      assigned[index] = best;
      changed = true;
    }
    if (!changed) break;
  }
  return matches.map((match, index) => {
    const site = sites[assigned[index]];
    return { ...match, x: site.x, y: site.y,
      approximate: dustOrderError(match.scores, site.distances) > 0 };
  });
}

// Keep magnets distinct, including pointer/keyboard moves and restored positions.
// A crowded set of anchors can make their score orders impossible to display.
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
  document.querySelector("#dust-selection").addEventListener("click", () => {
    const heading = document.querySelector("#recommendation-detail h3");
    heading?.focus({ preventScroll: true });
    document.querySelector("#recommendation-detail").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
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
    renderRecommendations();
  });
}

function renderDustRecommendations() {
  const movies = selectedMagnetMovies();
  const data = recommendationState.data;
  const container = document.querySelector("#recommendation-chart");
  dustChart = null;
  document.querySelector("#recommendation-content").hidden = false;
  document.querySelector("#recommendation-chart-kicker").textContent = "A constellation of your taste";
  document.querySelector("#recommendation-chart-title").textContent = movies.length > 1
    ? "Find the stories between your favorites." : "Follow the pull of a familiar story.";
  document.querySelector("#recommendation-chart-guide").textContent = "Dots seek shorter distances to higher-scoring movies. Hover a dot for exact scores; click it to explore. Drag magnets to rearrange, or focus one and use arrow keys.";
  document.querySelector("#recommendation-score-note").textContent = "Distances approximate similarity on a shared scale; spacing, chart edges, and competing magnets can distort them. Small distance differences may not reflect score order. Color = highest-scoring movie; pink = selected anime. Anime-to-anime distances have no meaning. Hover or focus for exact cosine scores.";
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
  if (!matches.some((match) => match.anime.id === recommendationState.animeId)) recommendationState.animeId = matches[0]?.anime.id;
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
  const rings = svg.append("g").attr("class", "dust-rings").attr("aria-hidden", "true");
  if (movies.length === 1) {
    rings.selectAll("circle").data([.8, .6, .4]).join("circle")
      .attr("r", (score) => dustTargetDistance(score, Math.min(width, height) * .38));
  }
  const paths = svg.append("g").attr("aria-hidden", "true").selectAll("line").data(anchors).join("line")
    .attr("class", "dust-selected-link").attr("stroke", (anchor) => anchor.color);
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
      highlightRecommendation(match.anime.id);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave blur", () => { hideTooltip(); highlightRecommendation(); })
    .on("click", (event, match) => { hideTooltip(); selectRecommendationAnime(match.anime.id); })
    .on("keydown", (event, match) => {
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); hideTooltip(); selectRecommendationAnime(match.anime.id); }
      if (event.key === "Escape") { hideTooltip(); highlightRecommendation(); }
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
      .on("drag", (event, anchor) => moveAnchor(anchor, event.x, event.y))
      .on("end", () => {
        cancelAnimationFrame(frame); frame = null;
        if (svg.node().isConnected) draw();
      }));
  magnets.append("circle").attr("class", "magnet-halo").attr("r", 34).attr("stroke", (anchor) => anchor.color);
  magnets.append("circle").attr("class", "magnet-core").attr("r", 25).attr("stroke", (anchor) => anchor.color);
  magnets.append("text").attr("class", "magnet-number").attr("text-anchor", "middle").attr("dy", 5)
    .attr("fill", (anchor) => anchor.color).text((_, index) => `M${index + 1}`);
  magnets.append("text").attr("class", "magnet-title").attr("text-anchor", "middle").attr("y", 49)
    .text((anchor) => truncate(anchor.movie.title, width < 400 ? 16 : 23));
  magnets.append("title").text((anchor) => `${anchor.movie.title} (${anchor.movie.year || "Year unknown"})`);

  let frame = null;
  function moveAnchor(anchor, x, y) {
    Object.assign(anchor, constrainMagnetPosition(anchor, x, y, anchors, width, height));
    recommendationState.magnetPositions[`${movies.length}:${anchor.movie.id}`] = { x: anchor.x / width, y: anchor.y / height };
    // Coalesce rapid pointer events, always laying out the latest anchor position.
    if (frame === null) frame = requestAnimationFrame(() => {
      frame = null;
      if (svg.node().isConnected) draw();
    });
  }
  function draw() {
    const nodes = layoutDust(matches, anchors, width, height);
    const positions = new Map(nodes.map((node) => [node.anime.id, node]));
    const status = document.querySelector("#dust-layout-status");
    const approximate = nodes.some((node) => node.approximate);
    const message = approximate
      ? "Some movie score orders do not fit this layout. Compare exact scores on hover or focus, or spread the magnets apart and try Reset positions."
      : "";
    if (status.textContent !== message) status.textContent = message;
    status.hidden = !approximate;
    dots.attr("transform", (match) => { const node = positions.get(match.anime.id); return `translate(${node.x},${node.y})`; });
    magnets.attr("transform", (anchor) => `translate(${anchor.x},${anchor.y})`);
    rings.attr("transform", `translate(${anchors[0].x},${anchors[0].y})`);
    dustChart = { paths, positions, anchors };
    highlightDustConnections(recommendationState.animeId);
  }
  draw();
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
  detail.classList.remove("is-bottom");
  if (!match) {
    detail.innerHTML = `<div class="dust-detail-placeholder"><p class="chart-kicker">Your next discovery</p><h3>Every dot has a story.</h3><p>Select an anime to see its storyline, genres, tags, and similarity to your movies.</p></div>`;
    return;
  }
  const anime = match.anime, movies = selectedMagnetMovies();
  const selection = document.querySelector("#dust-selection");
  selection.hidden = false;
  selection.innerHTML = `<span>In focus · <strong>${escapeHTML(anime.title)}</strong></span><span>Read story ↓</span>`;
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
  module.exports = { getDustMatches, defaultMagnetPositions, dustTargetDistance, layoutDust, constrainMagnetPosition };
}
