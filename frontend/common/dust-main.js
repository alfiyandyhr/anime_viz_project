"use strict";
// Connect one directional dust snapshot to the field, details and analysis.
(function (root) {
  let context, composition, latest, rankingPage = 0, rankingSignature = "";
  let scrollRestored = false, pendingNotice = "", metadataLoading = false;
  let movieDetailsLoading = false, movieDetailsLoaded = false;
  const $ = selector => document.querySelector(selector);
  const magnetColors = new Map();
  const isReverse = () => latest.direction === AnivizDust.REVERSE;
  const dustNoun = () => isReverse() ? "movies" : "anime";
  const detailHelpers = () => ({ escapeHTML, escapeAttribute, humanize, formatNumber });
  const color = key => magnetColors.get(key);
  const notice = message => {
    pendingNotice = message;
    $('[data-dust-notice]').textContent = message;
  };

  function controlsFromFilters(filters) {
    elements.searchInput.value = filters.search;
    elements.genreFilter.value = filters.genre;
    elements.yearFrom.value = filters.yearFrom ?? elements.yearFrom.options[0]?.value;
    elements.yearTo.value = filters.yearTo ?? elements.yearTo.options[elements.yearTo.length - 1]?.value;
    if (isReverse()) return;
    elements.studioFilter.value = filters.studio;
    elements.formatFilter.value = filters.format;
    elements.scoreFilter.value = filters.minimumScore;
    elements.scoreOutput.value = filters.minimumScore;
  }
  function populateFilterChoices() {
    const records = [...latest.lookup.values()].map(row => row.record);
    const choices = field => [...new Set(records.flatMap(record => record[field] || []))].sort();
    populateSelect(elements.genreFilter, choices('genres'), 'All genres');
    if (!isReverse()) {
      populateSelect(elements.studioFilter, choices('studio_names'),
        latest.metadataStatus === 'unavailable' ? 'Studios unavailable' : 'All studios');
      populateSelect(elements.formatFilter, choices('format'), 'All formats', humanize);
    }
    const years = records.map(record => record.year).filter(Number.isFinite);
    const first = years.length ? Math.min(...years) : 1900;
    const last = years.length ? Math.max(...years) : new Date().getFullYear();
    elements.yearFrom.innerHTML = elements.yearTo.innerHTML =
      Array.from({ length: last - first + 1 }, (_, i) => `<option value="${first + i}">${first + i}</option>`).join('');
    for (const [key, control] of [['genre', elements.genreFilter], ['yearFrom', elements.yearFrom],
      ['yearTo', elements.yearTo], ...(!isReverse() ? [['studio', elements.studioFilter], ['format', elements.formatFilter]] : [])]) {
      // Keep explicit saved filters visible if that metadata is currently unavailable.
      const value = latest.filters[key];
      if (value !== null && !Array.from(control.options).some(option => option.value === String(value))) {
        const option = new Option(value, value);
        if (key === 'yearFrom') control.insertBefore(option, control.options[1] || null);
        else if (key === 'yearTo') control.insertBefore(option, control.options[control.length - 1] || null);
        else control.add(option);
      }
    }
    controlsFromFilters(latest.filters);
  }
  function setFilters(patch) {
    context.setFilters(patch);
    controlsFromFilters(latest.filters);
    renderRecommendations();
  }
  function applyFilters() {
    if (!recommendationState.data) return;
    let from = Number(elements.yearFrom.value), to = Number(elements.yearTo.value);
    if (from > to) [from, to] = [to, from];
    setFilters({ search: elements.searchInput.value.trim(), genre: elements.genreFilter.value,
      studio: elements.studioFilter.value, format: elements.formatFilter.value,
      yearFrom: from === Number(elements.yearFrom.options[0]?.value) ? null : from,
      yearTo: to === Number(elements.yearTo.options[elements.yearTo.length - 1]?.value) ? null : to,
      minimumScore: Number(elements.scoreFilter.value) });
  }
  function resetFilters() { context.resetFilters(); controlsFromFilters(latest.filters); renderRecommendations(); }

  function inspectTitle(key) {
    const record = latest.lookup.get(key)?.record;
    if (!record) return;
    const { ranking, magnets } = latest;
    const match = ranking.find(row => row.key === key);
    if (isReverse()) {
      elements.drawerContent.innerHTML = `<div class="dust-movie-drawer">${AnivizDustDetails.renderMovie({
        record, match, magnets, color, helpers: detailHelpers(), heading: 'h2'
      })}</div>`;
      openDrawer('Movie details');
    } else {
      const similarityHtml = magnets.some(magnet => magnet.kind !== undefined)
        ? AnivizDustDetails.magnetScores(match, magnets, color, detailHelpers()) : '';
      openAnimeDetail({ ...record, cover: record.cover || {}, description: record.description || record.synopsis,
        site_url: record.site_url || record.url || `https://anilist.co/anime/${record.id}` }, { similarityHtml });
    }
  }
  function select(key, { showDrawer = false } = {}) {
    if (!latest.displayedKeys.includes(key)) return;
    const wasSelected = latest.selectedKeys.includes(key);
    if (pendingNotice.startsWith('Compare up to 3')) notice('');
    context.toggleSelection(key);
    if (showDrawer && !wasSelected) inspectTitle(key);
  }
  function renderDetails() {
    const result = AnivizDustDetails.render({ snapshot: latest, color, helpers: detailHelpers() });
    const detail = $('#recommendation-detail'), cue = $('#dust-selection'), focus = $('#dust-focus');
    if (focus.innerHTML !== result.focusHtml) { focus.innerHTML = result.focusHtml; focus.scrollTop = 0; }
    detail.hidden = !result.html;
    detail.innerHTML = result.html;
    cue.hidden = !result.html;
    cue.innerHTML = result.html ? `<a href="#recommendation-detail">${result.count > 1
      ? `Comparing ${result.count} ${dustNoun()}` : 'Selected title'} · below ↓</a>` : '';
  }
  function publish(snapshot) {
    const switched = latest.direction !== snapshot.direction;
    latest = snapshot;
    if (switched) loadLayout();
    const reverse = isReverse();
    const used = new Set();
    snapshot.activeMagnetKeys.forEach(key => {
      let value = magnetColors.get(key);
      if (!MAGNET_COLORS.includes(value) || used.has(value)) value = MAGNET_COLORS.find(candidate => !used.has(candidate));
      magnetColors.set(key, value);
      used.add(value);
    });
    if (switched) updateDirectionControls();
    const records = snapshot.displayedKeys.map(key => snapshot.lookup.get(key).record);
    const dustColors = new Map(snapshot.displayedDust.map(match => [
      String(match.record.id), color(snapshot.activeMagnetKeys[match.closest])
    ]));
    const metric = reverse ? 'count' : $('[data-dust-genre-metric]').value;
    const selectedIds = snapshot.selectedKeys.map(key => snapshot.lookup.get(key)?.record.id).filter(id => id != null).map(String);
    composition.update({ anime: records, selectedIds, countOnly: reverse,
      metric,
      onSelect: id => select(AnivizDust.keyFor('anilist', id)),
      dustColor: id => dustColors.get(id), snapshot });
    const count = records.length, candidates = snapshot.candidateKeys.length;
    $('[data-dust-scope]').textContent = elements.filterSummary.textContent = `${count} / ${candidates} ${dustNoun()}`;
    $('#dust-limit').value = snapshot.dustLimit;
    $('#recommendation-score-note').textContent = snapshot.mixed
      ? 'Select up to 3 dots · Distance: order of attraction percentiles (0–1) · Color: highest percentile.'
      : 'Select up to 3 dots · distance: preference order · cosine ≠ percentage.';
    $('#dust-connection-method').textContent = `Select a magnet to rank the displayed titles by ${snapshot.mixed ? 'attraction percentile' : 'cosine similarity'}. Thicker curves show higher scores within that magnet’s range. Color shows each title’s closest magnet. Dust members lists the titles closest to the selected magnet. Scroll either list to see more titles.`;
    const notes = {
      genres: [metric === 'count' ? 'Genres' : 'Genre ' + metric,
        row => row.genres.length && (metric === 'score' ? Number.isFinite(row.average_score) : metric !== 'popularity' || Number.isFinite(row.popularity)), 'Counts overlap.'],
      years: ['Release years', row => Number.isFinite(row.year), reverse ? 'Bars show displayed movies by release year.' : 'Bars: titles · line: score.']
    };
    if (reverse) {
      $('[data-coverage="reception"]').textContent = 'Select movies to compare TMDB scores below the field. The High popularity magnet uses the archived TMDB popularity snapshot.';
      $('[data-coverage="studios"]').textContent = 'The published TMDB sample has no production company or cast credits.';
      $('[data-coverage="heatmap"]').textContent = '';
    } else {
      Object.assign(notes, {
        studios: ['Titles with studio, score and popularity', row => row.studio_names.length && row.popularity > 0 && Number.isFinite(row.average_score), 'Circle area represents matching titles. Studio credits can overlap.'],
        heatmap: ['Studio × genre', row => row.studio_names.length && row.genres.length,
          'Up to 15 studios and 10 genres, ranked by displayed title count. Titles can appear in multiple cells.'],
        reception: ['Ratings', row => row.popularity > 0 && Number.isFinite(row.average_score), 'Circle area: favourites · Color: closest magnet.']
      });
    }
    Object.entries(notes).forEach(([kind, [label, predicate, suffix]]) => {
      const available = records.filter(predicate).length;
      $(`[data-coverage="${kind}"]`).textContent = snapshot.metadataStatus === 'unavailable' && ['studios', 'heatmap', 'reception'].includes(kind)
        ? `${label} unavailable: metadata failed to load.` : (available < count ? `${label}: ${available} of ${count} · ` : '') + suffix;
    });
    $('[data-dust-chips]').replaceChildren();
    Object.entries(snapshot.filters).filter(([, value]) => value !== null && value !== "" && value !== "All" && value !== 0).forEach(([key, value]) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'small-button ghost';
      button.textContent = `${key}: ${value} ×`; button.setAttribute('aria-label', `Remove ${key} filter: ${value}`);
      button.addEventListener('click', () => setFilters({ [key]: AnivizDust.defaults(snapshot.direction)[key] }));
      $('[data-dust-chips]').append(button);
    });
    const signature = JSON.stringify([snapshot.direction, snapshot.activeMagnetKeys, snapshot.rankingSortKey, snapshot.rankingOrder]);
    if (signature !== rankingSignature) { rankingPage = 0; rankingSignature = signature; }
    const sort = $('[data-dust-ranking-sort]');
    sort.innerHTML = `<option value="average">${AnivizDust.averageLabel(snapshot.mixed)}</option>` + snapshot.magnets.map((magnet, i) => {
      const label = snapshot.mixed || magnet.kind === 'genre' ? AnivizDust.magnetScoreLabel(magnet) : `Closest to Magnet ${i + 1} — ${magnet.title}`;
      return `<option value="${escapeAttribute(magnet.key)}">${escapeHTML(label)}</option>`;
    }).join('');
    sort.value = snapshot.activeMagnetKeys.includes(snapshot.rankingSortKey) ? snapshot.rankingSortKey : 'average';
    $('[data-dust-ranking-order]').value = snapshot.rankingOrder;
    renderRanking();
    renderDetails();
    highlightRecommendation();
  }
  function renderRanking() {
    const { ranking, magnets, rankingOrder, mixed, popularity } = latest, size = 10;
    const total = Math.max(1, Math.ceil(ranking.length / size));
    rankingPage = Math.min(rankingPage, total - 1);
    const ordered = rankingOrder !== 'descending' ? ranking
      : [...ranking.filter(match => match.rank !== null).reverse(), ...ranking.filter(match => match.rank === null)];
    const start = rankingPage * size, rows = ordered.slice(start, start + size);
    const ranked = rows.filter(match => match.rank !== null);
    $('[data-dust-ranking-note]').textContent = `${ranking.length} corpus ${dustNoun()} · ${ranked.length ? `ranks ${ranked[0].rank}–${ranked.at(-1).rank}` : 'Ranks unavailable'}`
      + (mixed ? ` · ${popularityDescription(popularity)}. Individual magnet sorts use raw values. Titles without popularity have no combined rank.` : '');
    const title = isReverse() ? 'Movie' : 'Anime';
    const cohortLabels = magnets.map(magnet => magnet.kind === 'genre' ? AnivizDust.magnetScoreLabel(magnet) : '');
    const average = AnivizDust.averageLabel(mixed);
    $('[data-dust-ranking-head]').innerHTML = `<tr><th scope="col" aria-sort="${rankingOrder}">Rank</th><th scope="col">${title}</th>${magnets.map((magnet, i) => `<th scope="col">M${i + 1} · ${escapeHTML(mixed ? AnivizDust.magnetScoreLabel(magnet) : cohortLabels[i] || magnet.title)}</th>`).join('')}<th scope="col">${average}</th><th scope="col">${isReverse() ? 'Year' : 'Format / year'}</th><th scope="col">Displayed dust</th></tr>`;
    $('[data-dust-ranking-body]').innerHTML = rows.map(match => {
      const { record } = match;
      const year = record.year || 'Unknown';
      const format = isReverse() ? '' : escapeHTML(humanize(record.format)) + ' / ';
      const scores = match.scores.map((score, i) => mixed
        ? `<td title="${escapeAttribute(AnivizDust.mixedEvidence(match, magnets[i], i))}">${AnivizDust.formatRawScore(match.rawScores[i], magnets[i])}<br><small>Percentile ${AnivizDust.formatPercentile(score)}</small></td>`
        : `<td title="${escapeAttribute(cohortLabels[i] ? `${cohortLabels[i]}: ${score}` : `Cosine ${score}`)}">${score.toFixed(3)}</td>`);
      return `<tr><td>${match.rank ?? 'Unavailable'}</td><td><button type="button" class="recommendation-title-button" data-dust-rank-id="${escapeAttribute(match.key)}" aria-haspopup="dialog" aria-controls="detail-drawer">${escapeHTML(record.title)}</button></td>${scores.join('')}<td title="${mixed ? average : 'Average cosine'} ${match.score ?? 'unavailable'}">${AnivizDust.formatPercentile(match.score)}</td><td>${format}${year}</td><td>${match.displayed ? 'Yes' : '—'}</td></tr>`;
    }).join('');
    const pages = [];
    for (let page = 0; page < total; page++) if (page === 0 || page === total - 1 || Math.abs(page - rankingPage) <= 1) pages.push(page);
    $('[data-dust-ranking-pages]').innerHTML = total < 2 ? '' :
      `<button type="button" class="page-btn" data-dust-page="${rankingPage - 1}" ${rankingPage === 0 ? 'disabled' : ''} aria-label="Previous ranking page">‹</button>` +
      pages.map(page => `<button type="button" class="page-btn" data-dust-page="${page}" ${page === rankingPage ? 'aria-current="page"' : ''}>${page + 1}</button>`).join('') +
      `<button type="button" class="page-btn" data-dust-page="${rankingPage + 1}" ${rankingPage === total - 1 ? 'disabled' : ''} aria-label="Next ranking page">›</button>`;
  }
  async function loadMetadata() {
    if (metadataLoading) return;
    metadataLoading = true;
    if (latest.metadataStatus === 'unavailable') {
      context.setMetadata([], 'loading');
      renderRecommendations();
    }
    const metadata = await AnivizData.dashboard().catch(() => null);
    metadataLoading = false;
    latest = context.setMetadata(metadata?.anime || [], metadata ? 'ready' : 'unavailable', metadata?.meta.generated_at);
    if (!isReverse()) { populateFilterChoices(); renderRecommendations(); }
    restoreScroll();
  }
  async function loadPopularity() {
    if (!isReverse()) { void loadMetadata(); return; }
    if (!['idle', 'unavailable'].includes(latest.popularity.status)) return;
    context.setMoviePopularity(null, 'loading');
    renderRecommendations();
    const payload = await AnivizData.moviePopularity(recommendationState.data).catch(() => null);
    context.setMoviePopularity(payload, payload ? 'ready' : 'unavailable');
    if (isReverse()) renderRecommendations();
    restoreScroll();
  }
  async function loadMovieDetails() {
    if (!isReverse() || movieDetailsLoading || movieDetailsLoaded) return;
    movieDetailsLoading = true;
    const details = await AnivizData.movieDetails(recommendationState.data).catch(() => null);
    movieDetailsLoading = false;
    if (details) {
      movieDetailsLoaded = true;
      context.setMovieDetails(details);
    }
  }
  function loadSavedPopularity() {
    if (latest.popularity.status === 'idle' && latest.magnetKeys.includes(latest.popularity.key)) void loadPopularity();
  }
  function bind() {
    let storage;
    try { storage = sessionStorage; } catch (_) { /* Context reports storage denial. */ }
    context = AnivizDust.createContext({ storage, onNotice: notice });
    context.restore();
    latest = context.snapshot();
    composition = AnivizComposition.create({ onError: error => console.error(error) });
    document.querySelectorAll('[data-dust-chart]').forEach(container => {
      const kind = container.dataset.dustChart;
      composition.mount(container, kind === 'connections' ? AnivizDustConnections.create({ container, d3, color,
          onSelect: key => select(key, { showDrawer: true }),
          onCoverage: text => { $('[data-coverage="connections"]').textContent = text; }, renderEmpty })
        : AnivizCharts.create(kind, { container, d3, helpers: chartHelpers() }), {
          preserveHeight: kind === 'connections',
          enabled: value => !value.countOnly || !container.matches('[data-anime-chart]')
        });
    });
    context.subscribe(publish);
    $('[data-dust-genre-metric]').addEventListener('change', () => publish(context.snapshot()));
    $('[data-dust-ranking-sort]').addEventListener('change', event => context.setRankingSort(event.target.value));
    $('[data-dust-ranking-order]').addEventListener('change', event => context.setRankingOrder(event.target.value));
    $('[data-dust-ranking-pages]').addEventListener('click', event => {
      const button = event.target.closest('[data-dust-page]');
      if (button && !button.disabled) { rankingPage = Number(button.dataset.dustPage); renderRanking(); }
    });
    $('[data-dust-ranking-body]').addEventListener('click', event => {
      const button = event.target.closest('[data-dust-rank-id]');
      if (button) inspectTitle(button.dataset.dustRankId);
    });
    $('#recommendation-detail').addEventListener('click', event => {
      const remove = event.target.closest('[data-dust-remove]');
      if (remove) context.setSelection(latest.selectedKeys.filter(key => key !== remove.dataset.dustRemove));
      if (event.target.closest('[data-dust-clear]')) context.setSelection([]);
    });
    bindRecommendationControls();
    void loadMetadata();
  }
  function loadLayout() {
    const layout = context.getLayout();
    recommendationState.magnetPositions = { ...layout.magnetPositions };
    magnetColors.clear();
    Object.entries(layout.magnetColors || {}).forEach(([key, value]) => magnetColors.set(key, value));
    const particles = layout.particles;
    const positions = Array.isArray(particles?.positions) ? particles.positions.filter(node =>
      typeof node?.key === 'string' && Number.isFinite(node.x) && Number.isFinite(node.y)) : [];
    dustChart = positions.length && particles.width > 0 && particles.height > 0
      ? { ...particles, positions: new Map(positions.map(node => [node.key, node])), stop() {} } : null;
  }
  function updateDirectionControls() {
    const reverse = isReverse();
    $('#dust-direction').value = latest.direction;
    $('#dust-limit-control span').textContent = reverse ? 'Movie dots' : 'Anime dots';
    $('#filter-title').textContent = `Filter ${dustNoun()}`;
    $('#dust-filter-search-label').textContent = reverse ? 'Search titles or aliases' : 'Search titles, studios, or actors';
    elements.searchInput.placeholder = reverse ? 'e.g. Pacific Rim' : 'e.g. Attack on Titan';
    $('#dust-focus').setAttribute('aria-label', reverse ? 'Movie in focus' : 'Anime in focus');
    $('#dust-ranking-title').textContent = `Full ${reverse ? 'movie' : 'anime'} ranking`;
    $('#reception h3').textContent = reverse ? 'Reception' : 'Score vs. popularity';
    $('#creators h3').textContent = reverse ? 'Creators' : 'Studios';
    document.querySelectorAll('[data-anime-only], [data-anime-chart]').forEach(node => { node.hidden = reverse; });
    populateFilterChoices();
    resetMagnetPicker();
  }
  function restoreScroll() {
    if (scrollRestored || !recommendationState.data
      || (latest.magnets.some(magnet => magnet.kind !== 'popularity') && !recommendationState.scores)
      || (!isReverse() && latest.metadataStatus === 'loading')
      || (latest.magnetKeys.includes(latest.popularity.key) && latest.popularity.status === 'loading')) return;
    scrollRestored = true;
    const direction = latest.direction;
    requestAnimationFrame(() => {
      if (latest.direction !== direction) return;
      const returning = ['back_forward', 'reload'].includes(performance.getEntriesByType('navigation')[0]?.type);
      const target = !returning && ['#content', '#creators', '#reception'].includes(location.hash) ? $(location.hash) : null;
      if (target) target.scrollIntoView();
      else window.scrollTo(0, context.getLayout().scrollY || 0);
    });
  }
  function saveLayout() {
    if (!context || !recommendationState.data) return;
    const particles = dustChart ? { width: dustChart.width, height: dustChart.height,
      positions: [...dustChart.positions.values()].map(({ key, x, y, vx, vy }) => ({ key, x, y, vx, vy })) } : null;
    context.saveLayout({ magnetPositions: recommendationState.magnetPositions, magnetColors: Object.fromEntries(magnetColors),
      particles, scrollY: scrollRestored ? window.scrollY : context.getLayout().scrollY });
  }
  root.AnivizMain = {
    initialize(data) {
      loadLayout();
      context.setSources(data, null, { seedExample: true });
      updateDirectionControls();
      void loadMovieDetails();
      loadSavedPopularity();
      restoreScroll();
    },
    setScores(scores) { context.setSources(recommendationState.data, scores); restoreScroll(); },
    switchDirection(direction) {
      if (direction === latest.direction || !Object.hasOwn(AnivizDust.DIRECTIONS, direction)) return;
      stopDustChart();
      saveLayout();
      closeDrawer();
      if (!pendingNotice.startsWith('Session storage')) notice('');
      context.setDirection(direction);
      void loadMovieDetails();
      loadSavedPopularity();
      renderRecommendations();
      scrollRestored = true;
      window.scrollTo(0, context.getLayout().scrollY || 0);
    },
    setMagnets(keys) { context.setMagnets(keys); renderRecommendations(); },
    setDustLimit(value) { context.setDustLimit(value); renderRecommendations(); },
    select, color, saveLayout, loadPopularity,
    deselectLast() {
      if (latest.selectedKeys.length) context.setSelection(latest.selectedKeys.slice(0, -1));
    },
    resetPositions() {
      stopDustChart();
      context.resetPositions();
      recommendationState.magnetPositions = {};
      dustChart = null;
      renderRecommendations();
    },
    snapshot: () => latest
  };
  registerPage({ usesDashboard: false, bindControls: bind, applyFilters, resetFilters,
    render() { composition?.setActive(!document.hidden); renderRecommendations(); composition?.refresh(); },
    pause() { saveLayout(); stopDustChart(); composition?.setActive(false); },
    destroy() { saveLayout(); stopDustChart(); composition?.destroy(); }
  });
})(globalThis);
