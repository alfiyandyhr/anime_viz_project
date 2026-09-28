"use strict";

const state = {
  data: null,
  filteredAnime: [],
  genreColor: null,
  networkSimulation: null,
  activeChapter: "intro",
  tablePage: 0,
  tablePageSize: 25
};

// Which render functions belong to which story chapter. Charts are drawn
// lazily — only when their chapter becomes visible — because D3 sizes each
// chart from its container's width, which is 0 while a panel is display:none.
const CHAPTERS = {
  intro: [],
  reception: [renderKPIs, renderReceptionCallout, renderScatterplot],
  content: [renderGenreChart, renderTimeline],
  creators: [renderStudioChart, renderHeatmap, renderNetwork],
  explorer: [renderInsights, renderAnimeTable]
};

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
  genreMetric: document.querySelector("#genre-metric"),
  actorSearch: document.querySelector("#actor-search"),
  networkWeight: document.querySelector("#network-weight"),
  networkWeightOutput: document.querySelector("#network-weight-output"),
  networkSummary: document.querySelector("#network-summary"),
  tableSort: document.querySelector("#table-sort"),
  tablePageSize: document.querySelector("#table-page-size"),
  tablePagination: document.querySelector("#table-pagination"),
  tableBody: document.querySelector("#anime-table-body"),
  tableNote: document.querySelector("#table-note"),
  tooltip: document.querySelector("#tooltip"),
  drawer: document.querySelector("#detail-drawer"),
  drawerContent: document.querySelector("#drawer-content"),
  drawerOverlay: document.querySelector("#drawer-overlay"),
  closeDrawer: document.querySelector("#close-drawer")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindControls();
  await loadDashboard(false);
}

function bindControls() {
  const filterElements = [
    elements.searchInput,
    elements.genreFilter,
    elements.studioFilter,
    elements.formatFilter,
    elements.yearFrom,
    elements.yearTo,
    elements.scoreFilter
  ];

  filterElements.forEach((element) => {
    element.addEventListener("input", () => {
      elements.scoreOutput.value = elements.scoreFilter.value;
      applyFilters();
    });
  });

  elements.genreMetric.addEventListener("change", renderGenreChart);

  elements.actorSearch.addEventListener("input", renderNetwork);

  elements.networkWeight.addEventListener("input", () => {
    elements.networkWeightOutput.value = elements.networkWeight.value;
    renderNetwork();
  });

  elements.tableSort.addEventListener("change", () => {
    state.tablePage = 0;
    renderAnimeTable();
  });

  elements.tablePageSize.addEventListener("change", () => {
    state.tablePageSize = Number(elements.tablePageSize.value);
    state.tablePage = 0;
    renderAnimeTable();
  });

  elements.tablePagination.addEventListener("click", (event) => {
    const btn = event.target.closest(".page-btn");
    if (!btn || btn.disabled) {
      return;
    }
    state.tablePage = Number(btn.dataset.page);
    renderAnimeTable();
    document.querySelector(".table-wrapper")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  elements.resetFilters.addEventListener("click", resetFilters);

  elements.closeDrawer.addEventListener("click", closeDrawer);
  elements.drawerOverlay.addEventListener("click", closeDrawer);

  // Any element with data-goto="<chapter>" switches the active chapter.
  document.querySelectorAll("[data-goto]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      activateChapter(element.dataset.goto);
    });
  });

  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);

    if (id && id !== state.activeChapter && CHAPTERS[id]) {
      activateChapter(id);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDrawer();
    }
  });

  window.addEventListener("resize", debounce(() => {
    if (state.data) {
      renderChapter(state.activeChapter);
    }
  }, 250));
}

function initialChapter() {
  const id = location.hash.slice(1);
  return CHAPTERS[id] ? id : "intro";
}

// UI-only: reveal one chapter and update the rail. Does not draw charts.
function setActiveChapter(id) {
  state.activeChapter = id;
  document.body.dataset.chapter = id;

  document.querySelectorAll(".chapter").forEach((section) => {
    section.classList.toggle(
      "is-active",
      section.dataset.chapter === id
    );
  });

  document.querySelectorAll(".rail-link").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.goto === id);
  });

  if (location.hash.slice(1) !== id) {
    try {
      history.replaceState(null, "", `#${id}`);
    } catch (error) {
      location.hash = id;
    }
  }
}

