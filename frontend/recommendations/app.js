"use strict";

const recommendationState = {
  data: null, loading: false, error: null, movieId: null,
  animeId: null, limit: 5,
  viz: typeof document !== "undefined" && document.body?.dataset.chapter === "dust-magnet" ? "magnets" : "connections",
  movieIds: [], dustLimit: 60,
  scores: null, scoresLoading: false, scoresError: null, magnetPositions: {},
  ranking: [], tablePage: 0, cohortSelected: false
};

function normalizeMovieSearch(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function searchRecommendationMovies(movies, query) {
  const normalized = normalizeMovieSearch(query);
  if (!normalized) return [];
  const terms = normalized.split(/\s+/);
  return movies.map((movie, index) => {
    const names = [movie.title, ...(movie.aliases || [])].map(normalizeMovieSearch);
    const year = String(movie.year || "");
    const matches = names.some((name) => terms.every((term) => `${name} ${year}`.includes(term)));
    const priority = names.includes(normalized) ? 0 : names.some((name) => name.startsWith(normalized)) ? 1 : 2;
    return { movie, index, matches, priority };
  }).filter((item) => item.matches)
    .sort((a, b) => a.priority - b.priority || a.index - b.index).map((item) => item.movie);
}

function getRecommendationMatches(data, movie, limit) {
  const count = [5, 10].includes(Number(limit)) ? Number(limit) : 5;
  if (!data || !movie) return [];
  const top = movie.matches.slice(0, count).map(([index, score], rank) => ({
    anime: data.anime[index], score, rank: rank + 1, group: "top"
  }));
  const bottom = movie.bottom_matches.slice(0, count).reverse().map(([index, score], rank) => ({
    anime: data.anime[index], score, rank: data.anime.length - count + rank + 1, group: "bottom"
  }));
  return [...top, ...bottom];
}

// Rank every anime using the same complete matrix as the dust view.
function getRecommendationRanking(data, scores, movie) {
  if (!data || !scores || !movie) return [];
  const movieIndex = data.movies.indexOf(movie);
  if (movieIndex < 0) return [];
  return data.anime.map((anime, index) => ({
    anime, index, score: scores[movieIndex * data.anime.length + index]
  })).sort((a, b) => b.score - a.score || a.index - b.index)
    .map((match, index) => ({ ...match, rank: index + 1 }));
}

const RECOMMENDATION_PAGE_SIZE = 10;
const recommendationDataUrl = typeof document === "undefined" ? null
  : new URL("../../data/movie_recommendations.json", document.currentScript.src);

function bindRecommendationControls() {
  bindDustControls();
  document.querySelector("#explore-matches")?.addEventListener("click", continueRecommendationJourney);
  document.querySelector("#journey-overview")?.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-journey-destination]");
    if (link) continueRecommendationJourney({
      preventDefault: () => event.preventDefault(), currentTarget: link
    });
  });
  const search = document.querySelector("#movie-search");
  search.addEventListener("input", renderMovieSearchResults);
  search.addEventListener("keydown", (event) => {
    const first = document.querySelector("#movie-search-results button");
    if (first && ["ArrowDown", "Enter"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Enter") first.click();
      else first.focus();
    }
    if (event.key === "Escape") document.querySelector("#movie-search-results").hidden = true;
  });
  document.querySelector("#recommendation-limit").addEventListener("change", (event) => {
    recommendationState.limit = Number(event.target.value);
    renderRecommendations();
  });
  for (const id of ["#movie-search-results", "#movie-suggestions"]) {
    document.querySelector(id).addEventListener("click", (event) => {
      const button = event.target.closest("[data-movie-id]");
      if (button) selectRecommendationMovie(button.dataset.movieId);
    });
  }
  document.querySelector("#recommendation-table-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-recommendation-id]");
    if (button) selectRecommendationAnime(button.dataset.recommendationId);
    if (event.target.closest("[data-retry-scores]")) {
      recommendationState.scoresError = null;
      void loadRecommendationScores();
      renderRecommendationTable();
    }
  });
  document.querySelector("#recommendation-table-pagination").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-page]");
    if (!button || button.disabled) return;
    recommendationState.tablePage = Number(button.dataset.page);
    renderRecommendationTable();
    highlightRecommendation();
    // Keep keyboard focus on the same action after replacing the controls.
    const selector = button.dataset.direction
      ? `[data-direction="${button.dataset.direction}"]`
      : `[data-page="${recommendationState.tablePage}"].is-active`;
    document.querySelector(`#recommendation-table-pagination ${selector}`)?.focus({ preventScroll: true });
  });
  document.querySelector("#recommendation-retry").addEventListener("click", () => {
    recommendationState.error = null;
    renderRecommendations();
  });
}

