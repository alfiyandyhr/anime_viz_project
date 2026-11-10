"use strict";

Object.assign(elements, {
  tableSort: document.querySelector("#table-sort"),
  tablePageSize: document.querySelector("#table-page-size"),
  tablePagination: document.querySelector("#table-pagination"),
  tableBody: document.querySelector("#anime-table-body"),
  tableNote: document.querySelector("#table-note"),
  filterGrid: document.querySelector("#filterbar .filter-grid"),
  movieStatus: document.querySelector("#movie-catalogue-status")
});

const shortlist = new Set();
const movieShortlist = new Set();
const catalogueSettings = {};
let catalogueView = "anime";
let movieCatalogue;
let filteredMovies = [];
let movieLoading = false;
let catalogueButtons = [];

function activeShortlist() {
  return catalogueView === "movie" ? movieShortlist : shortlist;
}

function movieScore(movie) {
  return Number.isFinite(movie.average_score) ? `${movie.average_score} / 10` : "Unknown";
}

function comparisonRows(anime) {
  const { episodes, duration } = AnivizChartData.comparisonValues(anime);
  return [
    `${humanize(anime.format)} / ${anime.year || "Unknown"}`,
    episodes ? `${episodes}${duration ? ` × ${duration} min` : ""}` : "Unknown",
    episodes && duration ? `${formatNumber(episodes * duration)} min` : "Unknown",
    Number.isFinite(anime.average_score) ? `${anime.average_score} / 100` : "Unknown",
    anime.status ? humanize(anime.status) : "Unknown"
  ];
}