// Switch chapters in response to a click: reveal it, draw it, scroll to top.
function activateChapter(id) {
  if (!CHAPTERS[id]) {
    id = "intro";
  }

  setActiveChapter(id);
  renderChapter(id);

  const stage = document.querySelector(".stage");
  if (stage) {
    stage.scrollTo({ top: 0, behavior: "smooth" });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Draw only the charts that live in the given (now-visible) chapter.
function renderChapter(id) {
  if (!state.data) {
    return;
  }

  (CHAPTERS[id] || []).forEach((render) => render());
}

async function loadDashboard(forceRefresh) {
  setStatus(
    "Loading anime industry data…",
    "loading"
  );

  try {
    const response = await fetch("data.json", {
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

    elements.scoreOutput.value = elements.scoreFilter.value;
    elements.networkWeightOutput.value = elements.networkWeight.value;

    setActiveChapter(initialChapter());
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
  elements.actorSearch.value = "";
  elements.networkWeight.value = 1;
  elements.networkWeightOutput.value = 1;

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

  // The filter bar persists across chapters, so its summary always updates;
  // the charts themselves are redrawn only for the chapter in view.
  renderFilterSummary();
  renderChapter(state.activeChapter);
}

function renderFilterSummary() {
  const total = state.data.anime.length;
  const visible = state.filteredAnime.length;

  elements.filterSummary.textContent =
    `${numberFormatter.format(visible)} of `
    + `${numberFormatter.format(total)} sampled anime are visible.`;
}

function renderKPIs() {
  const anime = state.filteredAnime;

  const scores = anime
    .map((item) => item.average_score)
    .filter(Number.isFinite);

  const studios = new Set(
    anime.flatMap((item) => item.studio_names || [])
  );

  const actors = new Set(
    anime.flatMap((item) => (
      (item.voice_actors || []).map((actor) => actor.id)
    ))
  );

  document.querySelector("#kpi-count").textContent =
    numberFormatter.format(anime.length);

  document.querySelector("#kpi-score").textContent =
    scores.length ? d3.mean(scores).toFixed(1) : "N/A";

  document.querySelector("#kpi-popularity").textContent =
    compactFormatter.format(d3.sum(anime, (item) => item.popularity || 0));

  document.querySelector("#kpi-studios").textContent =
    numberFormatter.format(studios.size);

  document.querySelector("#kpi-actors").textContent =
    numberFormatter.format(actors.size);
}

function renderInsights() {
  const container = document.querySelector("#insight-cards");
  const anime = state.filteredAnime;

  if (!anime.length) {
    container.innerHTML = `
      <article class="insight-card">
        <strong>No titles match the current filters.</strong>
        <p>Reset or broaden the controls to continue exploring.</p>
      </article>
    `;
    return;
  }

  const mostPopular = d3.greatest(anime, (item) => item.popularity || 0);
  const highestRated = d3.greatest(
    anime.filter((item) => Number.isFinite(item.average_score)),
    (item) => item.average_score
  );

  const genreStats = computeGenreStats(anime);
  const recurringGenres = genreStats.filter((genre) => genre.count >= 3);
  const bestGenre = d3.greatest(
    recurringGenres.filter((genre) => Number.isFinite(genre.averageScore)),
    (genre) => genre.averageScore
  );

  const studioStats = computeStudioStats(anime);
  const largestStudio = d3.greatest(
    studioStats,
    (studio) => studio.totalPopularity
  );

  const actorCounter = d3.rollups(
    anime.flatMap((item) => (
      item.voice_actors.map((actor) => ({
        actorId: actor.id,
        name: actor.name,
        animeId: item.id
      }))
    )),
    (rows) => new Set(rows.map((row) => row.animeId)).size,
    (row) => `${row.actorId}|${row.name}`
  );

  const topActorEntry = d3.greatest(actorCounter, (entry) => entry[1]);
  const topActorName = topActorEntry
    ? topActorEntry[0].split("|").slice(1).join("|")
    : "N/A";

  const correlation = calculateCorrelation(
    anime
      .filter((item) => (
        item.popularity > 0
        && Number.isFinite(item.average_score)
      ))
      .map((item) => [
        Math.log10(item.popularity),
        item.average_score
      ])
  );

  const insights = [
    {
      label: "Most popular",
      value: mostPopular?.title || "N/A",
      detail: `${formatNumber(mostPopular?.popularity)} list users`
    },
    {
      label: "Highest rated",
      value: highestRated?.title || "N/A",
      detail: highestRated
        ? `${highestRated.average_score}/100`
        : "No scored titles"
    },
    {
      label: "Top recurring genre",
      value: bestGenre?.genre || "N/A",
      detail: bestGenre
        ? `${bestGenre.averageScore.toFixed(1)}/100 across `
          + `${bestGenre.count} titles`
        : "At least three titles required"
    },
    {
      label: "Largest studio reach",
      value: largestStudio?.studio || "N/A",
      detail: largestStudio
        ? `${compactFormatter.format(largestStudio.totalPopularity)} `
          + "combined popularity"
        : "No studio data"
    },
    {
      label: "Most represented actor",
      value: topActorName,
      detail: topActorEntry
        ? `${topActorEntry[1]} filtered anime`
        : "No cast data"
    },
    {
      label: "Score–popularity correlation",
      value: correlation === null
        ? "N/A"
        : `r = ${correlation.toFixed(2)}`,
      detail: "Pearson correlation using log popularity"
    }
  ];

  container.innerHTML = insights.map((insight) => `
    <article class="insight-card">
      <span>${escapeHTML(insight.label)}</span>
      <strong>${escapeHTML(insight.value)}</strong>
      <p>${escapeHTML(insight.detail)}</p>
    </article>
  `).join("");
}

function renderScatterplot() {
  const container = document.querySelector("#scatter-chart");
  const data = state.filteredAnime.filter((item) => (
    item.popularity > 0
    && Number.isFinite(item.average_score)
  ));

  clearChart(container);

  if (!data.length) {
    renderEmpty(container, "No scored anime match the current filters.");
    return;
  }

  const width = Math.max(container.clientWidth, 320);
  const height = Math.max(container.clientHeight, 430);
  const margin = { top: 28, right: 28, bottom: 58, left: 62 };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("aria-label", "Score versus popularity scatterplot");

  const xExtent = d3.extent(data, (item) => item.popularity);
  const yExtent = d3.extent(data, (item) => item.average_score);

  const x = d3.scaleLog()
    .domain([
      Math.max(1, xExtent[0] * 0.75),
      xExtent[1] * 1.25
    ])
    .range([margin.left, width - margin.right]);

  const y = d3.scaleLinear()
    .domain([
      Math.max(0, Math.floor((yExtent[0] - 5) / 5) * 5),
      Math.min(100, Math.ceil((yExtent[1] + 4) / 5) * 5)
    ])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const radius = d3.scaleSqrt()
    .domain([0, d3.max(data, (item) => item.favourites || 0) || 1])
    .range([4, 20]);

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(7)
        .tickSize(-(height - margin.top - margin.bottom))
        .tickFormat("")
    );

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .ticks(6)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(7, "~s")
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(6));

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height - 12)
    .attr("text-anchor", "middle")
    .text("Popularity — AniList users, logarithmic scale");

  svg.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + height - margin.bottom) / 2)
    .attr("y", 16)
    .attr("text-anchor", "middle")
    .text("Average score / 100");

  const regression = linearRegression(
    data.map((item) => [
      Math.log10(item.popularity),
      item.average_score
    ])
  );

  if (regression) {
    const regressionPoints = x.domain().map((popularity) => ({
      popularity,
      score:
        regression.intercept
        + regression.slope * Math.log10(popularity)
    }));

    svg.append("path")
      .datum(regressionPoints)
      .attr("fill", "none")
      .attr("stroke", "rgba(255,255,255,0.42)")
      .attr("stroke-dasharray", "5 5")
      .attr("stroke-width", 1.4)
      .attr(
        "d",
        d3.line()
          .x((item) => x(item.popularity))
          .y((item) => y(item.score))
      );
  }

  const dots = svg.append("g")
    .selectAll("circle")
    .data(data, (item) => item.id)
    .join("circle")
    .attr("cx", (item) => x(item.popularity))
    .attr("cy", (item) => y(item.average_score))
    .attr("r", (item) => radius(item.favourites || 0))
    .attr("fill", (item) => state.genreColor(item.primary_genre))
    .attr("fill-opacity", 0.72)
    .attr("stroke", "rgba(255,255,255,0.72)")
    .attr("stroke-width", 0.8)
    .style("cursor", "pointer")
    .on("mouseenter", function (event, item) {
      d3.select(this)
        .attr("fill-opacity", 1)
        .attr("stroke-width", 2);

      showTooltip(event, `
        <strong>${escapeHTML(item.title)}</strong>
        <span>
          Score: ${item.average_score}/100<br>
          Popularity: ${formatNumber(item.popularity)}<br>
          Favourites: ${formatNumber(item.favourites)}<br>
          Genre: ${escapeHTML(item.primary_genre)}<br>
          Studio: ${escapeHTML(item.studio_names.join(", "))}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", function () {
      d3.select(this)
        .attr("fill-opacity", 0.72)
        .attr("stroke-width", 0.8);

      hideTooltip();
    })
    .on("click", (_, item) => openAnimeDetail(item));

  dots.append("title")
    .text((item) => item.title);

  renderGenreLegend(svg, data, width, margin);
}

function renderGenreLegend(svg, data, width, margin) {
  const genres = d3.rollups(
    data,
    (rows) => rows.length,
    (item) => item.primary_genre
  )
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 5)
    .map((item) => item[0]);

  const legend = svg.append("g")
    .attr(
      "transform",
      `translate(${Math.max(margin.left, width - margin.right - 145)},`
      + `${margin.top + 4})`
    );

  genres.forEach((genre, index) => {
    const row = legend.append("g")
      .attr("transform", `translate(0,${index * 19})`);

    row.append("circle")
      .attr("r", 5)
      .attr("fill", state.genreColor(genre));

    row.append("text")
      .attr("x", 10)
      .attr("y", 4)
      .attr("fill", "#aab3cf")
      .attr("font-size", 10)
      .text(truncate(genre, 18));
  });
}

function renderGenreChart() {
  const container = document.querySelector("#genre-chart");

  if (!state.data) {
    return;
  }

  clearChart(container);

  const metric = elements.genreMetric.value;
  const data = computeGenreStats(state.filteredAnime)
    .filter((item) => (
      metric !== "score" || Number.isFinite(item.averageScore)
    ))
    .sort((a, b) => {
      if (metric === "score") {
        return d3.descending(a.averageScore, b.averageScore);
      }

      if (metric === "popularity") {
        return d3.descending(a.totalPopularity, b.totalPopularity);
      }

      return d3.descending(a.count, b.count);
    })
    .slice(0, 12);

  if (!data.length) {
    renderEmpty(container, "No genre data match the current filters.");
    return;
  }

  const width = Math.max(container.clientWidth, 300);
  const height = Math.max(container.clientHeight, 370);
  const margin = { top: 12, right: 35, bottom: 35, left: 105 };

  const metricValue = (item) => {
    if (metric === "score") {
      return item.averageScore;
    }

    if (metric === "popularity") {
      return item.totalPopularity;
    }

    return item.count;
  };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, metricValue) || 1])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map((item) => item.genre))
    .range([margin.top, height - margin.bottom])
    .padding(0.23);

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(4)
        .tickSize(-(height - margin.top - margin.bottom))
        .tickFormat("")
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(4)
        .tickFormat((value) => (
          metric === "popularity"
            ? compactFormatter.format(value)
            : value
        ))
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickSize(0))
    .call((group) => group.select(".domain").remove());

  svg.append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", margin.left)
    .attr("y", (item) => y(item.genre))
    .attr("height", y.bandwidth())
    .attr("width", (item) => x(metricValue(item)) - margin.left)
    .attr("rx", 5)
    .attr("fill", (item) => state.genreColor(item.genre))
    .attr("fill-opacity", 0.8)
    .style("cursor", "pointer")
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>${escapeHTML(item.genre)}</strong>
        <span>
          Titles: ${item.count}<br>
          Average score:
          ${Number.isFinite(item.averageScore)
            ? item.averageScore.toFixed(1)
            : "N/A"}<br>
          Total popularity:
          ${formatNumber(item.totalPopularity)}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip)
    .on("click", (_, item) => {
      elements.genreFilter.value = item.genre;
      applyFilters();
    });

  svg.append("g")
    .selectAll("text.value")
    .data(data)
    .join("text")
    .attr("class", "value")
    .attr("x", (item) => x(metricValue(item)) + 5)
    .attr("y", (item) => y(item.genre) + y.bandwidth() / 2 + 4)
    .attr("fill", "#d9def0")
    .attr("font-size", 10)
    .text((item) => {
      const value = metricValue(item);

      if (metric === "score") {
        return value.toFixed(1);
      }

      if (metric === "popularity") {
        return compactFormatter.format(value);
      }

      return value;
    });
}

function renderTimeline() {
  const container = document.querySelector("#timeline-chart");
  clearChart(container);

  const data = computeTimeline(state.filteredAnime);

  if (!data.length) {
    renderEmpty(container, "No release-year data match the filters.");
    return;
  }

  const width = Math.max(container.clientWidth, 480);
  const height = Math.max(container.clientHeight, 370);
  const margin = { top: 24, right: 60, bottom: 52, left: 58 };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const x = d3.scaleBand()
    .domain(data.map((item) => item.year))
    .range([margin.left, width - margin.right])
    .padding(0.18);

  const yCount = d3.scaleLinear()
    .domain([0, d3.max(data, (item) => item.count) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const scoreExtent = d3.extent(
    data.filter((item) => Number.isFinite(item.averageScore)),
    (item) => item.averageScore
  );

  const yScore = d3.scaleLinear()
    .domain(
      scoreExtent[0] === undefined
        ? [0, 100]
        : [
          Math.max(0, scoreExtent[0] - 5),
          Math.min(100, scoreExtent[1] + 5)
        ]
    )
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(yCount)
        .ticks(5)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    );

  svg.append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", (item) => x(item.year))
    .attr("y", (item) => yCount(item.count))
    .attr("width", x.bandwidth())
    .attr("height", (item) => (
      height - margin.bottom - yCount(item.count)
    ))
    .attr("rx", 3)
    .attr("fill", "rgba(157,123,255,0.42)")
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>${item.year}</strong>
        <span>
          Sampled titles: ${item.count}<br>
          Average score:
          ${Number.isFinite(item.averageScore)
            ? item.averageScore.toFixed(1)
            : "N/A"}<br>
          Total popularity:
          ${formatNumber(item.totalPopularity)}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);

  const lineData = data.filter((item) => Number.isFinite(item.averageScore));

  svg.append("path")
    .datum(lineData)
    .attr("fill", "none")
    .attr("stroke", "#43d9e6")
    .attr("stroke-width", 2.5)
    .attr(
      "d",
      d3.line()
        .x((item) => x(item.year) + x.bandwidth() / 2)
        .y((item) => yScore(item.averageScore))
    );

  svg.append("g")
    .selectAll("circle")
    .data(lineData)
    .join("circle")
    .attr("cx", (item) => x(item.year) + x.bandwidth() / 2)
    .attr("cy", (item) => yScore(item.averageScore))
    .attr("r", 3.5)
    .attr("fill", "#43d9e6")
    .attr("stroke", "#08101c")
    .attr("stroke-width", 1.5);

  const tickStep = Math.max(1, Math.ceil(data.length / 12));
  const visibleYears = data
    .map((item) => item.year)
    .filter((_, index) => index % tickStep === 0);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .tickValues(visibleYears)
        .tickSizeOuter(0)
    )
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .attr("text-anchor", "end");

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(yCount).ticks(5));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${width - margin.right},0)`)
    .call(d3.axisRight(yScore).ticks(5));

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", margin.left)
    .attr("y", 13)
    .text("Title count");

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", width - margin.right)
    .attr("y", 13)
    .attr("text-anchor", "end")
    .attr("fill", "#43d9e6")
    .text("Average score");
}

function renderStudioChart() {
  const container = document.querySelector("#studio-chart");
  clearChart(container);

  const data = computeStudioStats(state.filteredAnime)
    .filter((item) => Number.isFinite(item.averageScore))
    .sort((a, b) => d3.descending(
      a.totalPopularity,
      b.totalPopularity
    ))
    .slice(0, 15);

  if (!data.length) {
    renderEmpty(container, "No studio score data match the filters.");
    return;
  }

  const width = Math.max(container.clientWidth, 320);
  const height = Math.max(container.clientHeight, 480);
  const margin = { top: 15, right: 35, bottom: 50, left: 120 };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const scoreExtent = d3.extent(data, (item) => item.averageScore);

  const x = d3.scaleLinear()
    .domain([
      Math.max(0, scoreExtent[0] - 5),
      Math.min(100, scoreExtent[1] + 4)
    ])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map((item) => item.studio))
    .range([margin.top, height - margin.bottom])
    .padding(0.3);

  const radius = d3.scaleSqrt()
    .domain([1, d3.max(data, (item) => item.count) || 1])
    .range([4, 12]);

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(5)
        .tickSize(-(height - margin.top - margin.bottom))
        .tickFormat("")
    );

  svg.append("g")
    .selectAll("line")
    .data(data)
    .join("line")
    .attr("x1", x.range()[0])
    .attr("x2", (item) => x(item.averageScore))
    .attr("y1", (item) => y(item.studio) + y.bandwidth() / 2)
    .attr("y2", (item) => y(item.studio) + y.bandwidth() / 2)
    .attr("stroke", "rgba(255,255,255,0.16)")
    .attr("stroke-width", 2);

  svg.append("g")
    .selectAll("circle")
    .data(data)
    .join("circle")
    .attr("cx", (item) => x(item.averageScore))
    .attr("cy", (item) => y(item.studio) + y.bandwidth() / 2)
    .attr("r", (item) => radius(item.count))
    .attr("fill", (item) => state.genreColor(item.dominantGenre))
    .attr("stroke", "white")
    .attr("stroke-width", 1)
    .style("cursor", "pointer")
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>${escapeHTML(item.studio)}</strong>
        <span>
          Titles: ${item.count}<br>
          Average score: ${item.averageScore.toFixed(1)}<br>
          Popularity: ${formatNumber(item.totalPopularity)}<br>
          Dominant genre: ${escapeHTML(item.dominantGenre)}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip)
    .on("click", (_, item) => {
      elements.studioFilter.value = item.studio;
      applyFilters();
    });

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .tickFormat((value) => truncate(value, 18))
        .tickSize(0)
    )
    .call((group) => group.select(".domain").remove());

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height - 12)
    .attr("text-anchor", "middle")
    .text("Average audience score / 100");
}