async function loadRecommendations() {
  if (recommendationState.loading || recommendationState.data) return;
  recommendationState.loading = true;
  setStatus("Loading movie–anime similarities…", "loading");
  const status = document.querySelector("#recommendation-status");
  status.textContent = "Loading movie–anime similarities…";
  document.querySelector("#recommendation-retry").hidden = true;
  try {
    const response = await fetch(recommendationDataUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.schema_version !== 2 || !data.movies?.length || !data.anime?.length
      || !data.movies.every((movie) => [movie.matches, movie.bottom_matches].every((matches) =>
        Array.isArray(matches) && matches.length >= 20
        && matches.every(([index, score]) => Number.isInteger(index) && data.anime[index]
          && Number.isFinite(score) && score >= -1 && score <= 1)))) {
      throw new Error("Invalid recommendation dataset");
    }
    recommendationState.data = data;
    setStatus(`Loaded ${numberFormatter.format(data.movies.length)} movies × ${numberFormatter.format(data.anime.length)} anime`, "success");
    document.querySelector("#footer-generated").textContent = `Generated ${formatDate(data.meta.generated_at)}`;
    document.querySelector("#footer-cache").textContent = "Data mode: published similarity snapshot";
    document.querySelector("#movie-search").disabled = false;
    const saved = readMovieCohort();
    const restored = data.movies.find((movie) => String(movie.id) === String(saved?.seed.tmdbId));
    const initial = restored || data.movies.find((movie) => movie.title === "Inception") || data.movies[0];
    recommendationState.cohortSelected = Boolean(restored);
    recommendationState.movieId = initial.id;
    recommendationState.movieIds = [initial.id];
    document.querySelector("#movie-suggestions").innerHTML = `<span>Try a favorite</span>` +
      ["Inception", "Interstellar", "The Matrix", "The Dark Knight", "Titanic"]
        .map((title) => data.movies.find((movie) => movie.title === title)).filter(Boolean)
        .map((movie) => `<button type="button" data-movie-id="${escapeAttribute(movie.id)}">${escapeHTML(movie.title)}</button>`).join("");
    document.querySelector("#recommendation-method-data").textContent =
      `${numberFormatter.format(data.meta.anime_count)} AniList anime × ${numberFormatter.format(data.meta.movie_count)} TMDB movies: ${numberFormatter.format(data.meta.pair_count)} pairs. ${recommendationState.viz === "magnets" ? "Combine up to three movies using the complete score matrix. Dots combine strong matches to each movie and shared favorites." : `Compare the top and bottom 5 or 10 for one movie in the connection map. Browse the full ranking below the map, 10 anime per page. Ranks span all ${numberFormatter.format(data.anime.length)} anime, with score ties resolved by anime record order. Bottom matches show contrasting stories.`} Computed ${formatDate(data.meta.generated_at)}.`;
    document.querySelector("#recommendation-method-model").textContent =
      `${data.meta.model} embeds titles, genres, tags, and synopses. Cosine similarity compares normalized vectors; ratings and popularity do not affect the score.`;
  } catch (error) {
    recommendationState.error = error.message;
    setStatus("Recommendation data could not be loaded.", "error");
    status.textContent = `Could not load recommendations (${error.message}). Retry to load the movie sample.`;
    document.querySelector("#recommendation-retry").hidden = false;
  } finally {
    recommendationState.loading = false;
    if (recommendationState.data) renderRecommendations();
  }
}

