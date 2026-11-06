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

function bindRecommendationControls() {
  bindDustControls();
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
  for (const id of ["#movie-search-results", "#movie-suggestions"]) {
    document.querySelector(id).addEventListener("click", (event) => {
      const button = event.target.closest("[data-movie-id]");
      if (button) selectRecommendationMovie(button.dataset.movieId);
    });
  }
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
    const data = await AnivizData.recommendations();
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
    const initial = data.movies.find(movie => movie.title === "Inception") || data.movies[0];
    recommendationState.movieId = initial.id;
    recommendationState.movieIds = [initial.id];
    if (recommendationState.viz === "magnets") globalThis.AnivizMain?.initialize(data);
    document.querySelector("#movie-suggestions").innerHTML = `<span>Try a favorite</span>` +
      ["Inception", "Interstellar", "The Matrix", "The Dark Knight", "Titanic"]
        .map((title) => data.movies.find((movie) => movie.title === title)).filter(Boolean)
        .map((movie) => `<button type="button" data-movie-id="${escapeAttribute(movie.id)}">${escapeHTML(movie.title)}</button>`).join("");
    document.querySelector("#recommendation-method-data").textContent =
      `${numberFormatter.format(data.meta.anime_count)} AniList anime × ${numberFormatter.format(data.meta.movie_count)} TMDB movies: ${numberFormatter.format(data.meta.pair_count)} pairs. Combine up to three movies using the complete score matrix. Dots combine strong matches to each movie and shared favorites. Computed ${formatDate(data.meta.generated_at)}.`;
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
    const scores = await AnivizData.matrix(recommendationState.data);
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
    document.querySelector("#recommendation-status").textContent = recommendationState.viz === "magnets" ? "" : `Search ${numberFormatter.format(data.movies.length)} movies, or choose a favorite below.`;
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
  if (recommendationState.viz !== "magnets") recommendationState.animeId = null;
  document.querySelector("#movie-search").value = "";
  document.querySelector("#movie-search-results").hidden = true;
  renderRecommendations(true);
}

function renderRecommendations() {
  stopDustChart();
  if (!recommendationState.data) {
    if (!recommendationState.error) void loadRecommendations();
    return;
  }
  document.querySelector("#movie-magnets").hidden = false;
  document.querySelector("#dust-toolbar").hidden = false;
  hideTooltip();
  renderDustRecommendations();
}

function selectRecommendationAnime(id) {
  AnivizMain.select(id);
  renderDustDetail();
  highlightRecommendation();
}

function highlightRecommendation(previewId) {
  const selectedId = recommendationState.animeId;
  const selected = recommendationState.viz === "magnets" && globalThis.AnivizMain
    ? AnivizMain.snapshot()?.selectedAnimeIds || [] : [selectedId];
  if (recommendationState.viz === "magnets") previewId = null;
  document.querySelectorAll("[data-match-id]").forEach((row) => {
    const isSelected = selected.includes(row.dataset.matchId);
    row.classList.toggle("is-selected", isSelected);
    row.classList.toggle("is-preview", row.dataset.matchId === previewId);
    if (row.getAttribute("role") === "button") row.setAttribute("aria-pressed", isSelected);
    row.querySelector("button")?.setAttribute("aria-pressed", isSelected);
  });
  if (recommendationState.viz === "magnets") highlightDustConnections(selectedId);
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