function renderHeatmap() {
  const container = document.querySelector("#heatmap-chart");
  clearChart(container);

  const anime = state.filteredAnime;

  if (!anime.length) {
    renderEmpty(container, "No studio–genre data match the filters.");
    return;
  }

  const topStudios = computeStudioStats(anime)
    .sort((a, b) => d3.descending(a.count, b.count))
    .slice(0, 11)
    .map((item) => item.studio);

  const topGenres = computeGenreStats(anime)
    .sort((a, b) => d3.descending(a.count, b.count))
    .slice(0, 10)
    .map((item) => item.genre);

  const cells = [];

  topStudios.forEach((studio) => {
    topGenres.forEach((genre) => {
      const matchingAnime = anime.filter((item) => (
        item.studio_names.includes(studio)
        && item.genres.includes(genre)
      ));

      cells.push({
        studio,
        genre,
        count: matchingAnime.length,
        titles: matchingAnime.map((item) => item.title)
      });
    });
  });

  const width = Math.max(container.clientWidth, 850);
  const height = Math.max(container.clientHeight, 540);
  const margin = { top: 135, right: 25, bottom: 35, left: 130 };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const x = d3.scaleBand()
    .domain(topGenres)
    .range([margin.left, width - margin.right])
    .padding(0.08);

  const y = d3.scaleBand()
    .domain(topStudios)
    .range([margin.top, height - margin.bottom])
    .padding(0.08);

  const color = d3.scaleSequential()
    .domain([0, d3.max(cells, (item) => item.count) || 1])
    .interpolator(d3.interpolatePurples);

  svg.append("g")
    .selectAll("rect")
    .data(cells)
    .join("rect")
    .attr("x", (item) => x(item.genre))
    .attr("y", (item) => y(item.studio))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("rx", 5)
    .attr("fill", (item) => (
      item.count === 0
        ? "rgba(255,255,255,0.025)"
        : color(item.count)
    ))
    .attr("stroke", "rgba(255,255,255,0.055)")
    .style("cursor", (item) => item.count ? "pointer" : "default")
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>
          ${escapeHTML(item.studio)} × ${escapeHTML(item.genre)}
        </strong>
        <span>
          ${item.count} matching title${item.count === 1 ? "" : "s"}<br>
          ${escapeHTML(item.titles.slice(0, 4).join(", ") || "No titles")}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip)
    .on("click", (_, item) => {
      if (!item.count) {
        return;
      }

      elements.genreFilter.value = item.genre;
      elements.studioFilter.value = item.studio;
      applyFilters();
    });

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${margin.top})`)
    .call(d3.axisTop(x).tickSize(0))
    .call((group) => group.select(".domain").remove())
    .selectAll("text")
    .attr("transform", "rotate(-38)")
    .attr("text-anchor", "start")
    .attr("dx", "0.5em")
    .attr("dy", "-0.25em");

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .tickFormat((value) => truncate(value, 22))
        .tickSize(0)
    )
    .call((group) => group.select(".domain").remove());
}

function renderNetwork() {
  const container = document.querySelector("#network-chart");

  if (!state.data) {
    return;
  }

  if (state.networkSimulation) {
    state.networkSimulation.stop();
    state.networkSimulation = null;
  }

  clearChart(container);

  const visibleAnimeIds = new Set(
    state.filteredAnime.map((item) => item.id)
  );

  const minimumWeight = Number(elements.networkWeight.value);
  const actorSearch = elements.actorSearch.value.trim().toLowerCase();

  let nodes = state.data.network.nodes
    .map((node) => {
      const visibleShowIds = node.show_ids.filter((id) => (
        visibleAnimeIds.has(id)
      ));

      return {
        ...node,
        filteredCount: visibleShowIds.length,
        filteredShowIds: visibleShowIds
      };
    })
    .filter((node) => node.filteredCount > 0)
    .sort((a, b) => d3.descending(
      a.filteredCount,
      b.filteredCount
    ))
    .slice(0, 70);

  const nodeIds = new Set(nodes.map((node) => node.id));

  let links = state.data.network.links
    .map((link) => {
      const matchingShows = link.show_ids.filter((id) => (
        visibleAnimeIds.has(id)
      ));

      return {
        ...link,
        source: link.source,
        target: link.target,
        filteredWeight: matchingShows.length,
        filteredShowIds: matchingShows,
        filteredShows: link.shows.filter((_, index) => (
          visibleAnimeIds.has(link.show_ids[index])
        ))
      };
    })
    .filter((link) => (
      link.filteredWeight >= minimumWeight
      && nodeIds.has(link.source)
      && nodeIds.has(link.target)
    ))
    .sort((a, b) => d3.descending(
      a.filteredWeight,
      b.filteredWeight
    ))
    .slice(0, 450);

  const connectedNodeIds = new Set(
    links.flatMap((link) => [link.source, link.target])
  );

  nodes = nodes.filter((node) => (
    connectedNodeIds.has(node.id)
    || node.filteredCount > 1
    || (
      actorSearch
      && node.name.toLowerCase().includes(actorSearch)
    )
  ));

  const finalNodeIds = new Set(nodes.map((node) => node.id));

  links = links.filter((link) => (
    finalNodeIds.has(link.source)
    && finalNodeIds.has(link.target)
  ));

  elements.networkSummary.textContent =
    `${nodes.length} actors and ${links.length} co-starring relationships `
    + "under the current filters.";

  if (!nodes.length) {
    renderEmpty(
      container,
      "No voice-actor relationships match these filters."
    );
    return;
  }

  const width = Math.max(container.clientWidth, 500);
  const height = Math.max(container.clientHeight, 650);

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const root = svg.append("g");

  svg.call(
    d3.zoom()
      .scaleExtent([0.35, 4])
      .on("zoom", (event) => {
        root.attr("transform", event.transform);
      })
  );

  const radius = d3.scaleSqrt()
    .domain([1, d3.max(nodes, (node) => node.filteredCount) || 1])
    .range([6, 23]);

  const linkWidth = d3.scaleLinear()
    .domain([1, d3.max(links, (link) => link.filteredWeight) || 1])
    .range([0.7, 5]);

  const link = root.append("g")
    .attr("stroke", "rgba(170,179,207,0.25)")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", (item) => linkWidth(item.filteredWeight))
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>Shared anime: ${item.filteredWeight}</strong>
        <span>${escapeHTML(item.shows.slice(0, 6).join(", "))}</span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);

  const node = root.append("g")
    .selectAll("g")
    .data(nodes, (item) => item.id)
    .join("g")
    .style("cursor", "grab")
    .on("mouseenter", function (event, item) {
      d3.select(this).select("circle")
        .attr("stroke-width", 3);

      showTooltip(event, `
        <strong>${escapeHTML(item.name)}</strong>
        <span>
          Visible anime: ${item.filteredCount}<br>
          Network degree: ${item.degree}<br>
          Main genre: ${escapeHTML(item.primary_genre)}<br>
          ${escapeHTML(item.shows.slice(0, 5).join(", "))}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", function () {
      d3.select(this).select("circle")
        .attr("stroke-width", 1.3);

      hideTooltip();
    })
    .on("click", (_, item) => {
      elements.searchInput.value = item.name;
      applyFilters();
      activateChapter("explorer");
    });

  node.append("circle")
    .attr("r", (item) => radius(item.filteredCount))
    .attr("fill", (item) => state.genreColor(item.primary_genre))
    .attr("fill-opacity", (item) => (
      !actorSearch
      || item.name.toLowerCase().includes(actorSearch)
        ? 0.9
        : 0.17
    ))
    .attr("stroke", (item) => (
      actorSearch
      && item.name.toLowerCase().includes(actorSearch)
        ? "#ffffff"
        : "rgba(255,255,255,0.72)"
    ))
    .attr("stroke-width", (item) => (
      actorSearch
      && item.name.toLowerCase().includes(actorSearch)
        ? 3
        : 1.3
    ));

  node.append("text")
    .attr("x", (item) => radius(item.filteredCount) + 5)
    .attr("y", 3)
    .attr("fill", (item) => (
      !actorSearch
      || item.name.toLowerCase().includes(actorSearch)
      || item.filteredCount >= 2
        ? "#dce2f8"
        : "transparent"
    ))
    .attr("font-size", 9)
    .attr("paint-order", "stroke")
    .attr("stroke", "#0b1020")
    .attr("stroke-width", 3)
    .text((item) => truncate(item.name, 23));

  state.networkSimulation = d3.forceSimulation(nodes)
    .force(
      "link",
      d3.forceLink(links)
        .id((item) => item.id)
        .distance((item) => 95 - Math.min(item.filteredWeight, 4) * 8)
        .strength(0.35)
    )
    .force("charge", d3.forceManyBody().strength(-150))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force(
      "collision",
      d3.forceCollide()
        .radius((item) => radius(item.filteredCount) + 8)
    )
    .force("x", d3.forceX(width / 2).strength(0.035))
    .force("y", d3.forceY(height / 2).strength(0.035))
    .on("tick", () => {
      link
        .attr("x1", (item) => item.source.x)
        .attr("y1", (item) => item.source.y)
        .attr("x2", (item) => item.target.x)
        .attr("y2", (item) => item.target.y);

      node.attr(
        "transform",
        (item) => `translate(${item.x},${item.y})`
      );
    });

  node.call(
    d3.drag()
      .on("start", (event, item) => {
        if (!event.active) {
          state.networkSimulation.alphaTarget(0.25).restart();
        }

        item.fx = item.x;
        item.fy = item.y;
      })
      .on("drag", (event, item) => {
        item.fx = event.x;
        item.fy = event.y;
      })
      .on("end", (event, item) => {
        if (!event.active) {
          state.networkSimulation.alphaTarget(0);
        }

        item.fx = null;
        item.fy = null;
      })
  );
}