async function loadRecommendationScores() {
  if (recommendationState.scoresLoading || recommendationState.scores) return;
  recommendationState.scoresLoading = true;
  recommendationState.scoresError = null;
  try {
    const data = recommendationState.data;
    const meta = data.meta.score_matrix;
    if (!meta || meta.dtype !== "float32-le" || meta.layout !== "movie-major"
      || meta.rows !== data.movies.length || meta.columns !== data.anime.length) {
      throw new Error("Re-export the recommendation data to include full scores.");
    }
    const response = await fetch(new URL(meta.file, recommendationDataUrl));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== meta.rows * meta.columns * 4) throw new Error("Incomplete similarity matrix.");
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== meta.sha256) throw new Error("Similarity matrix does not match the movie data.");
    }
    const view = new DataView(buffer);
    const scores = new Float32Array(meta.rows * meta.columns);
    for (let i = 0; i < scores.length; i++) {
      scores[i] = view.getFloat32(i * 4, true);
      if (!Number.isFinite(scores[i]) || scores[i] < -1 || scores[i] > 1) throw new Error("Invalid similarity score.");
    }
    recommendationState.scores = scores;
  } catch (error) {
    recommendationState.scoresError = error.message;
  } finally {
    recommendationState.scoresLoading = false;
    renderRecommendations();
  }
}

function renderMovieSearchResults() {
  const data = recommendationState.data;
  if (!data) return;
  const query = document.querySelector("#movie-search").value;
  const container = document.querySelector("#movie-search-results");
  if (!normalizeMovieSearch(query)) {
    container.hidden = true;
    document.querySelector("#recommendation-status").textContent = `Search ${numberFormatter.format(data.movies.length)} movies, or choose a favorite below.`;
    return;
  }
  const matches = searchRecommendationMovies(data.movies, query);
  container.hidden = false;
  container.innerHTML = matches.length ? matches.slice(0, 30).map((movie) => `
    <button type="button" data-movie-id="${escapeAttribute(movie.id)}">
      <strong>${escapeHTML(movie.title)}</strong><span>${movie.year || "Year unknown"} · ${escapeHTML(movie.genres.join(" / ") || "Genres unavailable")}</span>
    </button>`).join("") : `<p>No movies match “${escapeHTML(query)}” in this 1,000-movie sample. Try another title.</p>`;
  document.querySelector("#recommendation-status").textContent = matches.length
    ? `${matches.length} movies found.${matches.length > 30 ? " Showing the first 30; refine your search." : " Choose one to update your matches."}`
    : "No search results. Your current movie and recommendations remain below.";
}

function selectRecommendationMovie(id) {
  if (!recommendationState.data.movies.some((movie) => movie.id === id)) return;
  if (recommendationState.viz === "magnets") {
    if (recommendationState.movieIds.includes(id)) {
      document.querySelector("#recommendation-status").textContent = "That movie is already a magnet. Add a different favorite.";
      return;
    }
    if (recommendationState.movieIds.length >= 3) {
      document.querySelector("#recommendation-status").textContent = "Three magnets are in place. Remove one to try another movie.";
      return;
    }
    recommendationState.movieIds.push(id);
  } else {
    recommendationState.movieIds = [id];
  }
  recommendationState.movieId = id;
  recommendationState.cohortSelected = true;
  recommendationState.tablePage = 0;
  recommendationState.animeId = null;
  document.querySelector("#movie-search").value = "";
  document.querySelector("#movie-search-results").hidden = true;
  renderRecommendations(true);
}

function selectedRecommendationMovie() {
  return recommendationState.data?.movies.find((movie) => movie.id === recommendationState.movieId);
}

function saveRecommendationCohort(activateMatches = false) {
  if (recommendationState.viz === "magnets" || !recommendationState.cohortSelected) return false;
  const movie = selectedRecommendationMovie();
  if (!movie) return false;
  const data = recommendationState.data;
  // The published Top 20 defines the carried set independently of map cutoffs
  // and matrix loading, including its original ranks and scores.
  const matches = movie.matches.slice(0, 20).map(([index, score], indexInRanking) => ({
    anime: data.anime[index], score, rank: indexInRanking + 1
  }));
  try {
    const previous = readMovieCohort();
    migrateScopeFilters(previous);
    const changed = String(previous?.seed.tmdbId) !== String(movie.id);
    if (changed) {
      sessionStorage.removeItem(FILTER_STORAGE_KEY);
    }
    sessionStorage.setItem(SEED_MOVIE_STORAGE_KEY, JSON.stringify({
      tmdbId: movie.id, title: movie.title, year: movie.year
    }));
    sessionStorage.setItem(COHORT_IDS_STORAGE_KEY, JSON.stringify(matches.map((match) => String(match.anime.id))));
    sessionStorage.setItem(COHORT_RANKING_STORAGE_KEY, JSON.stringify({
      tmdbId: movie.id, total: data.anime.length,
      matches: matches.map((match) => ({ id: String(match.anime.id), rank: match.rank, score: match.score }))
    }));
    if (activateMatches || changed) sessionStorage.setItem(COHORT_SCOPE_STORAGE_KEY, "cohort");
    const saved = readMovieCohort();
    if (saved && (activateMatches || changed)) {
      state.cohort = saved;
      state.browseMode = saved.enabled ? "matches" : "catalogue";
      state.cohort_ids = saved.enabled ? new Set(saved.ids) : null;
      renderScopePageCopy();
    }
    return String(saved?.seed.tmdbId) === String(movie.id)
      && saved.ids.length === matches.length
      && matches.every((match, index) => saved.ids[index] === String(match.anime.id))
      && (!activateMatches || saved.enabled);
  } catch (error) {
    return false;
  }
}

