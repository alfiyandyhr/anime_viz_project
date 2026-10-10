"use strict";

const state = {
  data: null,
  filteredAnime: [],
  genreColor: null,
  networkSimulation: null,
  networkTypes: new Set(["actor", "character", "work"]),
  tablePage: 0,
  tablePageSize: 25
};

// Each page registers only the renderers and controls it owns.
let pageControls = {};
const dataUrl = new URL("../../data.json", document.currentScript.src);
const FILTER_STORAGE_KEY = "aniviz-filters";

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
  await loadDashboard();
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
  if (state.data) pageControls.render?.();
}

function saveFilters() {
  try {
    sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
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
    const saved = JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) || "null");
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
      : false;

    const scoreMatches = minimumScore === 0
      || (
        Number.isFinite(anime.average_score)
        && anime.average_score >= minimumScore
      );

    return (
      (!search || haystack.includes(search))
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

function renderFilterSummary() {
  const total = state.data.anime.length;
  const visible = state.filteredAnime.length;

  elements.filterSummary.textContent =
    `${numberFormatter.format(visible)} of `
    + `${numberFormatter.format(total)} sampled anime are visible.`;
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
