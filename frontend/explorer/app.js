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
  const container = document.querySelector("#comparison-footer");
  const selected = state.data.anime.filter(anime => shortlist.has(String(anime.id)));
  container.hidden = !selected.length;
  document.querySelector("#shortlist-status").textContent = selected.length
    ? `${selected.length} / 3 shortlisted · retained across filters and pages` : "Shortlist 2–3 titles to compare below.";
  if (!selected.length) { container.innerHTML = ""; return; }
  const values = selected.map(comparisonRows);
  const metrics = ["Format / year", "Episodes", "Estimated runtime", "AniList score", "Status"];
  container.innerHTML = `
    <div class="comparison-heading"><h2 id="comparison-heading">${selected.length > 1 ? "Comparison" : "Shortlist"}</h2>
      <button type="button" class="small-button ghost" id="clear-shortlist">Clear shortlist</button></div>
    <div class="comparison-scroll" tabindex="0" role="region" aria-label="Shortlist comparison, scroll horizontally for more titles"><table class="comparison-table" aria-labelledby="comparison-heading">
      <thead><tr><th scope="col">Metric</th>${selected.map(anime => `<th scope="col">${escapeHTML(anime.title)} <button class="small-button ghost" type="button" data-remove-shortlist="${escapeAttribute(anime.id)}" aria-label="Remove ${escapeAttribute(anime.title)}">×</button></th>`).join("")}</tr></thead>
      <tbody>${metrics.map((label, index) => `<tr><th scope="row">${label}</th>${values.map(rows => `<td>${escapeHTML(rows[index])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <p>Runtime = episodes × minutes per episode.</p>`;
  container.querySelector("#clear-shortlist").addEventListener("click", () => {
    shortlist.clear(); renderAnimeTable(); renderComparison();
  });
  container.querySelectorAll("[data-remove-shortlist]").forEach(button => button.addEventListener("click", () => {
    shortlist.delete(button.dataset.removeShortlist); renderAnimeTable(); renderComparison();
  }));
}

function updateShortlistInputs() {
  elements.tableBody.querySelectorAll("[data-shortlist-id]").forEach((input) => {
    input.checked = shortlist.has(input.dataset.shortlistId);
    input.disabled = shortlist.size >= 3 && !input.checked;
  });
}

let explorerTable;
function renderAnimeTable() {
  explorerTable.update({ anime: state.filteredAnime, sortMode: elements.tableSort.value,
    compact: true, selectedIds: [...shortlist], page: state.tablePage, pageSize: state.tablePageSize, cohort: null,
    onSelect: id => openAnimeDetail(state.data.anime.find(item => String(item.id) === id)),
    onRendered: updateShortlistInputs });
}

registerPage({
  bindControls() {
    explorerTable = AnivizExplorer.create({ body: elements.tableBody, pagination: elements.tablePagination,
      note: elements.tableNote, d3, helpers: chartHelpers() });
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
  destroy() { explorerTable.destroy(); },
  render() {
    renderAnimeTable();
    renderComparison();
  }
});
