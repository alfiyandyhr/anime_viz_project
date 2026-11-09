"use strict";

const recommendationState = {
  data: null, loading: false, error: null,
  scores: null, scoresLoading: false, scoresError: null, magnetPositions: {}
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
  const results = document.querySelector("#movie-search-results");
  search.addEventListener("input", renderMovieSearchResults);
  search.addEventListener("keydown", event => {
    const first = !results.hidden && results.querySelector("button");
    if (first && ["ArrowDown", "Enter"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Enter") first.click();
      else first.focus();
    }
    if (event.key === "Escape") results.hidden = true;
  });
  results.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      results.hidden = true;
      search.focus();
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? event.target.nextElementSibling : event.target.previousElementSibling;
    (next || search).focus();
  });
  for (const selector of ["#movie-search-results", "#movie-suggestions"]) {
    document.querySelector(selector).addEventListener("click", event => {
      const button = event.target.closest("[data-magnet-key]");
      if (button) addMagnet(button.dataset.magnetKey);
    });
  }
  document.querySelector("#dust-direction").addEventListener("change", event => AnivizMain.switchDirection(event.target.value));
  document.querySelector("#recommendation-retry").addEventListener("click", () => {
    recommendationState.error = null;
    renderRecommendations();
  });
}

function pickerCatalogue() {
  const { direction } = AnivizMain.snapshot();
  const { magnet } = AnivizDust.DIRECTIONS[direction];
  return { direction, magnet, records: AnivizDust.catalogueFor(recommendationState.data, magnet),
    label: magnet === "tmdb" ? "movie" : "anime" };
}

function resetMagnetPicker() {
  const { direction, magnet, records, label } = pickerCatalogue();
  const search = document.querySelector("#movie-search");
  search.value = "";
  search.placeholder = `Search ${label} titles or aliases`;
  document.querySelector("#movie-search-label").textContent = `Add ${label === "anime" ? "an" : "a"} ${label} magnet · up to 3`;
  document.querySelector("#movie-search-results").hidden = true;
  document.querySelector("#recommendation-status").textContent = "";
  const titles = direction === AnivizDust.REVERSE
    ? ["Attack on Titan", "ONE PIECE", "Naruto", "Your Name.", "Death Note"]
    : ["Inception", "Interstellar", "The Matrix", "The Dark Knight", "Titanic"];
  document.querySelector("#movie-suggestions").innerHTML = `<span>Try a favorite</span>` + titles
    .map(title => records.find(record => record.title === title)).filter(Boolean)
    .map(record => `<button type="button" data-magnet-key="${escapeAttribute(AnivizDust.keyFor(magnet, record.id))}">${escapeHTML(record.title)}</button>`).join("");
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
    AnivizMain.initialize(data);
    document.querySelector("#dust-direction").disabled = false;
    document.querySelector("#recommendation-method-data").textContent =
      `${numberFormatter.format(data.meta.anime_count)} AniList anime × ${numberFormatter.format(data.meta.movie_count)} TMDB movies: ${numberFormatter.format(data.meta.pair_count)} pairs. Both directions read the same cosine for each movie–anime pair. Use up to three titles from the chosen magnet catalogue. Computed ${formatDate(data.meta.generated_at)}.`;
    document.querySelector("#recommendation-method-model").textContent =
      `${data.meta.model} embeds titles, genres, tags, and synopses. Cosine similarity compares normalized vectors; ratings and popularity do not affect the score.`;
  } catch (error) {
    recommendationState.error = error.message;
    setStatus("Recommendation data could not be loaded.", "error");
    status.textContent = `Could not load recommendations (${error.message}). Retry to load the title samples.`;
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
    AnivizMain.setScores(scores);
  } catch (error) {
    recommendationState.scoresError = error.message;
  } finally {
    recommendationState.scoresLoading = false;
    renderRecommendations();
  }
}

function renderMovieSearchResults() {
  if (!recommendationState.data) return;
  const { magnet, records, label } = pickerCatalogue();
  const query = document.querySelector("#movie-search").value;
  const container = document.querySelector("#movie-search-results");
  const status = document.querySelector("#recommendation-status");
  if (!normalizeMovieSearch(query)) {
    container.hidden = true;
    status.textContent = "";
    return;
  }
  const matches = searchRecommendationMovies(records, query);
  container.hidden = false;
  container.innerHTML = matches.slice(0, 30).map(record => {
    const format = record.format;
    const hint = magnet === "tmdb" ? record.genres.join(" / ")
      : ["TV", "OVA", "ONA"].includes(format) ? format : humanize(format);
    return `<button type="button" data-magnet-key="${escapeAttribute(AnivizDust.keyFor(magnet, record.id))}">
      <strong>${escapeHTML(record.title)}</strong><span>${record.year || "Year unknown"}${hint ? ` · ${escapeHTML(hint)}` : ""}</span>
    </button>`;
  }).join("");
  if (!matches.length) container.hidden = true;
  const noun = label === "anime" || matches.length === 1 ? label : "movies";
  status.textContent = matches.length
    ? `${matches.length} ${noun} found.${matches.length > 30 ? " Showing the first 30." : ""}`
    : `No ${noun} match “${query}” in this sample.`;
}

function addMagnet(key) {
  const { magnetKeys } = AnivizMain.snapshot();
  const status = document.querySelector("#recommendation-status");
  if (magnetKeys.includes(key)) {
    status.textContent = "That title is already a magnet.";
    return;
  }
  if (magnetKeys.length >= 3) {
    status.textContent = "Three magnets are in place. Remove one to add another title.";
    return;
  }
  AnivizMain.setMagnets([...magnetKeys, key]);
  const search = document.querySelector("#movie-search");
  search.value = "";
  search.focus({ preventScroll: true });
  document.querySelector("#movie-search-results").hidden = true;
  status.textContent = "";
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

function highlightRecommendation() {
  const selected = AnivizMain.snapshot().selectedKeys;
  document.querySelectorAll(".dust-node").forEach(dot => {
    const isSelected = selected.includes(dot.dataset.matchId);
    dot.classList.toggle("is-selected", isSelected);
    dot.setAttribute("aria-pressed", isSelected);
  });
  highlightDustConnections();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeMovieSearch, searchRecommendationMovies, getRecommendationMatches, getRecommendationRanking };
}