function continueRecommendationJourney(event) {
  event.preventDefault();
  if (recommendationState.viz === "magnets" || !selectedRecommendationMovie()) return;
  recommendationState.cohortSelected = true;
  const saved = saveRecommendationCohort(true);
  renderRecommendationJourney(saved);
  if (saved) window.location.assign(event.currentTarget.href);
}

function renderRecommendationJourney(saved) {
  const journey = document.querySelector("#recommendation-journey");
  if (!journey) return; // The shared script also serves Dust & Magnet.
  journey.hidden = false;
  const chosen = recommendationState.cohortSelected;
  document.querySelector("#selected-movie-label").textContent = chosen ? "Your movie" : "Example movie · not yet chosen";
  document.querySelector("#recommendation-journey-summary").textContent = !chosen
    ? "Previewing an example. Choose a movie above, or use “Explore these 20 matches” to choose this example. Its Top 20 anime matches will follow you through Tasks 2–4 and Explorer."
    : saved
      ? "Its Top 20 anime matches will follow you through Tasks 2–4 and Explorer. Continue to Task 2 to explore their stories and release years."
      : "Your movie’s matches are available here, but browser session storage could not save them for the next task. Enable session storage and try “Explore these 20 matches” again to continue.";
}

function renderRecommendations(activateMatches = false) {
  stopDustChart();
  const data = recommendationState.data;
  if (!data) {
    if (!recommendationState.error) void loadRecommendations();
    return;
  }
  const magnets = recommendationState.viz === "magnets";
  const contextSaved = saveRecommendationCohort(activateMatches);
  document.querySelector("#movie-magnets").hidden = !magnets;
  document.querySelector("#dust-limit-control").hidden = !magnets;
  document.querySelector("#recommendation-limit-control").hidden = magnets;
  document.querySelector("#dust-toolbar").hidden = !magnets;
  document.querySelector("#dust-layout-status").hidden = true;
  document.querySelector("#dust-selection").hidden = true;
  document.querySelector("#recommendation-table-heading").hidden = magnets;
  document.querySelector("#recommendation-table-wrapper").hidden = magnets;
  document.querySelector("#recommendation-table-pagination").hidden = magnets;
  document.querySelector("#movie-search-label").textContent = magnets ? "Add a movie magnet · up to 3" : "Find a movie in the sample";
  document.querySelector("#selected-movie").hidden = magnets;
  hideTooltip();
  if (magnets) { renderDustRecommendations(); return; }
  const movie = selectedRecommendationMovie();
  const matches = getRecommendationMatches(data, movie, recommendationState.limit);
  const count = matches.length / 2;
  recommendationState.ranking = getRecommendationRanking(data, recommendationState.scores, movie);
  if (!(recommendationState.ranking.length ? recommendationState.ranking : matches)
    .some((match) => match.anime.id === recommendationState.animeId)) {
    recommendationState.animeId = matches[0]?.anime.id || null;
  }
  document.querySelector("#recommendation-content").hidden = false;
  const card = document.querySelector("#selected-movie");
  card.hidden = false;
  card.innerHTML = `
    <div><p id="selected-movie-label" class="chart-kicker"></p><h3>${escapeHTML(movie.title)} <span>${movie.year ? `(${escapeHTML(movie.year)})` : "Year unknown"}</span></h3>
    <p class="movie-match-count">Top ${movie.matches.slice(0, 20).length} anime matches</p>
    <div class="genre-list">${movie.genres.map((genre) => `<span class="tag">${escapeHTML(genre)}</span>`).join("")}</div>
    <p class="movie-synopsis">${escapeHTML(movie.synopsis || "No synopsis available for this movie.")}</p></div>
    <a class="small-button ghost" href="${escapeAttribute(movie.url)}" target="_blank" rel="noopener noreferrer">Movie on TMDB ↗</a>`;
  renderRecommendationJourney(contextSaved);
  document.querySelectorAll("#movie-suggestions button").forEach((button) => {
    button.setAttribute("aria-pressed", recommendationState.cohortSelected && button.dataset.movieId === movie.id);
    button.disabled = false;
  });
  document.querySelector("#recommendation-chart-kicker").textContent = "Compare similarities & differences";
  document.querySelector("#recommendation-score-note").textContent = "Cosine similarity · higher means closer in the model’s text embedding space. A score of 0.8 does not mean an 80% match.";
  document.querySelector("#recommendation-chart-title").textContent = "Which stories are similar—and which differ?";
  document.querySelector("#recommendation-table-title").textContent = "Full anime ranking";
  document.querySelector("#recommendation-chart-guide").textContent =
    "Each line connects your movie to an anime. Thicker lines = higher similarity. Select a match to explore it."
    + " Cyan = top matches; gold = bottom matches. Pink marks your selection.";
  if (!document.querySelector("#movie-search").value) {
    document.querySelector("#recommendation-status").textContent = `${recommendationState.cohortSelected ? "Your movie" : "Example preview"}: “${movie.title}”. Comparing with ${numberFormatter.format(data.anime.length)} anime. The map shows the top ${count} and bottom ${count}; the carried set is always the Top 20.`;
  }
  renderRecommendationTable();
  renderRecommendationChart(movie, matches);
  renderRecommendationDetail();
  highlightRecommendation();
}