function renderComparison() {
  const movie = catalogueView === "movie";
  const active = activeShortlist();
  const container = document.querySelector("#comparison-footer");
  const records = movie ? movieCatalogue?.titles || [] : state.data.anime;
  const selected = records.filter(title => active.has(String(title.id)));
  container.hidden = !selected.length;
  document.querySelector("#shortlist-status").textContent = selected.length
    ? `${selected.length} / 3 shortlisted · retained across filters and pages` : "Shortlist 2–3 titles to compare below.";
  if (!selected.length) { container.innerHTML = ""; return; }
  const values = movie ? selected.map(title => [
    title.year ?? "Unknown", movieScore(title), title.genres.join(", ") || "Unknown"
  ]) : selected.map(comparisonRows);
  const metrics = movie ? ["Release year", "TMDB score", "Genres"]
    : ["Format / year", "Episodes", "Estimated runtime", "AniList score", "Status"];
  container.innerHTML = `
    <div class="comparison-heading"><h2 id="comparison-heading">${selected.length > 1 ? "Comparison" : "Shortlist"}</h2>
      <button type="button" class="small-button ghost" id="clear-shortlist">Clear shortlist</button></div>
    <div class="comparison-scroll" tabindex="0" role="region" aria-label="Shortlist comparison, scroll horizontally for more titles"><table class="comparison-table" aria-labelledby="comparison-heading">
      <thead><tr><th scope="col">Metric</th>${selected.map(anime => `<th scope="col">${escapeHTML(anime.title)} <button class="small-button ghost" type="button" data-remove-shortlist="${escapeAttribute(anime.id)}" aria-label="Remove ${escapeAttribute(anime.title)}">×</button></th>`).join("")}</tr></thead>
      <tbody>${metrics.map((label, index) => `<tr><th scope="row">${label}</th>${values.map(rows => `<td>${escapeHTML(rows[index])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    ${movie ? "" : "<p>Runtime = episodes × minutes per episode.</p>"}`;
  container.querySelector("#clear-shortlist").addEventListener("click", () => {
    active.clear(); renderCatalogueTable(); renderComparison();
  });
  container.querySelectorAll("[data-remove-shortlist]").forEach(button => button.addEventListener("click", () => {
    active.delete(button.dataset.removeShortlist); renderCatalogueTable(); renderComparison();
  }));
}

function updateShortlistInputs() {
  const active = activeShortlist();
  elements.tableBody.querySelectorAll("[data-shortlist-id]").forEach((input) => {
    input.checked = active.has(input.dataset.shortlistId);
    input.disabled = active.size >= 3 && !input.checked;
  });
}

let explorerTable;
function renderAnimeTable() {
  explorerTable.update({ anime: state.filteredAnime, sortMode: elements.tableSort.value,
    compact: true, selectedIds: [...shortlist], page: state.tablePage, pageSize: state.tablePageSize, cohort: null,
    onSelect: id => openAnimeDetail(state.data.anime.find(item => String(item.id) === id)),
    onRendered: updateShortlistInputs });
}

function openCatalogueMovie(movie) {
  elements.drawerContent.innerHTML = `
    <div class="detail-main movie-detail">
      ${AnivizArtwork.movieHero(movie, escapeAttribute)}
      <h2>${escapeHTML(movie.title)}</h2>
      <div class="genre-list">${movie.genres.map(genre => `<span class="tag">${escapeHTML(genre)}</span>`).join("")}</div>
      <div class="detail-stats">
        <div class="detail-stat"><span>Year</span><strong>${movie.year ?? "Unknown"}</strong></div>
        <div class="detail-stat"><span>TMDB score</span><strong>${movieScore(movie)}</strong></div>
        <div class="detail-stat"><span>TMDB popularity</span><strong>${movie.popularity ?? "N/A"}</strong></div>
      </div>
      <p>${escapeHTML(movie.synopsis || "No synopsis is available for this movie.")}</p>
      <section class="detail-section">
        <a class="button button-primary" href="https://www.themoviedb.org/movie/${escapeAttribute(movie.id)}" target="_blank" rel="noopener noreferrer">View on TMDB</a>
      </section>
    </div>`;
  openDrawer("Movie details");
}

function renderCatalogueTable() {
  if (catalogueView === "anime") {
    renderAnimeTable();
    return;
  }
  explorerTable.update({ titles: filteredMovies, movie: true, sortMode: elements.tableSort.value,
    compact: true, selectedIds: [...movieShortlist], page: state.tablePage, pageSize: state.tablePageSize,
    onSelect: id => openCatalogueMovie(movieCatalogue.titles.find(title => String(title.id) === id)),
    onRendered: updateShortlistInputs });
  if (!movieCatalogue) elements.tableNote.textContent = elements.movieStatus.textContent;
}

function applyCatalogueFilters() {
  if (catalogueView === "anime") {
    applyFilters();
    return;
  }
  if (!movieCatalogue) return;
  filteredMovies = filterTitles(movieCatalogue.titles, movieCatalogue.meta);
  elements.filterSummary.textContent = `${formatNumber(filteredMovies.length)} / ${formatNumber(movieCatalogue.titles.length)} sampled movies`;
  state.tablePage = 0;
  renderPage();
}

function restoreCatalogueControls(meta) {
  elements.searchInput.inert = false;
  elements.filterGrid.inert = false;
  populateControls(meta);
  resetFilterControls(meta);
  restoreFilterControls(catalogueSettings[catalogueView]?.filters);
  elements.scoreOutput.value = elements.scoreFilter.value;
  applyCatalogueFilters();
}

async function loadMovieCatalogue() {
  elements.filterSummary.textContent = "Loading movies…";
  elements.movieStatus.textContent = "Loading movies from TMDB…";
  renderPage();
  if (movieLoading) return;
  movieLoading = true;
  try {
    const data = await AnivizData.recommendations();
    if (!Array.isArray(data?.movies) || !data.movies.length) throw new Error("Movie sample unavailable");
    const [snapshot, artwork] = await Promise.all([
      AnivizData.moviePopularity(data).catch(() => null),
      AnivizData.movieDetails(data).catch(() => null)
    ]);
    const titles = data.movies.map(movie => {
      const detail = snapshot?.movies[movie.id];
      return { ...movie, ...artwork?.[movie.id], ...detail, average_score: detail?.vote_average, studio_names: [] };
    });
    const years = titles.map(movie => movie.year).filter(Number.isFinite);
    movieCatalogue = { titles, meta: {
      genres: [...new Set(titles.flatMap(movie => movie.genres))].sort(), studios: [], formats: [],
      year_min: years.length ? Math.min(...years) : 1900,
      year_max: years.length ? Math.max(...years) : new Date().getFullYear()
    } };
    elements.movieStatus.textContent = `Loaded ${formatNumber(titles.length)} movies from TMDB. ${snapshot
      ? `Snapshot ${snapshot.snapshot_date} UTC.` : "Archived scores and popularity are unavailable."}`;
  } catch (error) {
    elements.movieStatus.textContent = "Could not load movies. Select Movie to try again.";
  } finally {
    movieLoading = false;
  }
  if (catalogueView !== "movie") return;
  if (movieCatalogue) restoreCatalogueControls(movieCatalogue.meta);
  else {
    elements.filterSummary.textContent = "Movies unavailable";
    renderPage();
  }
}

function switchCatalogue(view) {
  if (view === catalogueView) {
    if (view === "movie" && !movieCatalogue) void loadMovieCatalogue();
    return;
  }
  if (catalogueView === "anime" || movieCatalogue) {
    catalogueSettings[catalogueView] = { filters: readFilterControls(), sort: elements.tableSort.value };
  }
  closeDrawer();
  catalogueView = view;
  const movie = view === "movie";
  document.body.dataset.catalogueView = view;
  catalogueButtons.forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.catalogueTarget === view));
  });
  const label = movie ? "Movie" : "Anime";
  elements.tableBody.id = `${view}-table-body`;
  document.querySelector(".table-wrapper").setAttribute("aria-label", `${label} catalogue table, scroll horizontally for more columns`);
  elements.searchInput.placeholder = movie ? "e.g. Interstellar" : "e.g. Attack on Titan";
  elements.scoreFilter.max = movie ? 10 : 100;
  elements.scoreFilter.step = movie ? 0.1 : 1;
  elements.tableSort.querySelector('[value="favourites"]').disabled = movie;
  elements.tableSort.value = catalogueSettings[view]?.sort ?? "popularity";
  state.tablePage = 0;
  if (!movie) {
    restoreCatalogueControls(state.data.meta);
  } else if (movieCatalogue) {
    restoreCatalogueControls(movieCatalogue.meta);
  } else {
    elements.searchInput.value = "";
    elements.searchInput.inert = true;
    elements.filterGrid.inert = true;
    void loadMovieCatalogue();
  }
}

