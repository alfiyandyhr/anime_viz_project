"use strict";

const state = {
  data: null,
  filteredAnime: [],
  genreColor: null,
  networkSimulation: null,
  networkTypes: new Set(["actor", "character", "work"]),
  tablePage: 0,
  tablePageSize: 10,
  cohort: null,
  cohort_ids: null,
  browseMode: "catalogue",
  scopePersistent: true
};

// Each page registers only the renderers and controls it owns.
let pageControls = {};
const dataUrl = new URL("../../data.json", document.currentScript.src);
const FILTER_STORAGE_KEY = "aniviz-filters";
const SEED_MOVIE_STORAGE_KEY = "aniviz_seed_movie";
const COHORT_IDS_STORAGE_KEY = "aniviz_cohort_ids";
const COHORT_RANKING_STORAGE_KEY = "aniviz_cohort_ranking";
const COHORT_SCOPE_STORAGE_KEY = "aniviz_cohort_scope";
const CATALOGUE_FILTER_STORAGE_KEY = "aniviz-catalogue-filters";
const FILTER_VERSION_STORAGE_KEY = "aniviz-filter-version";
const DASHBOARD_PAGES = ["content", "creators", "reception", "explorer"];

// Older sessions used one filter set. Attribute it to the scope in which it
// was last used, then keep the two scopes independent from this point onward.
function migrateScopeFilters(cohort = readMovieCohort()) {
  try {
    if (sessionStorage.getItem(FILTER_VERSION_STORAGE_KEY) === "2") return;
    if (!cohort || !cohort.enabled) {
      const legacy = sessionStorage.getItem(FILTER_STORAGE_KEY);
      if (legacy && !sessionStorage.getItem(CATALOGUE_FILTER_STORAGE_KEY)) {
        sessionStorage.setItem(CATALOGUE_FILTER_STORAGE_KEY, legacy);
      }
      sessionStorage.removeItem(FILTER_STORAGE_KEY);
    }
    sessionStorage.setItem(FILTER_VERSION_STORAGE_KEY, "2");
  } catch (error) { /* Filtering remains available without persistence. */ }
}

function initializeBrowseMode() {
  state.cohort = readMovieCohort();
  migrateScopeFilters(state.cohort);
  let requested = null;
  try { requested = new URL(window.location.href).searchParams.get("mode"); } catch (error) { /* No URL in non-browser callers. */ }
  const mode = ["matches", "catalogue"].includes(requested) ? requested
    : state.cohort?.enabled ? "matches" : "catalogue";
  state.browseMode = mode === "matches" && state.cohort ? "matches" : "catalogue";
  state.cohort_ids = state.browseMode === "matches" ? new Set(state.cohort.ids) : null;
  if (state.cohort) state.cohort.enabled = state.browseMode === "matches";
  const scope = state.browseMode === "matches" ? "cohort" : "catalogue";
  try {
    sessionStorage.setItem(COHORT_SCOPE_STORAGE_KEY, scope);
    state.scopePersistent = sessionStorage.getItem(COHORT_SCOPE_STORAGE_KEY) === scope;
  } catch (error) { state.scopePersistent = false; }
  renderScopePageCopy();
}

function readMovieCohort() {
  try {
    const seed = JSON.parse(sessionStorage.getItem(SEED_MOVIE_STORAGE_KEY) || "null");
    const ids = JSON.parse(sessionStorage.getItem(COHORT_IDS_STORAGE_KEY) || "null");
    if (!seed || typeof seed.title !== "string" || !seed.tmdbId
      || !Array.isArray(ids) || !ids.length
      || !ids.every((id) => /^\d+$/.test(String(id)))) return null;
    let ranking = null;
    try {
      ranking = JSON.parse(sessionStorage.getItem(COHORT_RANKING_STORAGE_KEY) || "null");
    } catch (error) { /* IDs still provide scope if optional scores are missing. */ }
    return {
      seed, ids: [...new Set(ids.map(String))].slice(0, 20),
      ranking: String(ranking?.tmdbId) === String(seed.tmdbId) ? ranking : null,
      enabled: [null, "cohort"].includes(sessionStorage.getItem(COHORT_SCOPE_STORAGE_KEY))
    };
  } catch (error) {
    return null;
  }
}

function isCohortActive() {
  return Boolean(state.cohort && state.cohort_ids);
}