function renderRecommendationTable() {
  const movie = selectedRecommendationMovie();
  const ranking = recommendationState.ranking;
  const body = document.querySelector("#recommendation-table-body");
  const pagination = document.querySelector("#recommendation-table-pagination");
  const note = document.querySelector("#recommendation-table-note");
  document.querySelector("#recommendation-table-caption").textContent =
    `All anime ranked by semantic similarity to ${movie.title}, highest similarity first`;
  if (!recommendationState.scores) {
    note.textContent = "";
    pagination.innerHTML = "";
    body.innerHTML = `<tr><td colspan="6">${recommendationState.scoresError
      ? `Could not load the full ranking: ${escapeHTML(recommendationState.scoresError)} <button type="button" class="small-button ghost" data-retry-scores>Retry full ranking</button>`
      : "Loading the full ranking…"}</td></tr>`;
    if (!recommendationState.scoresError && !recommendationState.scoresLoading) void loadRecommendationScores();
    return;
  }
  const totalPages = Math.max(1, Math.ceil(ranking.length / RECOMMENDATION_PAGE_SIZE));
  const current = Math.max(0, Math.min(recommendationState.tablePage, totalPages - 1));
  recommendationState.tablePage = current;
  const start = current * RECOMMENDATION_PAGE_SIZE;
  const displayed = ranking.slice(start, start + RECOMMENDATION_PAGE_SIZE);
  note.textContent = `Showing ${start + 1}–${start + displayed.length} of ${numberFormatter.format(ranking.length)} anime · highest similarity first`;
  body.innerHTML = displayed.map((match) => `
    <tr data-match-id="${escapeAttribute(match.anime.id)}" class="${match.rank > ranking.length - recommendationState.limit ? "is-bottom" : ""}">
      <td class="recommendation-rank">${match.rank}</td>
      <td><button type="button" class="recommendation-title-button" data-recommendation-id="${escapeAttribute(match.anime.id)}" aria-controls="recommendation-detail">${escapeHTML(match.anime.title)}</button></td>
      <td class="recommendation-score">${match.score.toFixed(3)}</td>
      <td>${escapeHTML(humanize(match.anime.format))}</td><td>${match.anime.year || "—"}</td>
      <td>${escapeHTML(match.anime.genres.join(", "))}</td>
    </tr>`).join("");
  // Match Explorer: first/last pages, two neighbors, and Previous/Next arrows.
  const items = [];
  let previous = -1;
  for (let page = 0; page < totalPages; page++) {
    if (page !== 0 && page !== totalPages - 1 && Math.abs(page - current) > 2) continue;
    if (page - previous > 1) items.push(`<span class="page-ellipsis">…</span>`);
    items.push(`<button type="button" class="page-btn${page === current ? " is-active" : ""}" data-page="${page}" aria-label="Page ${page + 1}"${page === current ? ' aria-current="page"' : ""}>${page + 1}</button>`);
    previous = page;
  }
  pagination.innerHTML = totalPages <= 1 ? "" : [
    `<button type="button" class="page-btn" data-page="${current - 1}" data-direction="previous" aria-label="Previous page"${current === 0 ? " disabled" : ""}>‹</button>`,
    ...items,
    `<button type="button" class="page-btn" data-page="${current + 1}" data-direction="next" aria-label="Next page"${current === totalPages - 1 ? " disabled" : ""}>›</button>`
  ].join("");
}