registerPage({
  bindControls() {
    explorerTable = AnivizExplorer.create({ body: elements.tableBody, pagination: elements.tablePagination,
      note: elements.tableNote, d3, helpers: chartHelpers() });
    elements.tableBody.addEventListener("change", (event) => {
      const input = event.target.closest("[data-shortlist-id]");
      if (!input) return;
      const active = activeShortlist();
      if (!input.checked) active.delete(input.dataset.shortlistId);
      else if (active.size < 3) active.add(input.dataset.shortlistId);
      updateShortlistInputs();
      renderComparison();
    });
    elements.tableSort.addEventListener("change", () => {
      state.tablePage = 0;
      renderCatalogueTable();
    });
    elements.tablePageSize.addEventListener("change", () => {
      state.tablePageSize = Number(elements.tablePageSize.value);
      state.tablePage = 0;
      renderCatalogueTable();
    });
    elements.tablePagination.addEventListener("click", (event) => {
      const btn = event.target.closest(".page-btn");
      if (!btn || btn.disabled) return;
      state.tablePage = Number(btn.dataset.page);
      renderCatalogueTable();
      document.querySelector(".table-wrapper")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    catalogueButtons = document.querySelectorAll("[data-catalogue-target]");
    catalogueButtons.forEach(button => {
      button.addEventListener("click", () => switchCatalogue(button.dataset.catalogueTarget));
    });
  },
  applyFilters: applyCatalogueFilters,
  resetFilters() {
    if (catalogueView === "anime") resetFilters();
    else if (movieCatalogue) {
      resetFilterControls(movieCatalogue.meta);
      applyCatalogueFilters();
    }
  },
  destroy() { explorerTable.destroy(); },
  render() {
    catalogueButtons.forEach(button => { button.disabled = false; });
    renderCatalogueTable();
    renderComparison();
  }
});