function renderAnimeTable() {
  const sortMode = elements.tableSort.value;
  const sorted = [...state.filteredAnime];

  sorted.sort((a, b) => {
    switch (sortMode) {
      case "score":
        return d3.descending(
          a.average_score ?? -1,
          b.average_score ?? -1
        );

      case "favourites":
        return d3.descending(a.favourites || 0, b.favourites || 0);

      case "year-desc":
        return d3.descending(a.year || 0, b.year || 0);

      case "year-asc":
        return d3.ascending(a.year || Infinity, b.year || Infinity);

      case "title":
        return d3.ascending(a.title, b.title);

      case "popularity":
      default:
        return d3.descending(a.popularity || 0, b.popularity || 0);
    }
  });

  const pageSize = state.tablePageSize;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  if (state.tablePage >= totalPages) {
    state.tablePage = Math.max(0, totalPages - 1);
  }

  const pageStart = state.tablePage * pageSize;
  const displayed = sorted.slice(pageStart, pageStart + pageSize);

  elements.tableBody.innerHTML = displayed.map((anime) => `
    <tr data-anime-id="${anime.id}" tabindex="0">
      <td>
        <div class="anime-cell">
          <img
            src="${escapeAttribute(anime.cover.medium || anime.cover.large || "")}"
            alt=""
            loading="lazy"
          >
          <div>
            <strong>${escapeHTML(anime.title)}</strong>
            <small>${escapeHTML(anime.titles.romaji || "")}</small>
          </div>
        </div>
      </td>
      <td>${anime.year || "—"}</td>
      <td>${escapeHTML(humanize(anime.format))}</td>
      <td>${escapeHTML(anime.studio_names.join(", "))}</td>
      <td>
        <span class="score-pill">
          ${Number.isFinite(anime.average_score)
            ? anime.average_score
            : "N/A"}
        </span>
      </td>
      <td>${formatNumber(anime.popularity)}</td>
      <td>
        <div class="genre-list">
          ${anime.genres.slice(0, 3).map((genre) => (
            `<span class="tag">${escapeHTML(genre)}</span>`
          )).join("")}
        </div>
      </td>
    </tr>
  `).join("");

  elements.tableBody.querySelectorAll("tr").forEach((row) => {
    const openRow = () => {
      const animeId = Number(row.dataset.animeId);
      const anime = state.data.anime.find((item) => item.id === animeId);

      if (anime) {
        openAnimeDetail(anime);
      }
    };

    row.addEventListener("click", openRow);

    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        openRow();
      }
    });
  });

  renderTablePagination(sorted.length);

  const pageEnd = pageStart + displayed.length;
  elements.tableNote.textContent = sorted.length > 0
    ? `Showing ${pageStart + 1}–${pageEnd} of ${sorted.length} visible title${sorted.length === 1 ? "" : "s"}.`
    : "";
}