function renderRecommendationChart(movie, matches) {
  const container = document.querySelector("#recommendation-chart");
  container.innerHTML = "";
  const width = Math.max(640, container.clientWidth);
  const count = matches.length / 2;
  const spacing = 42;
  const height = 105 + matches.length * spacing + 72;
  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width).attr("height", height).attr("role", "group")
    .attr("aria-label", `Connections for ${movie.title}`);
  const y = (index) => 72 + index * spacing + (index >= count ? 72 : 0);
  svg.append("text").attr("x", 18).attr("y", 20).attr("class", "connection-axis-label").text("YOUR MOVIE");
  svg.append("text").attr("x", width * 0.43).attr("y", 20).attr("class", "connection-axis-label")
    .text("ANIME · GLOBAL RANK");
  const center = height / 2;
  svg.append("rect").attr("x", 12).attr("y", center - 40).attr("width", width * 0.28)
    .attr("height", 80).attr("rx", 14).attr("class", "connection-movie-node");
  const title = svg.append("text").attr("x", 26).attr("y", center - 6).attr("class", "connection-movie-title");
  title.append("tspan").text(truncate(movie.title, 22));
  title.append("tspan").attr("x", 26).attr("dy", 23).attr("class", "connection-movie-year").text(movie.year || "Movie");
  const groupX = width * 0.43 + 15;
  svg.append("text").attr("x", groupX).attr("y", 44).attr("class", "recommendation-group-label")
    .text(`TOP ${count} · MOST SIMILAR`);
  svg.append("text").attr("x", groupX).attr("y", y(count) - 25).attr("class", "recommendation-group-label is-bottom")
    .text(`BOTTOM ${count} · LEAST SIMILAR`);
  svg.append("text").attr("x", groupX).attr("y", y(count - 1) + spacing / 2 + 24)
    .attr("class", "recommendation-gap-label")
    .text(`⋮ Ranks ${count + 1}–${recommendationState.data.anime.length - count} omitted`);
  const rows = svg.selectAll(".recommendation-chart-row").data(matches).join("g")
    .attr("class", (match) => `recommendation-chart-row${match.group === "bottom" ? " is-bottom" : ""}`).attr("data-match-id", (match) => match.anime.id)
    .attr("role", "button").attr("tabindex", 0).attr("aria-controls", "recommendation-detail")
    .attr("aria-label", (match) => `${match.group === "bottom" ? "Bottom match" : "Top match"}, rank ${match.rank}: ${match.anime.title}, similarity ${match.score.toFixed(3)}. Select for details.`)
    .on("click", (event, match) => selectRecommendationAnime(match.anime.id))
    .on("keydown", (event, match) => {
      if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        selectRecommendationAnime(match.anime.id);
      }
    })
    .on("mouseenter", (event, match) => highlightRecommendation(match.anime.id))
    .on("mouseleave", () => highlightRecommendation())
    .on("focus", (event, match) => highlightRecommendation(match.anime.id))
    .on("blur", () => highlightRecommendation());
  rows.append("title").text((match) => `${match.anime.title} · cosine ${match.score.toFixed(3)}`);
  rows.append("rect").attr("x", width * 0.42)
    .attr("y", (match, index) => y(index) - 18).attr("width", width * 0.57 - 4)
    .attr("height", 36).attr("rx", 7).attr("class", "recommendation-row-background");
  rows.append("path").attr("class", "recommendation-mark connection-line")
    .attr("d", (match, index) => {
      const start = width * 0.28 + 12, end = width * 0.43, center = height / 2;
      return `M${start},${center} C${start + 55},${center} ${end - 45},${y(index)} ${end},${y(index)}`;
    }).attr("stroke-width", (match) => 1 + 10 * Math.max(0, match.score));
  rows.append("circle").attr("cx", width * 0.43).attr("cy", (match, index) => y(index))
    .attr("r", 4).attr("class", "recommendation-dot");
  rows.append("text").attr("x", width * 0.43 + 15)
    .attr("y", (match, index) => y(index) + 4).attr("class", "recommendation-chart-label")
    .text((match) => `${match.rank} · ${truncate(match.anime.title, Math.floor((width * 0.57 - 108) / 7))}`);
  rows.append("text").attr("x", width - 13).attr("y", (match, index) => y(index) + 4)
    .attr("text-anchor", "end").attr("class", "recommendation-chart-score").text((match) => match.score.toFixed(3));
}

