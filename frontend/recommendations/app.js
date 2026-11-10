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

function closeMovieSearch() {
  document.querySelector("#movie-search-popup").hidden = true;
}

function bindMovieSearch() {
  const picker = document.querySelector("#title-magnet-search");
  const search = document.querySelector("#movie-search");
  const popup = document.querySelector("#movie-search-popup");
  const results = document.querySelector("#movie-search-results");
  const sidebar = picker.closest(".recommendation-picker");
  const header = document.querySelector(".site-header");
  const viewport = window.visualViewport;

  function positionPopup() {
    if (popup.hidden) return;
    const anchor = search.getBoundingClientRect();
    const panel = sidebar.getBoundingClientRect();
    const gap = 8;
    const left = viewport?.offsetLeft ?? 0;
    const top = Math.max(viewport?.offsetTop ?? 0, header.getBoundingClientRect().bottom);
    const right = left + (viewport?.width ?? document.documentElement.clientWidth);
    const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
    if (anchor.bottom <= Math.max(top, panel.top) || anchor.top >= Math.min(bottom, panel.bottom)) {
      closeMovieSearch();
      return;
    }
    const below = bottom - anchor.bottom - 2 * gap;
    const above = anchor.top - top - 2 * gap;
    const opensAbove = below < 260 && above > below;
    const width = Math.min(320, right - left - 2 * gap);
    popup.classList.toggle("opens-above", opensAbove);
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(left + gap, Math.min(anchor.left, right - width - gap))}px`;
    popup.style.top = `${opensAbove ? anchor.top - gap : anchor.bottom + gap}px`;
    popup.style.setProperty("--movie-search-space", `${Math.max(0, opensAbove ? above : below)}px`);
  }

  function openSearch() {
    if (!recommendationState.data) return;
    popup.hidden = false;
    renderMovieSearchResults(search.value);
    positionPopup();
  }

  function openIfClosed() {
    if (popup.hidden) openSearch();
  }

  search.addEventListener("input", openSearch);
  search.addEventListener("focus", openIfClosed);
  search.addEventListener("click", openIfClosed);
  picker.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" && event.target === search) openIfClosed();
    if (popup.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      search.focus({ preventScroll: true });
      closeMovieSearch();
      return;
    }
    let next;
    if (event.target === search) {
      if (event.key === "Enter" && results.firstElementChild) {
        event.preventDefault();
        results.firstElementChild.click();
        return;
      }
      if (event.key === "ArrowDown") next = results.firstElementChild;
    } else if (event.target.matches("[data-magnet-key]")) {
      if (event.key === "ArrowDown") next = event.target.nextElementSibling || event.target;
      if (event.key === "ArrowUp") next = event.target.previousElementSibling || search;
      if (event.key === "Home") next = results.firstElementChild;
      if (event.key === "End") next = results.lastElementChild;
    }
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    if (next !== search) next.scrollIntoView({ block: "nearest" });
  });
  results.addEventListener("click", event => {
    const button = event.target.closest("[data-magnet-key]");
    if (button) addMagnet(button.dataset.magnetKey, "title", document.querySelector("#movie-search-feedback"));
  });
  function dismissOutside(event) {
    if (!picker.contains(event.target)) closeMovieSearch();
  }
  document.addEventListener("pointerdown", dismissOutside);
  document.addEventListener("focusin", dismissOutside);
  window.addEventListener("resize", positionPopup);
  window.addEventListener("scroll", event => {
    if (event.target !== results) positionPopup();
  }, { capture: true, passive: true });
  viewport?.addEventListener("resize", positionPopup);
  viewport?.addEventListener("scroll", positionPopup);
}

function bindRecommendationControls() {
  bindDustControls();
  bindMovieSearch();
  document.querySelector("#movie-suggestions").addEventListener("click", event => {
    const button = event.target.closest("[data-magnet-key]");
    if (button) addMagnet(button.dataset.magnetKey);
  });
  document.querySelector("#magnet-type").addEventListener("change", updateMagnetPickerMode);
  const genreChoice = document.querySelector("#genre-magnet-choice");
  genreChoice.addEventListener("change", () => {
    document.querySelector("#add-genre-magnet").disabled = !genreChoice.value;
    document.querySelector("#recommendation-status").textContent = "";
  });
  document.querySelector("#add-genre-magnet").addEventListener("click", () => addMagnet(genreChoice.value, "genre"));
  document.querySelector("#add-popularity-magnet").addEventListener("click", () => {
    addMagnet(AnivizMain.snapshot().popularity.key, "popularity");
  });
  document.querySelector("#retry-popularity").addEventListener("click", () => AnivizMain.loadPopularity());
  document.querySelector("#dust-direction").addEventListener("change", event => AnivizMain.switchDirection(event.target.value));
  document.querySelector("#recommendation-retry").addEventListener("click", () => {
    recommendationState.error = null;
    renderRecommendations();
  });
}

function pickerCatalogue() {
  const { direction } = AnivizMain.snapshot();
  const { magnet, example } = AnivizDust.DIRECTIONS[direction];
  return { direction, magnet, example, records: AnivizDust.catalogueFor(recommendationState.data, magnet),
    label: magnet === "tmdb" ? "movie" : "anime" };
}

function resetMagnetPicker() {
  const { direction, magnet, example, records, label } = pickerCatalogue();
  const { genreCohorts } = AnivizMain.snapshot();
  const search = document.querySelector("#movie-search");
  search.value = "";
  search.placeholder = `Search ${label} titles or aliases`;
  document.querySelector("#movie-search-label").textContent = `Add ${label === "anime" ? "an" : "a"} ${label} magnet · up to 3`;
  const titles = direction === AnivizDust.REVERSE
    ? [example, "ONE PIECE", "Naruto", "Your Name.", "Death Note"]
    : [example, "Interstellar", "The Matrix", "The Dark Knight", "Titanic"];
  document.querySelector("#movie-suggestions").innerHTML = `<span>Try a favorite</span>` + titles
    .map(title => records.find(record => record.title === title)).filter(Boolean)
    .map(record => `<button type="button" data-magnet-key="${escapeAttribute(AnivizDust.keyFor(magnet, record.id))}">${escapeHTML(record.title)}</button>`).join("");
  const choice = document.querySelector("#genre-magnet-choice");
  choice.innerHTML = '<option value="">Select a genre…</option>' + genreCohorts.map(cohort =>
    `<option value="${escapeAttribute(cohort.key)}">${escapeHTML(cohort.title)} (${cohort.memberIds.length})</option>`).join("");
  choice.disabled = !genreCohorts.length;
  document.querySelector("#genre-magnet-source").textContent = genreCohorts.length
    ? `Source: ${genreCohorts[0].source}. Counts are sampled titles.` : "No genre cohorts are available in this sample.";
  document.querySelector("#add-genre-magnet").disabled = true;
  document.querySelector('#magnet-type [value="title"]').checked = true;
  updateMagnetPickerMode();
}

function updateMagnetPickerMode() {
  const type = document.querySelector('#magnet-type input:checked').value;
  document.querySelector("#genre-magnet-picker").hidden = type !== "genre";
  document.querySelector("#title-magnet-search").hidden = type !== "title";
  document.querySelector("#movie-suggestions").hidden = type !== "title";
  closeMovieSearch();
  document.querySelector("#recommendation-status").textContent = "";
  if (type === "popularity" && AnivizMain.snapshot().popularity?.status === "idle") AnivizMain.loadPopularity();
  renderPopularityPicker();
}

function popularityDescription({ metric, snapshotDate, eligible, total }) {
  return `${metric}${snapshotDate ? ` · ${snapshotDate.slice(0, 10)} UTC` : ""} · ${eligible} of ${total} eligible`;
}

function renderPopularityPicker() {
  const { popularity, magnetKeys } = AnivizMain.snapshot();
  if (!popularity) return;
  const picking = document.querySelector('#magnet-type [value="popularity"]').checked;
  const saved = magnetKeys.includes(popularity.key);
  const button = document.querySelector("#add-popularity-magnet");
  document.querySelector("#popularity-magnet-picker").hidden = !picking && !(saved && !popularity.eligible);
  button.hidden = !picking;
  button.disabled = !popularity.eligible;
  button.textContent = `Add ${popularity.title.toLowerCase()} magnet`;
  document.querySelector("#retry-popularity").hidden = popularity.status !== "unavailable";
  const status = popularity.eligible ? popularityDescription(popularity)
    : ["loading", "idle"].includes(popularity.status) ? `Loading ${popularity.metric}…`
    : popularity.status === "unavailable" ? `${popularity.metric} could not be loaded or validated. Retry to use this magnet.`
    : `${popularityDescription(popularity)}. No values are available for this sample.`;
  document.querySelector("#popularity-magnet-source").textContent = status;
}

function focusMagnetPicker() {
  const type = document.querySelector('#magnet-type input:checked').value;
  const input = document.querySelector({ title: "#movie-search", genre: "#genre-magnet-choice", popularity: "#add-popularity-magnet" }[type]);
  (input.disabled ? document.querySelector('#magnet-type input:checked') : input).focus({ preventScroll: true });
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
    document.querySelector("#magnet-type").disabled = false;
    document.querySelector("#recommendation-method-data").textContent =
      `${numberFormatter.format(data.meta.anime_count)} AniList anime × ${numberFormatter.format(data.meta.movie_count)} TMDB movies: ${numberFormatter.format(data.meta.pair_count)} pairs. Both directions read the same cosine for each movie–anime pair. Use up to three magnets across titles, genre cohorts, and one popularity magnet. Computed ${formatDate(data.meta.generated_at)}.`;
    document.querySelector("#recommendation-method-model").textContent =
      `${data.meta.model} embeds titles, genres, tags, and synopses. Cosine similarity compares the normalized story vectors. The popularity magnet uses a separate source metric.`;
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

const titleBrowseOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base", ignorePunctuation: true });

function renderMovieSearchResults(query) {
  const { magnet, records, label } = pickerCatalogue();
  const container = document.querySelector("#movie-search-results");
  const browsing = !normalizeMovieSearch(query);
  const matches = browsing ? [...records].sort((a, b) => titleBrowseOrder.compare(a.title, b.title))
    : searchRecommendationMovies(records, query);
  const noun = label === "anime" ? "anime" : "movies";
  document.querySelector("#movie-search-heading").textContent = browsing ? `All ${noun} · A–Z`
    : matches.length ? "Search results" : `No ${noun} match`;
  document.querySelector("#movie-search-count").textContent = matches.length
    ? `${numberFormatter.format(matches.length)} ${matches.length === 1 ? "title" : "titles"}` : "";
  document.querySelector("#movie-search-feedback").textContent = matches.length ? "" : "Try another title, alias, or year.";
  container.innerHTML = matches.map(record => {
    const format = record.format;
    const hint = magnet === "tmdb" ? record.genres.join(" / ")
      : ["TV", "OVA", "ONA"].includes(format) ? format : humanize(format);
    return `<button type="button" tabindex="-1" data-magnet-key="${escapeAttribute(AnivizDust.keyFor(magnet, record.id))}">
      <strong>${escapeHTML(record.title)}</strong><span>${record.year || "Year unknown"}${hint ? ` · ${escapeHTML(hint)}` : ""}</span>
    </button>`;
  }).join("");
  container.scrollTop = 0;
}

function addMagnet(key, type = "title", status = document.querySelector("#recommendation-status")) {
  const { magnetKeys, genreCohorts, popularity } = AnivizMain.snapshot();
  const genre = type === "genre";
  if (genre && !genreCohorts.some(cohort => cohort.key === key)) {
    status.textContent = "That genre cohort is unavailable in this sample.";
    return;
  }
  if (type === "popularity" && !popularity.eligible) return;
  if (magnetKeys.includes(key)) {
    status.textContent = `That ${genre ? "genre cohort" : type === "popularity" ? "popularity choice" : "title"} is already a magnet.`;
    return;
  }
  if (magnetKeys.length >= 3) {
    status.textContent = "Three magnets are in place. Remove one to add another magnet.";
    return;
  }
  AnivizMain.setMagnets([...magnetKeys, key]);
  document.querySelector("#movie-search").value = "";
  focusMagnetPicker();
  closeMovieSearch();
  document.querySelector("#recommendation-status").textContent = "";
}

function renderRecommendations() {
  stopDustChart();
  if (!recommendationState.data) {
    if (!recommendationState.error) void loadRecommendations();
    return;
  }
  document.querySelector("#movie-magnets").hidden = false;
  document.querySelector("#dust-toolbar").hidden = false;
  renderPopularityPicker();
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
