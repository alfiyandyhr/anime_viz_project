"use strict";

Object.assign(elements, {
  tableSort: document.querySelector("#table-sort"),
  tablePageSize: document.querySelector("#table-page-size"),
  tablePagination: document.querySelector("#table-pagination"),
  tableBody: document.querySelector("#anime-table-body"),
  tableNote: document.querySelector("#table-note")
});

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

registerPage({
  bindControls() {
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
    renderInsights();
    renderAnimeTable();
  }
});
