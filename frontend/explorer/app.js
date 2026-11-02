"use strict";

Object.assign(elements, {
  tableSort: document.querySelector("#table-sort"),
  tablePageSize: document.querySelector("#table-page-size"),
  tablePagination: document.querySelector("#table-pagination"),
  tableBody: document.querySelector("#anime-table-body"),
  tableNote: document.querySelector("#table-note")
});

const shortlist = new Set();

function comparisonRows(anime) {
  const ranking = isCohortActive() ? state.cohort.ranking : null;
  const match = ranking?.matches?.find((item) => String(item.id) === String(anime.id));
  const episodes = Number.isFinite(anime.episodes) && anime.episodes > 0 ? anime.episodes : null;
  const duration = Number.isFinite(anime.duration) && anime.duration > 0 ? anime.duration : null;
  return [
    match ? `${match.rank} / ${numberFormatter.format(ranking.total)}` : "–",
    Number.isFinite(match?.score) ? match.score.toFixed(3) : "–",
    `${humanize(anime.format)} / ${anime.year || "Unknown"}`,
    episodes ? `${episodes}${duration ? ` × ${duration} min` : ""}` : "Unknown",
    episodes && duration ? `${formatNumber(episodes * duration)} min` : "Unknown",
    Number.isFinite(anime.average_score) ? `${anime.average_score} / 100` : "Unknown",
    anime.status ? humanize(anime.status) : "Unknown"
  ];
}

function renderComparison() {
  const container = document.querySelector("#comparison-footer");
  const selected = state.data.anime.filter((anime) => shortlist.has(String(anime.id)));
  container.hidden = selected.length < 2;
  document.body.classList.toggle("has-comparison", selected.length >= 2);
  document.querySelector("#shortlist-status").textContent =
    `${selected.length} of 3 shortlisted. Select 2–3 titles to compare; selections stay when you filter or change table pages, while this Explorer page stays open.`;
  if (selected.length < 2) return;
  const values = selected.map(comparisonRows);
  const metrics = ["Similarity rank", "Cosine score", "Format / year", "Episodes", "Estimated total", "AniList score", "Status"];
  container.innerHTML = `
    <div class="comparison-heading"><strong id="comparison-heading">Compare your shortlist</strong>
      <button type="button" class="small-button ghost" id="clear-shortlist">Clear shortlist</button></div>
    <div class="comparison-scroll"><table class="comparison-table" aria-labelledby="comparison-heading">
      <thead><tr><th scope="col">Metric</th>${selected.map((anime) => `<th scope="col">${escapeHTML(anime.title)}</th>`).join("")}</tr></thead>
      <tbody>${metrics.map((label, index) => `<tr><th scope="row">${label}</th>${values.map((rows) => `<td>${escapeHTML(rows[index])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <p>Runtime estimates use episodes × minutes per episode. Missing values remain unknown.</p>`;
  container.querySelector("#clear-shortlist").addEventListener("click", () => {
    shortlist.clear();
    renderAnimeTable();
    renderComparison();
  });
}

function updateShortlistInputs() {
  elements.tableBody.querySelectorAll("[data-shortlist-id]").forEach((input) => {
    input.checked = shortlist.has(input.dataset.shortlistId);
    input.disabled = shortlist.size >= 3 && !input.checked;
  });
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
  const cohortRanks = new Map(isCohortActive()
    ? state.cohort.ids.map((id, index) => [String(id), index + 1]) : []);

  elements.tableBody.innerHTML = displayed.map((anime, index) => `
    <tr data-anime-id="${anime.id}" tabindex="0">
      <td><input type="checkbox" class="shortlist-checkbox" data-shortlist-id="${anime.id}"
        aria-label="Shortlist ${escapeAttribute(anime.title)}"></td>
      <td title="${isCohortActive() ? "Original movie similarity rank" : "Position in the current sort order"}">${cohortRanks.get(String(anime.id)) ?? pageStart + index + 1}</td>
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

    row.addEventListener("click", (event) => {
      if (!event.target.closest("input")) openRow();
    });

    row.addEventListener("keydown", (event) => {
      if (event.target === row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openRow();
      }
    });
  });

  updateShortlistInputs();

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

registerPage({
  bindControls() {
    elements.tableBody.addEventListener("change", (event) => {
      const input = event.target.closest("[data-shortlist-id]");
      if (!input) return;
      if (!input.checked) shortlist.delete(input.dataset.shortlistId);
      else if (shortlist.size < 3) shortlist.add(input.dataset.shortlistId);
      updateShortlistInputs();
      renderComparison();
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
      if (!btn || btn.disabled) return;
      state.tablePage = Number(btn.dataset.page);
      renderAnimeTable();
      document.querySelector(".table-wrapper")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  },
  render() {
    renderKPIs();
    renderInsights();
    renderAnimeTable();
    renderComparison();
  }
});
