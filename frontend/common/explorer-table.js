"use strict";
(function (root) {
  function create({ body, pagination, note, d3, helpers }) {
    const { escapeHTML, escapeAttribute, humanize, formatNumber } = helpers;
    let context;
    function render() {
      const sortMode = context.sortMode || "popularity";
      const sorted = [...(context.titles ?? context.anime)];
      const movie = context.movie;

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
            return d3.descending(a.popularity ?? -1, b.popularity ?? -1);
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

      body.innerHTML = displayed.map((title, index) => {
        const id = String(title.id);
        const selected = context.selectedIds.includes(id);
        const cover = movie ? root.AnivizArtwork.movieThumbnail(title) : root.AnivizArtwork.animeThumbnail(title);
        const rank = movie ? title.popularity_rank ?? "N/A" : cohortRanks.get(id) ?? pageStart + index + 1;
        const rankLabel = movie ? "Popularity rank in the archived movie sample"
          : context.cohort ? "Original movie similarity rank" : "Position in the current sort order";
        return `
        <tr data-${movie ? "movie" : "anime"}-id="${escapeAttribute(id)}" tabindex="0">
          <td><input type="checkbox" class="shortlist-checkbox" data-shortlist-id="${escapeAttribute(id)}"
            aria-label="Shortlist ${escapeAttribute(title.title)}"${selected ? " checked" : ""}${context.selectedIds.length >= 3 && !selected ? " disabled" : ""}></td>
          <td title="${rankLabel}">${rank}</td>
          <td>
            <div class="anime-cell">
              ${cover ? `<img
                src="${escapeAttribute(cover)}"
                alt=""
                loading="lazy"
              >` : ""}
              <div>
                <strong>${escapeHTML(title.title)}</strong>
                ${context.compact ? "" : `<small>${escapeHTML(title.titles.romaji || "")}</small>`}
              </div>
            </div>
          </td>
          <td>${title.year || "—"}</td>
          <td>${escapeHTML(movie ? title.genres.join(", ") || "Unknown" : humanize(title.format))}</td>
          ${context.compact ? "" : `<td>${escapeHTML(title.studio_names.join(", "))}</td>`}
          <td>
            <span class="score-pill">
              ${Number.isFinite(title.average_score)
                ? title.average_score
                : "N/A"}
            </span>
          </td>
          <td>${movie ? title.popularity ?? "N/A" : formatNumber(title.popularity)}</td>
          ${context.compact ? "" : `<td>
            <div class="genre-list">
              ${title.genres.slice(0, 3).map((genre) => (
                `<span class="tag">${escapeHTML(genre)}</span>`
              )).join("")}
            </div>
          </td>`}
        </tr>
      `;
      }).join("");

      body.querySelectorAll("tr").forEach((row, index) => {
        const openRow = () => context.onSelect(String(displayed[index].id));

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