function cohortAnime() {
  const ids = new Set(state.cohort?.ids || []);
  return state.data.anime.filter((anime) => ids.has(String(anime.id)));
}

function restoreMovieCohort() {
  initializeBrowseMode();
  if (!DASHBOARD_PAGES.includes(document.body?.dataset.chapter)) return;
  const strip = document.createElement("div");
  strip.id = "cohort-context";
  strip.className = "cohort-context";
  document.querySelector("#filterbar").insertAdjacentElement("afterend", strip);
  renderCohortContext();
}

function renderCohortContext() {
  const strip = document.querySelector("#cohort-context");
  if (!strip) return;
  // Build controls once so filter updates preserve keyboard focus.
  if (!strip.querySelector(".cohort-details")) {
    strip.innerHTML = `
      <div class="cohort-details">
        <strong class="cohort-label"></strong>
        <p class="cohort-count" role="status" aria-live="polite"></p>
        <p class="cohort-metadata"></p>
        <p class="cohort-filter-note"></p>
      </div>
      <div class="cohort-actions">
        <a class="cohort-change" href="../recommendations/index.html">Change movie</a>
        <a class="cohort-resume" href="?mode=matches" hidden></a>
        <button type="button" class="small-button ghost cohort-reset">Reset filters</button>
      </div>`;
    strip.querySelector(".cohort-reset").addEventListener("click", resetFilters);
  }
  const active = isCohortActive();
  const seed = state.cohort?.seed;
  const movie = seed ? `${seed.title}${seed.year ? ` (${seed.year})` : ""}` : "";
  strip.querySelector(".cohort-label").textContent = active
    ? `Your movie: ${movie} · Top ${state.cohort.ids.length} anime matches`
    : `Browsing the full catalogue${seed ? ` · Your movie: ${movie} · Top ${state.cohort.ids.length} matches saved` : ""}`;
  strip.querySelector(".cohort-count").textContent = filterScopeSummary();
  const metadata = strip.querySelector(".cohort-metadata");
  const missing = active ? state.cohort.ids.length - cohortAnime().length : 0;
  metadata.hidden = !missing;
  metadata.textContent = missing
    ? `${missing} ${missing === 1 ? "match is" : "matches are"} unavailable because dashboard metadata is missing. Resetting filters cannot restore missing metadata. Original matches, ranks and scores are kept; no titles are substituted.` : "";
  strip.querySelector(".cohort-filter-note").textContent = active
    ? "Filters carry between Tasks 2–4 and Explorer in this browser session and narrow your original movie matches. Reset filters to restore all available matches for this movie."
    : "Catalogue filters carry between catalogue views in this browser session, separately from your movie-match filters. The full catalogue is the loaded dashboard sample.";
  if (!state.scopePersistent) strip.querySelector(".cohort-filter-note").textContent =
    "Session storage is unavailable. Filters and movie context may not carry to another page. Choose a movie in Task 1 to start its journey.";
  strip.querySelector(".cohort-change").textContent = seed ? "Change movie" : "Choose a movie · Task 1";
  const resume = strip.querySelector(".cohort-resume");
  resume.hidden = active || !seed;
  resume.textContent = seed ? `Resume matches for ${movie}` : "";
}

