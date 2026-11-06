"use strict";
(function (root) {
  function create({ body, pagination, note, d3, helpers }) {
    const { escapeHTML, escapeAttribute, humanize, formatNumber } = helpers;
    let context;
    function render() {
      const sortMode = context.sortMode || "popularity";
      const sorted = [...context.anime];

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

      const pageSize = context.pageSize;
      const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

      if (context.page >= totalPages) {
        context.page = Math.max(0, totalPages - 1);
      }

      const pageStart = context.page * pageSize;
      const displayed = sorted.slice(pageStart, pageStart + pageSize);
      const cohortRanks = new Map(Boolean(context.cohort)
        ? context.cohort.ids.map((id, index) => [String(id), index + 1]) : []);

      body.innerHTML = displayed.map((anime, index) => `
        <tr data-anime-id="${anime.id}" tabindex="0">
          <td><input type="checkbox" class="shortlist-checkbox" data-shortlist-id="${anime.id}"
            aria-label="Shortlist ${escapeAttribute(anime.title)}"${context.selectedIds.includes(String(anime.id)) ? " checked" : ""}${context.selectedIds.length >= 3 && !context.selectedIds.includes(String(anime.id)) ? " disabled" : ""}></td>
          <td title="${Boolean(context.cohort) ? "Original movie similarity rank" : "Position in the current sort order"}">${cohortRanks.get(String(anime.id)) ?? pageStart + index + 1}</td>
          <td>
            <div class="anime-cell">
              <img
                src="${escapeAttribute(anime.cover.medium || anime.cover.large || "")}"
                alt=""
                loading="lazy"
              >
              <div>
                <strong>${escapeHTML(anime.title)}</strong>
                ${context.compact ? "" : `<small>${escapeHTML(anime.titles.romaji || "")}</small>`}
              </div>
            </div>
          </td>
          <td>${anime.year || "—"}</td>
          <td>${escapeHTML(humanize(anime.format))}</td>
          ${context.compact ? "" : `<td>${escapeHTML(anime.studio_names.join(", "))}</td>`}
          <td>
            <span class="score-pill">
              ${Number.isFinite(anime.average_score)
                ? anime.average_score
                : "N/A"}
            </span>
          </td>
          <td>${formatNumber(anime.popularity)}</td>
          ${context.compact ? "" : `<td>
            <div class="genre-list">
              ${anime.genres.slice(0, 3).map((genre) => (
                `<span class="tag">${escapeHTML(genre)}</span>`
              )).join("")}
            </div>
          </td>`}
        </tr>
      `).join("");

      body.querySelectorAll("tr").forEach((row) => {
        const openRow = () => {
          const anime = context.anime.find(item => String(item.id) === row.dataset.animeId);

          if (anime) {
            context.onSelect(String(anime.id));
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

      context.onRendered?.();

      renderTablePagination(sorted.length);

      const pageEnd = pageStart + displayed.length;
      note.textContent = sorted.length > 0
        ? `Showing ${pageStart + 1}–${pageEnd} of ${sorted.length} visible title${sorted.length === 1 ? "" : "s"}.`
        : "No titles match the filters.";
    }

    function renderTablePagination(totalItems) {
      const container = pagination;
      const pageSize = context.pageSize;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      if (totalPages <= 1) {
        container.innerHTML = "";
        return;
      }

      const current = context.page;
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

      const btnHtml = (page, label, extra = "", accessibleLabel = `Page ${page + 1}`) => {
        const disabled = (page < 0 || page >= totalPages) ? "disabled" : "";
        return `<button class="page-btn${extra}" data-page="${page}" aria-label="${accessibleLabel}"${page === current ? ' aria-current="page"' : ""} ${disabled}>${label}</button>`;
      };

      const pageButtons = items.map((item) => {
        if (item === "ellipsis") {
          return `<span class="page-ellipsis">…</span>`;
        }
        const active = item === current ? " is-active" : "";
        return btnHtml(item, item + 1, active);
      });

      container.innerHTML = [
        btnHtml(current - 1, "‹", "", "Previous page"),
        ...pageButtons,
        btnHtml(current + 1, "›", "", "Next page")
      ].join("");
    }
    return { update(value) { context = { page: 0, pageSize: 10, selectedIds: [], onSelect() {}, ...value }; render(); },
      destroy() { body.replaceChildren(); pagination.replaceChildren(); } };
  }
  root.AnivizExplorer = Object.freeze({ create });
})(globalThis);
