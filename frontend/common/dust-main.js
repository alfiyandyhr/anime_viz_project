"use strict";
// One analytical owner for the dust field and every mounted supporting chart.
(function (root) {
  let context, composition, latest, metadataPayload = null, metadataError = false;
  let sources = [], sourceMovies = "", sourceLimit, rankingPage = 0, rankingSignature = "";
  let restored = false, scrollRestored = false, pendingNotice = "";
  let externalId = null;
  const $ = selector => document.querySelector(selector);
  const movieColors = new Map();
  function color(movieId) {
    if (!movieColors.has(String(movieId))) {
      const active = recommendationState.movieIds.filter(id => String(id) !== String(movieId));
      const used = new Set(active.map(id => movieColors.get(String(id))));
      movieColors.set(String(movieId), MAGNET_COLORS.find(value => !used.has(value)) || MAGNET_COLORS[0]);
    }
    return movieColors.get(String(movieId));
  }
  const notice = message => {
    pendingNotice = message;
    if ($('[data-dust-notice]')) $('[data-dust-notice]').textContent = message;
  };
  function controlsFromFilters(filters) {
    const mapping = { search: "searchInput", genre: "genreFilter", studio: "studioFilter", format: "formatFilter",
      yearFrom: "yearFrom", yearTo: "yearTo", minimumScore: "scoreFilter" };
    Object.entries(mapping).forEach(([key, name]) => {
      const fallback = key === "yearFrom" ? metadataPayload?.meta.year_min ?? 1900
        : key === "yearTo" ? metadataPayload?.meta.year_max ?? new Date().getFullYear() : "";
      const control = elements[name], value = filters[key] ?? fallback;
      if (control.tagName === 'SELECT' && value !== '' && !Array.from(control.options).some(option => option.value === String(value))) {
        const option = document.createElement('option'); option.value = value; option.textContent = value; control.append(option);
      }
      control.value = value;
    });
    elements.scoreOutput.value = filters.minimumScore;
  }
  function setFilters(patch) {
    context.setFilters(patch);
    controlsFromFilters(context.snapshot().filters);
    renderRecommendations();
  }
  function applyFilters() {
    let from = Number(elements.yearFrom.value), to = Number(elements.yearTo.value);
    if (from > to) [from, to] = [to, from];
    setFilters({ search: elements.searchInput.value.trim(), genre: elements.genreFilter.value,
      studio: elements.studioFilter.value, format: elements.formatFilter.value,
      yearFrom: from === Number(elements.yearFrom.options[0]?.value) ? null : from,
      yearTo: to === Number(elements.yearTo.options[elements.yearTo.options.length - 1]?.value) ? null : to,
      minimumScore: Number(elements.scoreFilter.value) });
  }
  function resetFilters() { context.resetFilters(); controlsFromFilters(context.snapshot().filters); renderRecommendations(); }
  function movies() {
    return (latest?.movieIds || []).map(id => recommendationState.data?.movies.find(movie => String(movie.id) === id)).filter(Boolean);
  }
  function select(id) {
    const key = String(id);
    if (latest.displayedDustIds.includes(key)) {
      externalId = null;
      context.toggleSelection(key);
    } else {
      externalId = key;
    }
    renderDetails(); highlightRecommendation();
  }
  function renderDetails() {
    if (!latest) return;
    const result = AnivizDustDetails.render({ snapshot: latest, movies: movies(), externalId, color,
      helpers: { escapeHTML, escapeAttribute, humanize, formatNumber } });
    const detail = $('#recommendation-detail'), cue = $('#dust-selection');
    detail.hidden = !result.html;
    detail.innerHTML = result.html;
    cue.hidden = !result.html;
    cue.innerHTML = result.html ? `<a href="#recommendation-detail">${result.count > 1 ? `Comparing ${result.count} anime` : result.count ? 'Selected anime' : 'Ranking details'} · below ↓</a>` : '';
  }
  function publish(snapshot) {
    latest = snapshot;
    if (snapshot.displayedDustIds.includes(externalId) || !snapshot.ranking.some(row => String(row.anime.id) === externalId)) externalId = null;
    recommendationState.animeId = snapshot.selectedAnimeIds.at(-1) || null;
    recommendationState.dustMatches = snapshot.displayedDust;
    const anime = snapshot.displayedDustIds.map(id => snapshot.lookup.get(id).anime);
    const genreColor = d3.scaleOrdinal([...new Set([...snapshot.lookup.values()].flatMap(row => row.anime.genres))].sort(), [...d3.schemeTableau10, ...d3.schemeSet3]);
    composition.update({ anime, selectedIds: snapshot.selectedAnimeIds, genreColor,
      metric: $('[data-dust-genre-metric]').value, onFilter: setFilters, onSelect: select,
      snapshot });
    const count = snapshot.displayedDustIds.length, candidates = snapshot.candidateDustIds.length;
    $('[data-dust-chart="connections"]').style.minHeight = `${count ? 110 + Math.min(20, count) * 38 : 200}px`;
    $('[data-dust-scope]').textContent = `${count} / ${candidates} anime`;
    elements.filterSummary.textContent = `${count} / ${candidates} anime`;
    $('[data-dust-notice]').textContent = pendingNotice;
    const notes = {
      genres: [$('[data-dust-genre-metric]').value === 'count' ? 'Genres' : 'Genre ' + $('[data-dust-genre-metric]').value,
        row => row.genres.length && ($('[data-dust-genre-metric]').value === 'score' ? Number.isFinite(row.average_score) : $('[data-dust-genre-metric]').value !== 'popularity' || Number.isFinite(row.popularity)), 'Counts overlap.'],
      years: ['Release years', row => Number.isFinite(row.year), 'Bars: titles · line: score.'],
      studios: ['Studios with ratings', row => row.studio_names.length && Number.isFinite(row.average_score), 'Credits overlap.'],
      heatmap: ['Studio × genre', row => row.studio_names.length && row.genres.length, 'Counts overlap.'],
      reception: ['Ratings', row => row.popularity > 0 && Number.isFinite(row.average_score), 'Size: favourites · color: genre.']
    };
    Object.entries(notes).forEach(([kind, [label, predicate, suffix]]) => {
      const available = anime.filter(predicate).length;
      $(`[data-coverage="${kind}"]`).textContent = snapshot.metadataStatus === 'unavailable' && ['studios', 'heatmap', 'reception'].includes(kind)
        ? `${label} unavailable: metadata failed to load.` : (available < count ? `${label}: ${available} of ${count} · ` : "") + suffix;
    });
    $('[data-dust-chips]').replaceChildren();
    Object.entries(snapshot.filters).filter(([, value]) => value !== null && value !== "" && value !== "All" && value !== 0).forEach(([key, value]) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'small-button ghost';
      button.textContent = `${key}: ${value} ×`; button.setAttribute('aria-label', `Remove ${key} filter: ${value}`);
      button.addEventListener('click', () => setFilters({ [key]: AnivizDust.defaults()[key] }));
      $('[data-dust-chips]').append(button);
    });
    const signature = JSON.stringify([snapshot.movieIds, snapshot.rankingSortKey]);
    if (signature !== rankingSignature) { rankingPage = 0; rankingSignature = signature; }
    const sort = $('[data-dust-ranking-sort]');
    sort.innerHTML = '<option value="average">Average similarity</option>' + movies().map((movie, i) =>
      `<option value="${escapeAttribute(movie.id)}">Closest to Magnet ${i + 1} — ${escapeHTML(movie.title)}</option>`).join('');
    sort.value = snapshot.rankingSortKey;
    renderRanking();
    if (recommendationState.data && recommendationState.dustMatches) { renderDustDetail(); highlightRecommendation(); }
  }
  function renderRanking() {
    const all = latest.ranking, active = movies(), size = 10, total = Math.max(1, Math.ceil(all.length / size));
    rankingPage = Math.min(rankingPage, total - 1);
    const start = rankingPage * size, rows = all.slice(start, start + size);
    const basis = latest.rankingSortKey === 'average' ? 'average similarity' : active.find(movie => String(movie.id) === latest.rankingSortKey)?.title;
    $('[data-dust-ranking-note]').textContent = `${all.length} corpus anime · ${all.length ? `${start + 1}–${start + rows.length}` : 'Unavailable'}`;
    $('[data-dust-ranking-head]').innerHTML = `<tr><th scope="col">Rank · ${escapeHTML(basis || '')}</th><th scope="col">Anime</th>${active.map((movie, i) => `<th scope="col">M${i + 1} · ${escapeHTML(movie.title)}</th>`).join('')}<th scope="col">Average similarity</th><th scope="col">Format / year</th><th scope="col">Displayed dust</th></tr>`;
    $('[data-dust-ranking-body]').innerHTML = rows.map(match => `<tr class="${latest.selectedAnimeIds.includes(String(match.anime.id)) ? 'is-selected' : ''}"><td>${match.rank}</td><td><button type="button" class="recommendation-title-button" data-dust-rank-id="${escapeAttribute(match.anime.id)}"${match.displayed ? ` aria-pressed="${latest.selectedAnimeIds.includes(String(match.anime.id))}"` : ''}>${escapeHTML(match.anime.title)}</button></td>${match.scores.map(score => `<td title="Cosine ${score}">${score.toFixed(3)}</td>`).join('')}<td title="Average cosine ${match.score}">${match.score.toFixed(3)}</td><td>${escapeHTML(humanize(match.anime.format))} / ${match.anime.year || 'Unknown'}</td><td>${match.displayed ? 'Yes' : '—'}</td></tr>`).join('');
    const pages = [];
    for (let page = 0; page < total; page++) if (page === 0 || page === total - 1 || Math.abs(page - rankingPage) <= 1) pages.push(page);
    $('[data-dust-ranking-pages]').innerHTML = total < 2 ? '' :
      `<button type="button" class="page-btn" data-dust-page="${rankingPage - 1}" ${rankingPage === 0 ? 'disabled' : ''} aria-label="Previous ranking page">‹</button>` +
      pages.map(page => `<button type="button" class="page-btn" data-dust-page="${page}" ${page === rankingPage ? 'aria-current="page"' : ''}>${page + 1}</button>`).join('') +
      `<button type="button" class="page-btn" data-dust-page="${rankingPage + 1}" ${rankingPage === total - 1 ? 'disabled' : ''} aria-label="Next ranking page">›</button>`;
  }
  // Node-and-link map using the displayed set only; the full ranking has a separate corpus scope.
  function connectionRenderer(container) {
    return { update({ snapshot }) {
      const focused = container.contains(document.activeElement) ? document.activeElement.dataset.dustConnectionId : null;
      container.replaceChildren();
      const active = movies(), visible = new Set(snapshot.displayedDustIds);
      const ordered = snapshot.ranking.filter(match => visible.has(String(match.anime.id)));
      const subset = ordered.length > 20 ? [...ordered.slice(0, 10), ...ordered.slice(-10)] : ordered;
      $('[data-coverage="connections"]').textContent = `${subset.length} of ${visible.size} displayed dusts${ordered.length > 20 ? ' · top / bottom 10 by ranking sort' : ''} · Focus for cosine scores.`;
      if (!active.length || !subset.length) { renderEmpty(container, 'Add movies or broaden dust filters to see connections.'); return; }
      const width = Math.max(container.clientWidth, 550), height = 110 + subset.length * 38, x = width * .43;
      const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'group').attr('aria-label', 'Displayed dust similarity connections');
      const nodes = active.map((movie, i) => ({ movie, x: 25, y: height * (i + 1) / (active.length + 1) }));
      nodes.forEach((node, movieIndex) => {
        svg.append('rect').attr('x', node.x).attr('y', node.y - 30).attr('width', x - 70).attr('height', 60).attr('rx', 8).attr('fill', '#111c30').attr('stroke', color(node.movie.id));
        svg.append('text').attr('x', node.x + 10).attr('y', node.y + 4).attr('fill', color(node.movie.id)).text(`M${movieIndex + 1} · ${truncate(node.movie.title, 21)}`).append('title').text(node.movie.title);
      });
      subset.forEach((match, i) => {
        const y = 50 + i * 38, selected = snapshot.selectedAnimeIds.includes(String(match.anime.id));
        nodes.forEach((node, j) => {
          svg.append('line').attr('x1', x - 45).attr('y1', node.y).attr('x2', x).attr('y2', y)
            .attr('stroke', color(node.movie.id)).attr('stroke-width', selected || snapshot.rankingSortKey === String(node.movie.id) ? 2.5 : 1).attr('opacity', selected || snapshot.rankingSortKey === String(node.movie.id) ? 1 : .35)
            .append('title').text(`${node.movie.title} → ${match.anime.title}: cosine ${match.scores[j]}`);
        });
        const row = svg.append('g').attr('role', 'button').attr('tabindex', 0).attr('aria-pressed', selected)
          .attr('data-dust-connection-id', match.anime.id)
          .attr('aria-label', `${match.anime.title}. ${active.map((movie, j) => `${movie.title}: ${match.scores[j]}`).join('. ')}`)
          .on('mouseenter focus', event => {
            const rect = event.currentTarget.getBoundingClientRect();
            showTooltip(event.type === 'focus' ? { clientX: rect.x + rect.width / 2, clientY: rect.y } : event,
              `<strong>${escapeHTML(match.anime.title)}</strong>` + active.map((movie, j) => `<span>${escapeHTML(movie.title)}: cosine ${match.scores[j]}</span>`).join(''));
          }).on('mousemove', moveTooltip).on('mouseleave blur', hideTooltip)
          .on('click', () => select(match.anime.id)).on('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(match.anime.id); } });
        row.append('rect').attr('x', x).attr('y', y - 14).attr('width', width - x - 10).attr('height', 29).attr('rx', 5).attr('fill', '#17243a').attr('stroke', selected ? 'white' : '#43536d').attr('stroke-width', selected ? 3 : 1);
        row.append('text').attr('x', x + 8).attr('y', y + 4).attr('fill', '#e4e8f3').attr('font-size', 11).text(truncate(match.anime.title, 37));
        row.append('title').text(active.map((movie, j) => `${movie.title}: cosine ${match.scores[j]}`).join('\n'));
      });
      if (focused) container.querySelector(`[data-dust-connection-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    }, destroy() { container.replaceChildren(); } };
  }
  async function loadMetadata() {
    try {
      metadataPayload = await AnivizData.dashboard(); metadataError = false;
      state.data = metadataPayload; populateControls();
      controlsFromFilters(context.snapshot().filters);
      context.setMetadata(metadataPayload.anime);
    } catch (_) {
      metadataError = true; context.setMetadata([], 'unavailable');
      // Recommendation fields remain useful even when richer metadata cannot load.
      populateFallbackControls();
    }
    renderRecommendations();
  }
  function populateFallbackControls() {
    const anime = recommendationState.data?.anime || [];
    populateSelect(elements.genreFilter, [...new Set(anime.flatMap(row => row.genres))].sort(), 'All genres');
    populateSelect(elements.studioFilter, [], 'Studios unavailable');
    populateSelect(elements.formatFilter, [...new Set(anime.map(row => row.format))].filter(Boolean).sort(), 'All formats', humanize);
    const years = anime.map(row => row.year).filter(Number.isFinite);
    const from = years.length ? Math.min(...years) : 1900, to = years.length ? Math.max(...years) : new Date().getFullYear();
    const options = Array.from({ length: to - from + 1 }, (_, i) => `<option value="${from + i}">${from + i}</option>`).join('');
    elements.yearFrom.innerHTML = options; elements.yearTo.innerHTML = options;
    controlsFromFilters(context.snapshot().filters);
  }
  function bind() {
    let storage;
    try { storage = sessionStorage; } catch (_) { notice('Session storage is unavailable. Changes work here, but may not survive navigation or reload.'); }
    context = AnivizDust.createContext({ getDustMatches, storage, onNotice: notice });
    restored = context.restore();
    recommendationState.dustLimit = context.snapshot().dustLimit;
    recommendationState.magnetPositions = context.getLayout().magnetPositions || {};
    Object.entries(context.getLayout().movieColors || {}).forEach(([key, value]) => movieColors.set(key, value));
    const particles = context.getLayout().particles;
    if (particles?.positions?.length) dustChart = { ...particles, positions: new Map(particles.positions.map(node => [node.anime.id, node])), stop() {} };
    $('#dust-limit').value = recommendationState.dustLimit;
    composition = AnivizComposition.create({ onError: error => console.error(error) });
    document.querySelectorAll('[data-dust-chart]').forEach(container => {
      const kind = container.dataset.dustChart;
      composition.mount(container, kind === 'connections' ? connectionRenderer(container)
        : AnivizCharts.create(kind, { container, d3, helpers: chartHelpers() }));
    });
    context.subscribe(publish);
    $('[data-dust-genre-metric]').addEventListener('change', () => publish(context.snapshot()));
    $('[data-dust-ranking-sort]').addEventListener('change', event => context.setRankingSort(event.target.value));
    $('[data-dust-ranking-pages]').addEventListener('click', event => {
      const button = event.target.closest('[data-dust-page]');
      if (button && !button.disabled) { rankingPage = Number(button.dataset.dustPage); renderRanking(); }
    });
    $('[data-dust-ranking-body]').addEventListener('click', event => {
      const button = event.target.closest('[data-dust-rank-id]');
      if (button) { select(button.dataset.dustRankId); $('[data-dust-ranking-body]').querySelector(`[data-dust-rank-id="${CSS.escape(button.dataset.dustRankId)}"]`)?.focus({ preventScroll: true }); }
    });
    $('#recommendation-detail').addEventListener('click', event => {
      const remove = event.target.closest('[data-dust-remove]');
      if (remove) context.toggleSelection(remove.dataset.dustRemove);
      if (event.target.closest('[data-dust-clear]')) context.setSelection([]);
      if (event.target.closest('[data-dust-close]')) { externalId = null; renderDetails(); }
    });
    bindRecommendationControls();
    populateFallbackControls();
    void loadMetadata();
  }
  function initialize(data) {
    if (!restored) restored = context.migrateLegacy(data);
    const saved = context.snapshot();
    if (restored) {
      recommendationState.movieIds = saved.movieIds.filter(id => data.movies.some(movie => String(movie.id) === id));
      recommendationState.movieId = recommendationState.movieIds.at(-1) || null;
      recommendationState.cohortSelected = true;
    }
    if (metadataError) populateFallbackControls();
    saved.movieIds.forEach(color);
  }
  function sync() {
    if (!context || !recommendationState.data) return null;
    if (sources[0] !== recommendationState.data || sources[1] !== recommendationState.scores) {
      sources = [recommendationState.data, recommendationState.scores];
      // Seed movies before the first derivation; legacy Top-20 IDs are never imported.
      context.setSources(...sources);
      context.setMovies(recommendationState.movieIds);
      sourceMovies = JSON.stringify(recommendationState.movieIds);
    }
    const used = new Set();
    recommendationState.movieIds.forEach(id => {
      let value = movieColors.get(String(id));
      if (!value || used.has(value)) value = MAGNET_COLORS.find(candidate => !used.has(candidate));
      movieColors.set(String(id), value); used.add(value);
    });
    const ids = JSON.stringify(recommendationState.movieIds);
    if (sourceMovies !== ids) { context.setMovies(recommendationState.movieIds); sourceMovies = ids; }
    if (sourceLimit !== recommendationState.dustLimit) { context.setDustLimit(recommendationState.dustLimit); sourceLimit = recommendationState.dustLimit; }
    latest = context.snapshot();
    if (!scrollRestored && recommendationState.scores && latest.metadataStatus !== "loading") {
      scrollRestored = true;
      requestAnimationFrame(() => {
        const returning = ['back_forward', 'reload'].includes(performance.getEntriesByType('navigation')[0]?.type);
        const target = !returning && ['#content', '#creators', '#reception'].includes(location.hash) ? $(location.hash) : null;
        if (target) target.scrollIntoView();
        else window.scrollTo(0, context.getLayout().scrollY || 0);
      });
    }
    return latest;
  }
  function saveLayout() {
    if (!context) return;
    context.saveLayout({ magnetPositions: recommendationState.magnetPositions, movieColors: Object.fromEntries(movieColors),
      particles: dustChart ? { width: dustChart.width, height: dustChart.height,
        positions: [...dustChart.positions.values()].map(node => ({ anime: { id: node.anime.id }, x: node.x, y: node.y, vx: node.vx, vy: node.vy })) } : null,
      scrollY: window.scrollY });
  }
  root.AnivizMain = { bind, initialize, sync, select, color, saveLayout, renderDetails,
    clearSelection() { externalId = null; context.setSelection([]); },
    resetPositions() { context.resetPositions(); recommendationState.magnetPositions = {}; dustChart = null; },
    refresh() { composition?.setActive(true); composition?.refresh(); },
    snapshot: () => context?.snapshot() };
  registerPage({ usesDashboard: false, bindControls: bind, applyFilters, resetFilters,
    render() { composition?.setActive(!document.hidden); renderRecommendations(); composition?.refresh(); },
    pause() { saveLayout(); stopDustChart(); composition?.setActive(false); },
    destroy() { saveLayout(); stopDustChart(); composition?.destroy(); }
  });
})(globalThis);