function renderScopePageCopy() {
  const catalogue = state.browseMode === "catalogue";
  const copy = {
    content: ["Task 2 · Content", "Explore the stories in your matches",
      "Explore genres and release years in your selected movie’s anime matches. Compare the stories that interest you and use the filters to narrow your choices before discovering their studios and cast in Task 3.",
      "Content · Full catalogue", "Explore stories across the catalogue",
      "Browse genres and release years across the loaded anime catalogue. Filter by your interests, then explore creators, audience reception, or compare titles in Explorer."],
    creators: ["Task 3 · Creators", "Discover the studios and cast behind your matches",
      "Explore the studios and Japanese voice actors credited on your selected movie’s anime matches. Follow shared credits and connections among the titles to learn who made them, then compare audience reception in Task 4.",
      "Creators · Full catalogue", "Discover studios and cast across the catalogue",
      "Explore the studios and Japanese voice actors credited across the loaded anime catalogue. Filter titles and follow connections in the collaboration network to discover their creators."],
    reception: ["Task 4 · Reception", "Compare audience reception for your matches",
      "Compare AniList ratings and popularity for your selected movie’s anime matches. Filter the titles and select a bubble to inspect an anime, then take your finalists to Explorer to choose your first watch.",
      "Reception · Full catalogue", "Compare audience reception across the catalogue",
      "Compare AniList ratings and popularity across the loaded anime catalogue. Use filters to narrow the titles, select a bubble for details, or compare your choices in Explorer."],
    explorer: ["Explorer · Final comparison", "Compare your finalists and choose your first anime",
      "Use the Shortlist checkboxes to select 2–3 of your selected movie’s matches. Compare their movie similarity, format, runtime, and audience scores in the comparison panel to choose your first anime. You can keep narrowing the table with filters and open any title for details.",
      "Explorer · Full catalogue", "Browse and compare anime from the catalogue",
      "Explore the loaded anime catalogue by genre, year, studio, and format. Shortlist 2–3 titles to compare runtime and audience scores, and open any title for details."]
  };
  const chapter = document.body?.dataset.chapter;
  if (copy[chapter]) {
    const [eyebrow, heading, lede] = copy[chapter].slice(catalogue ? 3 : 0);
    document.querySelector(".chapter-head .chapter-eyebrow").textContent = eyebrow;
    document.querySelector(".chapter-head h2").textContent = heading;
    document.querySelector(".chapter-head .chapter-lede").textContent = lede;
    document.querySelector(`#chapter-${chapter}`).setAttribute("aria-label", eyebrow);
    document.title = `AnIViz — ${eyebrow}`;
  }
  document.querySelectorAll?.(".rail-link[data-goto]").forEach((link) => {
    const page = link.dataset.goto;
    if (!copy[page]) return;
    link.href = `../${page}/index.html?mode=${state.browseMode}`;
    link.setAttribute("aria-label", catalogue ? copy[page][3] : copy[page][0]);
    link.querySelector("small").textContent = catalogue ? "Browse full catalogue" : {
      content: "Task 2 · Explore stories and years", creators: "Task 3 · Discover studios and cast",
      reception: "Task 4 · Compare audience reception", explorer: "Finish · Compare your finalists"
    }[page];
    link.querySelector(".idx").textContent = catalogue ? "◇" : {content: "02", creators: "03", reception: "04", explorer: "✦"}[page];
  });
  renderJourneyGuidance();
}

function renderJourneyGuidance() {
  const chapter = document.body?.dataset.chapter;
  const tasks = [
    ["recommendations", "Choose a movie"],
    ["content", "Explore stories"],
    ["creators", "Discover creators"],
    ["reception", "Compare reception"]
  ];
  if (![...tasks.map(([page]) => page), "explorer"].includes(chapter)) return;
  const overview = document.querySelector("#journey-overview");
  const next = document.querySelector("#journey-next");
  const visible = chapter === "recommendations" || isCohortActive();
  if (overview) {
    overview.hidden = !visible;
    // The location never represents recorded task completion.
    overview.innerHTML = `
      <nav class="journey-nav" aria-label="Four-task movie journey and final comparison" aria-describedby="journey-location">
        <ol>${tasks.map(([page, label], index) => `
          <li><a href="../${page}/index.html${index ? "?mode=matches" : ""}"${index ? " data-journey-destination" : ""}${page === chapter ? ' aria-current="page"' : ""}>
            <span class="journey-number" aria-hidden="true">${index + 1}</span>
            <span><small>Task ${index + 1}${page === chapter ? " · You are here" : ""}</small><strong>${label}</strong></span>
          </a></li>`).join("")}</ol>
        <a class="journey-finish" data-journey-destination href="../explorer/index.html?mode=matches"${chapter === "explorer" ? ' aria-current="page"' : ""}>Final comparison · Explorer${chapter === "explorer" ? " · You are here" : " →"}</a>
      </nav>
      <p id="journey-location">${chapter === "recommendations"
        ? "Opening another task or Explorer uses your chosen movie, or confirms the displayed example. " : ""}This shows your location; task completion is not tracked. Explore at your own pace.</p>`;
  }
  const nextSteps = {
    content: ["creators", "Next: discover who made these anime →", "Follow the studios and cast behind your movie’s matches in Task 3. Your movie and filters carry with you."],
    creators: ["reception", "Next: compare audience reception →", "Compare ratings and popularity for your movie’s matches in Task 4. Your movie and filters carry with you."],
    reception: ["explorer", "Compare your finalists in Explorer →", "Select 2–3 matches to compare similarity, format, runtime, and audience scores, then choose your first anime. Your movie and filters carry with you."]
  };
  if (next && nextSteps[chapter]) {
    const [page, label, description] = nextSteps[chapter];
    next.hidden = !visible;
    const note = state.scopePersistent ? description
      : "Session storage is unavailable. You can explore this page, but your movie and filters may not carry to the next page.";
    next.innerHTML = `<p>${note}</p><a class="button button-primary" href="../${page}/index.html?mode=matches">${label}</a>`;
  }
}