function selectRecommendationAnime(id) {
  recommendationState.animeId = id;
  renderRecommendationDetail();
  highlightRecommendation();
}

function highlightRecommendation(previewId) {
  const selectedId = recommendationState.animeId;
  if (recommendationState.viz === "magnets") previewId = null;
  document.querySelectorAll("[data-match-id]").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.matchId === selectedId);
    row.classList.toggle("is-preview", row.dataset.matchId === previewId);
    if (row.getAttribute("role") === "button") row.setAttribute("aria-pressed", row.dataset.matchId === selectedId);
    row.querySelector("button")?.setAttribute("aria-pressed", row.dataset.matchId === selectedId);
  });
  if (recommendationState.viz === "magnets") highlightDustConnections(selectedId);
}

function renderRecommendationDetail() {
  if (recommendationState.viz === "magnets") { renderDustDetail(); return; }
  const movie = selectedRecommendationMovie();
  const match = (recommendationState.ranking.length ? recommendationState.ranking
    : getRecommendationMatches(recommendationState.data, movie, recommendationState.limit))
    .find((item) => item.anime.id === recommendationState.animeId);
  const detail = document.querySelector("#recommendation-detail");
  if (!match) { detail.innerHTML = ""; return; }
  const anime = match.anime;
  const bottom = match.rank > recommendationState.data.anime.length - recommendationState.limit;
  const context = bottom ? "Contrasting story" : match.rank <= recommendationState.limit ? "Similar story" : "Story similarity";
  detail.classList.toggle("is-bottom", bottom);
  const movieGenres = new Set(movie.genres.map(normalizeMovieSearch));
  const shared = anime.genres.filter((genre) => movieGenres.has(normalizeMovieSearch(genre)));
  detail.innerHTML = `
    <p class="chart-kicker">${context} · rank ${match.rank} of ${recommendationState.data.anime.length}</p>
    <h3>${escapeHTML(anime.title)}</h3>
    <p class="recommendation-detail-meta">${escapeHTML(humanize(anime.format))} · ${anime.year || "Year unknown"}</p>
    <div class="recommendation-detail-score"><strong>${match.score.toFixed(3)}</strong><span>cosine similarity</span></div>
    <div class="genre-list">${anime.genres.map((genre) => `<span class="tag">${escapeHTML(genre)}</span>`).join("")}</div>
    <p>${escapeHTML(anime.synopsis || "No synopsis available for this anime.")}</p>
    <div class="recommendation-context"><h4>Story context</h4>
      <p>${shared.length ? `Shared genre labels: ${escapeHTML(shared.join(", "))}.` : "No exact shared genre labels; semantic similarity can connect different genre vocabularies."}</p>
      <div class="genre-list">${anime.tags.slice(0, 6).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}</div>
      <small>These labels describe the anime; they do not explain how the model arrived at the score.</small>
    </div>
    <a class="button button-secondary" href="${escapeAttribute(anime.url)}" target="_blank" rel="noopener noreferrer">Explore this anime on AniList ↗</a>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeMovieSearch, searchRecommendationMovies, getRecommendationMatches, getRecommendationRanking };
}

// Recommendations use their own published dataset, independently of dashboard filters.
if (typeof document !== "undefined") {
  registerPage({
    usesDashboard: false,
    bindControls: bindRecommendationControls,
    render: renderRecommendations
  });
}