function renderTablePagination(totalItems) {
  const container = elements.tablePagination;
  const pageSize = state.tablePageSize;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const current = state.tablePage;
  const delta = 2;

  // Collect page indices to show, then insert ellipsis markers
  const pageIndices = [];

  for (let i = 0; i < totalPages; i++) {
    if (
      i === 0
      || i === totalPages - 1
      || (i >= current - delta && i <= current + delta)
    ) {
      pageIndices.push(i);
    }
  }

  const items = [];
  let prev = -1;

  for (const page of pageIndices) {
    if (page - prev > 1) {
      items.push("ellipsis");
    }
    items.push(page);
    prev = page;
  }

  const btnHtml = (page, label, extra = "") => {
    const disabled = (page < 0 || page >= totalPages) ? "disabled" : "";
    return `<button class="page-btn${extra}" data-page="${page}" ${disabled}>${label}</button>`;
  };

  const pageButtons = items.map((item) => {
    if (item === "ellipsis") {
      return `<span class="page-ellipsis">…</span>`;
    }
    const start = item * pageSize + 1;
    const end = Math.min((item + 1) * pageSize, totalItems);
    const active = item === current ? " is-active" : "";
    return btnHtml(item, item + 1, active);
  });

  container.innerHTML = [
    btnHtml(current - 1, "‹"),
    ...pageButtons,
    btnHtml(current + 1, "›")
  ].join("");
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

// Chapter 1 verdict: answers "are the most popular also the highest rated?"
// by comparing the two title extremes and reporting the score–popularity
// correlation across the filtered sample.
function renderReceptionCallout() {
  const container = document.querySelector("#reception-callout");

  if (!container) {
    return;
  }

  const anime = state.filteredAnime;

  if (!anime.length) {
    container.innerHTML = `
      <article class="callout-card">
        <strong>No titles match the current filters.</strong>
        <p>Broaden the filters above to continue the story.</p>
      </article>
    `;
    return;
  }

  const mostPopular = d3.greatest(anime, (item) => item.popularity || 0);

  const scored = anime.filter((item) => Number.isFinite(item.average_score));
  const highestRated = d3.greatest(scored, (item) => item.average_score);

  const correlation = calculateCorrelation(
    anime
      .filter((item) => (
        item.popularity > 0
        && Number.isFinite(item.average_score)
      ))
      .map((item) => [
        Math.log10(item.popularity),
        item.average_score
      ])
  );

  const sameTitle = mostPopular
    && highestRated
    && mostPopular.id === highestRated.id;

  let verdict;
  if (correlation === null) {
    verdict = "Not enough scored titles to judge.";
  } else if (Math.abs(correlation) < 0.2) {
    verdict = "Barely — fame and quality track each other only weakly here.";
  } else if (correlation >= 0.2) {
    verdict = "Somewhat — more popular titles do tend to score higher.";
  } else {
    verdict = "Inversely — more popular titles tend to score a little lower.";
  }

  container.innerHTML = `
    <article class="callout-card accent">
      <span>Score–popularity correlation</span>
      <strong>${correlation === null ? "N/A" : `r = ${correlation.toFixed(2)}`}</strong>
      <p>${escapeHTML(verdict)}</p>
    </article>

    <article class="callout-card">
      <span>Most popular</span>
      <strong>${escapeHTML(mostPopular?.title || "N/A")}</strong>
      <p>${formatNumber(mostPopular?.popularity)} list users${
        mostPopular && Number.isFinite(mostPopular.average_score)
          ? ` · ${mostPopular.average_score}/100`
          : ""
      }</p>
    </article>

    <article class="callout-card">
      <span>Highest rated</span>
      <strong>${escapeHTML(highestRated?.title || "N/A")}</strong>
      <p>${
        highestRated
          ? `${highestRated.average_score}/100 · ${formatNumber(highestRated.popularity)} list users`
          : "No scored titles"
      }</p>
    </article>

    <article class="callout-card">
      <span>The verdict</span>
      <strong>${sameTitle ? "Same title tops both" : "Crowd favourite ≠ top rated"}</strong>
      <p>${
        sameTitle
          ? "The most-followed title is also the highest-scored under these filters."
          : "The most-watched anime and the best-scored anime are different titles."
      }</p>
    </article>
  `;
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

function computeTimeline(anime) {
  return d3.rollups(
    anime.filter((item) => Number.isFinite(item.year)),
    (rows) => {
      const scores = rows
        .map((item) => item.average_score)
        .filter(Number.isFinite);

      return {
        count: rows.length,
        averageScore: scores.length ? d3.mean(scores) : null,
        totalPopularity: d3.sum(rows, (item) => item.popularity || 0)
      };
    },
    (item) => item.year
  )
    .map(([year, values]) => ({ year, ...values }))
    .sort((a, b) => d3.ascending(a.year, b.year));
}

function linearRegression(points) {
  if (points.length < 2) {
    return null;
  }

  const meanX = d3.mean(points, (point) => point[0]);
  const meanY = d3.mean(points, (point) => point[1]);

  const numerator = d3.sum(
    points,
    (point) => (point[0] - meanX) * (point[1] - meanY)
  );

  const denominator = d3.sum(
    points,
    (point) => (point[0] - meanX) ** 2
  );

  if (!denominator) {
    return null;
  }

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;

  return { slope, intercept };
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