function registerPage(controls) {
  pageControls = controls;
}

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1
});

const elements = {
  dataStatus: document.querySelector("#data-status"),
  statusDot: document.querySelector("#status-dot"),
  searchInput: document.querySelector("#search-input"),
  genreFilter: document.querySelector("#genre-filter"),
  studioFilter: document.querySelector("#studio-filter"),
  formatFilter: document.querySelector("#format-filter"),
  yearFrom: document.querySelector("#year-from"),
  yearTo: document.querySelector("#year-to"),
  scoreFilter: document.querySelector("#score-filter"),
  scoreOutput: document.querySelector("#score-output"),
  resetFilters: document.querySelector("#reset-filters"),
  filterSummary: document.querySelector("#filter-summary"),
  tooltip: document.querySelector("#tooltip"),
  drawer: document.querySelector("#detail-drawer"),
  drawerContent: document.querySelector("#drawer-content"),
  drawerOverlay: document.querySelector("#drawer-overlay"),
  closeDrawer: document.querySelector("#close-drawer")
};
document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindControls();
  pageControls.bindControls?.();
  if (pageControls.usesDashboard === false) {
    initializeBrowseMode();
    renderPage();
  }
  else await loadDashboard();
}

function bindControls() {
  const filterElements = [
    elements.searchInput, elements.genreFilter, elements.studioFilter,
    elements.formatFilter, elements.yearFrom, elements.yearTo, elements.scoreFilter
  ];

  filterElements.forEach((element) => {
    element.addEventListener("input", () => {
      elements.scoreOutput.value = elements.scoreFilter.value;
      applyFilters();
    });
  });

  elements.resetFilters.addEventListener("click", resetFilters);
  elements.closeDrawer.addEventListener("click", closeDrawer);
  elements.drawerOverlay.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  window.addEventListener("resize", debounce(renderPage, 250));
}

function renderPage() {
  if (state.data || pageControls.usesDashboard === false) pageControls.render?.();
}

function saveFilters() {
  try {
    sessionStorage.setItem(state.browseMode === "matches" ? FILTER_STORAGE_KEY : CATALOGUE_FILTER_STORAGE_KEY, JSON.stringify({
      searchInput: elements.searchInput.value,
      genreFilter: elements.genreFilter.value,
      studioFilter: elements.studioFilter.value,
      formatFilter: elements.formatFilter.value,
      yearFrom: elements.yearFrom.value,
      yearTo: elements.yearTo.value,
      scoreFilter: elements.scoreFilter.value
    }));
  } catch (error) {
    // Browsers can disable session storage; filtering still works on the page.
  }
}

function restoreFilters() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(state.browseMode === "matches" ? FILTER_STORAGE_KEY : CATALOGUE_FILTER_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return;
    for (const key of ["searchInput", "genreFilter", "studioFilter", "formatFilter",
      "yearFrom", "yearTo", "scoreFilter"]) {
      if (typeof saved[key] !== "string") continue;
      const element = elements[key];
      if (element.tagName === "SELECT"
        && !Array.from(element.options).some((option) => option.value === saved[key])) continue;
      element.value = saved[key];
    }
  } catch (error) {
    // Missing or outdated saved filters fall back to the current data defaults.
  }
}

async function loadDashboard() {
  setStatus(
    "Loading anime industry data…",
    "loading"
  );

  try {
    const response = await fetch(dataUrl, {
      headers: {
        Accept: "application/json"
      }
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error("Failed to load data.json");
    }

    state.data = payload;

    const colors = [
      ...d3.schemeTableau10,
      ...d3.schemeSet3,
      ...d3.schemePaired
    ];

    state.genreColor = d3.scaleOrdinal()
      .domain(payload.meta.genres)
      .range(colors);

    populateControls();
    restoreMovieCohort();
    restoreFilters();

    elements.scoreOutput.value = elements.scoreFilter.value;

    applyFilters();

    const warning = payload.meta.warning
      ? ` ${payload.meta.warning}`
      : "";

    setStatus(
      `Loaded ${numberFormatter.format(payload.meta.sample_size)} anime `
      + `from ${payload.meta.source}.${warning}`,
      payload.meta.warning ? "loading" : "success"
    );

    document.querySelector("#footer-generated").textContent =
      `Generated ${formatDate(payload.meta.generated_at)}`;

    document.querySelector("#footer-cache").textContent =
      `Data mode: ${humanize(payload.meta.cache_status || "unknown")}`;

  } catch (error) {
    console.error(error);

    setStatus(
      `Could not load dashboard data: ${error.message}`,
      "error"
    );

    showFatalMessage(error.message);
  }
}

function populateControls() {
  const { meta } = state.data;

  populateSelect(
    elements.genreFilter,
    meta.genres,
    "All genres"
  );

  populateSelect(
    elements.studioFilter,
    meta.studios,
    "All studios"
  );

  populateSelect(
    elements.formatFilter,
    meta.formats,
    "All formats",
    humanize
  );

  const years = [];
  for (let year = meta.year_min; year <= meta.year_max; year += 1) {
    years.push(year);
  }

  elements.yearFrom.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");

  elements.yearTo.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");

  elements.yearFrom.value = meta.year_min;
  elements.yearTo.value = meta.year_max;
}

function populateSelect(select, values, allLabel, formatter = (value) => value) {
  select.innerHTML = [
    `<option value="All">${escapeHTML(allLabel)}</option>`,
    ...values.map((value) => (
      `<option value="${escapeAttribute(value)}">`
      + `${escapeHTML(formatter(value))}</option>`
    ))
  ].join("");
}

function resetFilters() {
  elements.searchInput.value = "";
  elements.genreFilter.value = "All";
  elements.studioFilter.value = "All";
  elements.formatFilter.value = "All";
  elements.yearFrom.value = state.data.meta.year_min;
  elements.yearTo.value = state.data.meta.year_max;
  elements.scoreFilter.value = 0;
  elements.scoreOutput.value = 0;
  pageControls.resetControls?.();

  applyFilters();
}

function applyFilters() {
  if (!state.data) {
    return;
  }

  let yearFrom = Number(elements.yearFrom.value);
  let yearTo = Number(elements.yearTo.value);

  if (yearFrom > yearTo) {
    [yearFrom, yearTo] = [yearTo, yearFrom];
    elements.yearFrom.value = yearFrom;
    elements.yearTo.value = yearTo;
  }

  const search = elements.searchInput.value.trim().toLowerCase();
  const selectedGenre = elements.genreFilter.value;
  const selectedStudio = elements.studioFilter.value;
  const selectedFormat = elements.formatFilter.value;
  const minimumScore = Number(elements.scoreFilter.value);

  state.filteredAnime = state.data.anime.filter((anime) => {
    const haystack = [
      anime.title,
      anime.titles?.english,
      anime.titles?.romaji,
      anime.titles?.native,
      ...(anime.genres || []),
      ...(anime.studio_names || []),
      ...(anime.voice_actors || []).map((actor) => actor.name)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const yearMatches = Number.isFinite(anime.year)
      ? anime.year >= yearFrom && anime.year <= yearTo
      : yearFrom <= state.data.meta.year_min && yearTo >= state.data.meta.year_max;

    const scoreMatches = minimumScore === 0
      || (
        Number.isFinite(anime.average_score)
        && anime.average_score >= minimumScore
      );

    return (
      (!state.cohort_ids || state.cohort_ids.has(String(anime.id)))
      && (!search || haystack.includes(search))
      && (selectedGenre === "All" || anime.genres.includes(selectedGenre))
      && (
        selectedStudio === "All"
        || anime.studio_names.includes(selectedStudio)
      )
      && (selectedFormat === "All" || anime.format === selectedFormat)
      && yearMatches
      && scoreMatches
    );
  });

  state.tablePage = 0;

  saveFilters();
  renderFilterSummary();
  renderPage();
}

function filterScopeSummary() {
  const total = state.data.anime.length;
  const visible = state.filteredAnime.length;
  if (isCohortActive()) {
    const original = state.cohort.ids.length;
    const hidden = cohortAnime().length - visible;
    return `Showing ${visible} of ${original} matches with current filters. `
      + `${hidden} ${hidden === 1 ? "match hidden" : "matches hidden"} by filters.`;
  }
  return `${numberFormatter.format(visible)} of ${numberFormatter.format(total)} sampled catalogue anime are visible.`;
}

function renderFilterSummary() {
  elements.filterSummary.textContent = filterScopeSummary();
  renderCohortContext();
}
function openAnimeDetail(anime) {
  const banner = anime.banner_image || anime.cover.extra_large || "";
  const cover = anime.cover.extra_large || anime.cover.large || "";

  elements.drawerContent.innerHTML = `
    <div class="detail-hero">
      <img
        class="detail-banner"
        src="${escapeAttribute(banner)}"
        alt=""
      >

      <div class="detail-main">
        <img
          class="detail-cover"
          src="${escapeAttribute(cover)}"
          alt="Cover for ${escapeAttribute(anime.title)}"
        >

        <h2>${escapeHTML(anime.title)}</h2>

        <div class="genre-list">
          ${anime.genres.map((genre) => (
            `<span class="tag">${escapeHTML(genre)}</span>`
          )).join("")}
        </div>

        <div class="detail-stats">
          <div class="detail-stat">
            <span>Score</span>
            <strong>
              ${Number.isFinite(anime.average_score)
                ? `${anime.average_score}/100`
                : "N/A"}
            </strong>
          </div>

          <div class="detail-stat">
            <span>Popularity</span>
            <strong>${compactFormatter.format(anime.popularity || 0)}</strong>
          </div>

          <div class="detail-stat">
            <span>Favourites</span>
            <strong>${compactFormatter.format(anime.favourites || 0)}</strong>
          </div>

          <div class="detail-stat">
            <span>Year</span>
            <strong>${anime.year || "Unknown"}</strong>
          </div>

          <div class="detail-stat">
            <span>Format</span>
            <strong>${escapeHTML(humanize(anime.format))}</strong>
          </div>

          <div class="detail-stat">
            <span>Episodes</span>
            <strong>${anime.episodes || "Unknown"}</strong>
          </div>
        </div>

        <p>
          ${escapeHTML(
            anime.description
            || "No synopsis is available for this title."
          )}
        </p>

        <section class="detail-section">
          <h3>Production information</h3>
          <p>
            <strong>Studio:</strong>
            ${escapeHTML(anime.studio_names.join(", "))}
          </p>
          <p>
            <strong>Source:</strong>
            ${escapeHTML(humanize(anime.source))}
          </p>
          <p>
            <strong>Status:</strong>
            ${escapeHTML(humanize(anime.status))}
          </p>
          <p>
            <strong>Episode duration:</strong>
            ${anime.duration ? `${anime.duration} minutes` : "Unknown"}
          </p>
        </section>

        <section class="detail-section">
          <h3>Japanese main-role voice actors</h3>

          <div class="actor-list">
            ${anime.voice_actors.length
              ? anime.voice_actors.map((actor) => `
                <div class="actor-item">
                  <strong>${escapeHTML(actor.name)}</strong>
                  <small>
                    ${escapeHTML(actor.characters.join(", "))}
                  </small>
                </div>
              `).join("")
              : "<p>No main-role Japanese cast data is available.</p>"
            }
          </div>
        </section>

        ${anime.site_url ? `
          <section class="detail-section">
            <a
              class="button button-primary"
              href="${escapeAttribute(anime.site_url)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on AniList
            </a>
          </section>
        ` : ""}
      </div>
    </div>
  `;

  openDrawer();
}

function openDrawer() {
  elements.drawer.scrollTop = 0;
  elements.drawer.classList.add("open");
  elements.drawerOverlay.classList.add("open");
  elements.drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  elements.drawer.classList.remove("open");
  elements.drawerOverlay.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
function computeGenreStats(anime) {
  return d3.rollups(
    anime.flatMap((item) => (
      item.genres.map((genre) => ({
        genre,
        score: item.average_score,
        popularity: item.popularity || 0,
        favourites: item.favourites || 0
      }))
    )),
    (rows) => {
      const scores = rows
        .map((row) => row.score)
        .filter(Number.isFinite);

      return {
        count: rows.length,
        averageScore: scores.length ? d3.mean(scores) : null,
        totalPopularity: d3.sum(rows, (row) => row.popularity),
        totalFavourites: d3.sum(rows, (row) => row.favourites)
      };
    },
    (row) => row.genre
  ).map(([genre, values]) => ({
    genre,
    ...values
  }));
}

function computeStudioStats(anime) {
  const rows = anime.flatMap((item) => (
    item.studio_names.map((studio) => ({
      studio,
      animeId: item.id,
      score: item.average_score,
      popularity: item.popularity || 0,
      favourites: item.favourites || 0,
      genres: item.genres
    }))
  ));

  return d3.rollups(
    rows,
    (studioRows) => {
      const scores = studioRows
        .map((row) => row.score)
        .filter(Number.isFinite);

      const genreCounts = d3.rollups(
        studioRows.flatMap((row) => row.genres),
        (genreRows) => genreRows.length,
        (genre) => genre
      ).sort((a, b) => d3.descending(a[1], b[1]));

      return {
        count: new Set(studioRows.map((row) => row.animeId)).size,
        averageScore: scores.length ? d3.mean(scores) : null,
        totalPopularity: d3.sum(
          studioRows,
          (row) => row.popularity
        ),
        totalFavourites: d3.sum(
          studioRows,
          (row) => row.favourites
        ),
        dominantGenre: genreCounts[0]?.[0] || "Other"
      };
    },
    (row) => row.studio
  ).map(([studio, values]) => ({
    studio,
    ...values
  }));
}
function calculateCorrelation(points) {
  if (points.length < 3) {
    return null;
  }

  const meanX = d3.mean(points, (point) => point[0]);
  const meanY = d3.mean(points, (point) => point[1]);

  const numerator = d3.sum(
    points,
    (point) => (point[0] - meanX) * (point[1] - meanY)
  );

  const denominator = Math.sqrt(
    d3.sum(points, (point) => (point[0] - meanX) ** 2)
    * d3.sum(points, (point) => (point[1] - meanY) ** 2)
  );

  return denominator ? numerator / denominator : null;
}
function setStatus(message, mode) {
  elements.dataStatus.textContent = message;
  elements.statusDot.className = `status-dot ${mode}`;
}

function clearChart(container) {
  container.innerHTML = "";
}

function renderEmpty(container, message) {
  container.innerHTML = `
    <div class="empty-state">
      <p>${escapeHTML(message)}</p>
    </div>
  `;
}

function showFatalMessage(message) {
  [
    "#scatter-chart",
    "#genre-chart",
    "#timeline-chart",
    "#studio-chart",
    "#heatmap-chart",
    "#network-chart"
  ].forEach((selector) => {
    const container = document.querySelector(selector);

    if (container) {
      renderEmpty(
        container,
        `The visualization could not be loaded. ${message}`
      );
    }
  });
}

function showTooltip(event, html) {
  elements.tooltip.innerHTML = html;
  elements.tooltip.classList.add("visible");
  elements.tooltip.setAttribute("aria-hidden", "false");
  moveTooltip(event);
}

function moveTooltip(event) {
  const padding = 16;
  const tooltipRect = elements.tooltip.getBoundingClientRect();

  let left = event.clientX + padding;
  let top = event.clientY + padding;

  if (left + tooltipRect.width > window.innerWidth - padding) {
    left = event.clientX - tooltipRect.width - padding;
  }

  if (top + tooltipRect.height > window.innerHeight - padding) {
    top = event.clientY - tooltipRect.height - padding;
  }

  elements.tooltip.style.left = `${left}px`;
  elements.tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  elements.tooltip.classList.remove("visible");
  elements.tooltip.setAttribute("aria-hidden", "true");
}

function formatNumber(value) {
  return Number.isFinite(value)
    ? numberFormatter.format(value)
    : "N/A";
}

function formatDate(value) {
  if (!value) {
    return "at an unknown time";
  }

  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function humanize(value) {
  if (!value) {
    return "Unknown";
  }

  return String(value)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truncate(value, maximumLength) {
  const text = String(value || "");

  return text.length > maximumLength
    ? `${text.slice(0, maximumLength - 1)}…`
    : text;
}

function debounce(callback, delay) {
  let timeout;

  return (...args) => {
    window.clearTimeout(timeout);

    timeout = window.setTimeout(() => {
      callback(...args);
    }, delay);
  };
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value);
}
