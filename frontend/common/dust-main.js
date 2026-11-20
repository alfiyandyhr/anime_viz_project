"use strict";
// Connect one directional dust snapshot to the field, details and analysis.
(function (root) {
  let context, composition, latest, rankingPage = 0, rankingSignature = "";
  let scrollRestored = false, pendingNotice = "", metadataLoading = false;
  let movieDetailsRequest, focusedMagnetKey = null, inspectedMovieKey = null;
  let brushedKeys = new Set(), brushedTitleIds = new Set();
  const chartRenderers = [];
  const $ = selector => document.querySelector(selector);
  const dustTypeByDirection = {
    [AnivizDust.FORWARD]: 'anime-titles',
    [AnivizDust.STUDIOS]: 'anime-studios',
    [AnivizDust.ACTORS]: 'anime-voice-actors',
    [AnivizDust.ORIGINAL_CREATORS]: 'anime-original-creators',
    [AnivizDust.REVERSE]: 'movie-titles',
    [AnivizDust.MOVIE_ACTORS]: 'movie-actors',
    [AnivizDust.MOVIE_WRITERS]: 'movie-writers'
  };
  const magnetColors = new Map();
  const isReverse = () => AnivizDust.isMovieDust(latest.direction);
  const isStudio = () => latest.direction === AnivizDust.STUDIOS;
  const isOriginalCreatorDust = () => latest.direction === AnivizDust.ORIGINAL_CREATORS;
  const dustGroup = () => AnivizDust.groupFor(latest.direction);
  const isMoviePersonDust = () => isReverse() && Boolean(dustGroup());
  const dustNoun = () => dustGroup()?.noun || (isReverse() ? "movies" : "anime");
  const detailHelpers = () => ({ escapeHTML, escapeAttribute, humanize, formatNumber });
  const color = key => magnetColors.get(key);
  const brushColor = highlighted => highlighted ? DUST_BRUSH_COLOR : DUST_UNIFORM_COLOR;
  const dustColor = match => latest.colorByMagnet
    ? color(latest.activeMagnetKeys[match.closest]) : brushColor(brushedKeys.has(match.key));
  const linkedTitleColor = ids => brushColor(ids.some(id => brushedTitleIds.has(String(id))));
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
    if (!dustGroup()) elements.studioFilter.value = filters.studio;
    elements.formatFilter.value = filters.format;
    elements.scoreFilter.value = filters.minimumScore;
    elements.scoreOutput.value = filters.minimumScore;
  }
  function populateFilterChoices() {
    const records = [...latest.titleLookup.values()].map(row => row.record);
    const choices = field => [...new Set(records.flatMap(record => record[field] || []))].sort();
    populateSelect(elements.genreFilter, choices('genres'), 'All genres');
    if (!isReverse()) {
      if (!dustGroup()) populateSelect(elements.studioFilter, choices('studio_names'),
        latest.metadataStatus === 'unavailable' ? 'Studios unavailable' : 'All studios');
      populateSelect(elements.formatFilter, choices('format'), 'All formats', humanize);
    }
    const years = records.map(record => record.year).filter(Number.isFinite);
    const first = years.length ? Math.min(...years) : 1900;
    const last = years.length ? Math.max(...years) : new Date().getFullYear();
    elements.yearFrom.innerHTML = elements.yearTo.innerHTML =
      Array.from({ length: last - first + 1 }, (_, i) => `<option value="${first + i}">${first + i}</option>`).join('');
    for (const [key, control] of [['genre', elements.genreFilter], ['yearFrom', elements.yearFrom],
      ['yearTo', elements.yearTo], ...(!isReverse() ? [['format', elements.formatFilter]] : []),
      ...(!isReverse() && !dustGroup() ? [['studio', elements.studioFilter]] : [])]) {
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
    const record = latest.titleLookup.get(key)?.record;
    if (!record) return;
    const { ranking, magnets } = latest;
    const match = ranking.find(row => row.key === key);
    if (key.startsWith('tmdb:')) {
      inspectedMovieKey = key;
      renderMovieDrawer(record, match);
      openDrawer('Movie details');
      loadMovieDetails();
    } else {
      const similarityHtml = magnets.some(magnet => magnet.kind !== undefined)
        ? AnivizDustDetails.magnetScores(match, magnets, color, detailHelpers()) : '';
      const cover = { ...record.cover, large: record.cover?.large || AnivizArtwork.animeThumbnail(record) };
      openAnimeDetail({ ...record, cover, description: record.description || record.synopsis,
        site_url: record.site_url || record.url || `https://anilist.co/anime/${record.id}` }, { similarityHtml });
    }
  }
  function renderMovieDrawer(record, match) {
    elements.drawerContent.innerHTML = `<div class="dust-movie-drawer">${AnivizArtwork.movieHero(record, escapeAttribute)}${AnivizDustDetails.renderMovie({
      record, match, magnets: latest.magnets, color, helpers: detailHelpers(), heading: 'h2'
    })}</div>`;
  }
  function inspectRanking(key) {
    const group = dustGroup();
    if (!group) { inspectTitle(key); return; }
    const match = latest.ranking.find(row => row.key === key);
    if (!match) return;
    elements.drawerContent.innerHTML = AnivizDustDetails.renderGroup({
      snapshot: latest, match, color, helpers: detailHelpers(), heading: 'h2'
    });
    openDrawer(`${group.label} details`);
  }
  function select(key, { showDrawer = false } = {}) {
    if (!latest.displayedKeys.includes(key)) return;
    const wasSelected = latest.selectedKeys.includes(key);
    if (wasSelected || latest.selectedKeys.length < 3) focusedMagnetKey = null;
    if (pendingNotice.startsWith('Compare up to 3')) notice('');
    context.toggleSelection(key);
    if (showDrawer && !wasSelected && !dustGroup()) inspectTitle(key);
  }
  function focusMagnet(key) {
    if (!context.getMagnetRecord(key)) return;
    focusedMagnetKey = key;
    renderFocus();
    if (!isReverse()) loadMovieDetails();
  }
  function renderFocus(result = detailResult()) {
    const focus = $('#dust-focus');
    focus.setAttribute('aria-label', result.focusLabel);
    if (focus.innerHTML !== result.focusHtml) { focus.innerHTML = result.focusHtml; focus.scrollTop = 0; }
  }
  function detailResult() {
    return AnivizDustDetails.render({ snapshot: latest, focusedMagnet: context.getMagnetRecord(focusedMagnetKey),
      color, helpers: detailHelpers() });
  }
  function renderDetails() {
    const result = detailResult();
    const detail = $('#recommendation-detail'), cue = $('#dust-selection');
    renderFocus(result);
    detail.hidden = !result.html;
    detail.innerHTML = result.html;
    cue.hidden = !result.html;
    cue.innerHTML = result.html ? `<a href="#recommendation-detail">${result.count > 1
      ? `Comparing ${result.count} ${dustNoun()}` : `Selected ${dustGroup()?.label.toLowerCase() || 'title'}`} · below ↓</a>` : '';
  }
  function updateBrushedTitles() {
    const grouped = dustGroup();
    brushedTitleIds = new Set(latest.displayedDust.filter(match => brushedKeys.has(match.key))
      .flatMap(({ record }) => grouped ? record.memberIds.map(String) : [String(record.id)]));
  }
  function setBrushedKeys(keys) {
    if (keys.length === brushedKeys.size && keys.every(key => brushedKeys.has(key))) return;
    brushedKeys = new Set(keys);
    updateBrushedTitles();
    if (latest.colorByMagnet) return;
    dustChart?.views?.forEach(view => view.drawColors());
    chartRenderers.forEach(renderer => renderer.recolor?.());
    recolorRanking();
  }
  function publish(snapshot) {
    const switched = latest.direction !== snapshot.direction;
    const recolor = latest.colorByMagnet !== snapshot.colorByMagnet;
    const magnetsChanged = switched || latest.activeMagnetKeys.join('|') !== snapshot.activeMagnetKeys.join('|');
    const strengthOnly = latest.magnetStrengths !== snapshot.magnetStrengths && latest.magnets === snapshot.magnets;
    latest = snapshot;
    if (strengthOnly) {
      syncMotionControls();
      dustChart?.setMagnetStrengths?.(snapshot.magnetStrengths);
      return;
    }
    if (switched || !snapshot.activeMagnetKeys.includes(focusedMagnetKey)) focusedMagnetKey = null;
    if (switched) {
      brushedKeys.clear();
      loadLayout();
    }
    updateBrushedTitles();
    const reverse = isReverse(), studios = isStudio(), group = dustGroup();
    const people = group && !studios;
    const used = new Set();
    snapshot.activeMagnetKeys.forEach(key => {
      let value = magnetColors.get(key);
      if (!MAGNET_COLORS.includes(value) || used.has(value)) value = MAGNET_COLORS.find(candidate => !used.has(candidate));
      magnetColors.set(key, value);
      used.add(value);
    });
    if (magnetsChanged) renderMotionControls();
    if (switched) updateDustTypeControls();
    $('#dust-color-by-magnet').checked = snapshot.colorByMagnet;
    $('#dust-color-by-brush').checked = !snapshot.colorByMagnet;
    if (recolor) refreshDustColors();
    const keysInScope = snapshot.selectedKeys.length ? snapshot.selectedKeys : snapshot.displayedKeys;
    const studioGroups = studios ? keysInScope.map(key => snapshot.lookup.get(key)?.record).filter(Boolean) : null;
    const provider = AnivizDust.DIRECTIONS[snapshot.direction].dust;
    const titleFor = id => snapshot.titleLookup.get(AnivizDust.keyFor(provider, id)).record;
    const records = group ? (people
      ? [...new Set(snapshot.displayedDust.flatMap(match => match.record.memberIds))]
      : snapshot.supportingIds).map(titleFor)
      : snapshot.displayedKeys.map(key => snapshot.lookup.get(key).record);
    const receptionTitles = people && snapshot.selectedKeys.length ? snapshot.supportingIds.map(titleFor) : records;
    const dustMatches = new Map(snapshot.displayedDust.map(match => [match.key, match]));
    const metric = $('[data-dust-genre-metric]').value;
    const creditMode = $('[data-dust-credit-mode]').value;
    const heatmapMode = $('[data-dust-heatmap-mode]').value;
    const selectedIds = people ? (snapshot.selectedKeys.length ? snapshot.supportingIds : [])
      : studios ? [] : snapshot.selectedKeys.flatMap(key => {
        const record = snapshot.lookup.get(key)?.record;
        return record ? [String(record.id)] : [];
      });
    composition.update({ anime: records, selectedIds, hasSelection: !group,
      filmography: group ? receptionTitles : null,
      studioGroups, creditMode, heatmapMode,
      animeCredits: snapshot.animeCredits, animeCreditsStatus: snapshot.animeCreditsStatus,
      metadataStatus: snapshot.metadataStatus,
      metric, movieRankLimit: reverse ? Math.max(2, snapshot.titleLookup.size) : null,
      onSelect: id => {
        const key = AnivizDust.keyFor(provider, id);
        if (!group) select(key);
        inspectTitle(key);
      },
      brushColor: snapshot.colorByMagnet ? null : linkedTitleColor,
      dustColor: id => {
        const match = dustMatches.get(AnivizDust.keyFor(provider, id));
        return match ? dustColor(match) : undefined;
      },
      dustMatchColor: key => dustColor(dustMatches.get(key)), snapshot });
    const count = records.length, candidates = snapshot.candidateKeys.length;
    const filmographyScope = $('#dust-studio-scope');
    filmographyScope.hidden = !group;
    if (group) {
      const selectedNames = snapshot.selectedKeys.map(key => snapshot.lookup.get(key)?.record.title).filter(Boolean);
      const label = selectedNames.length ? `Selected ${group.noun}: ${selectedNames.join(', ')}` : `Displayed ${group.noun}`;
      const filmographyCount = receptionTitles.length;
      filmographyScope.textContent = `${label} · ${filmographyCount} distinct catalogue ${AnivizDust.titleNoun(snapshot.direction, filmographyCount)}. Shared credits count once.`;
    }
    $('[data-dust-scope]').textContent = elements.filterSummary.textContent = group
      ? `${snapshot.displayedKeys.length} ${group.noun} shown`
      : `${count} / ${candidates} ${dustNoun()}`;
    $('#dust-limit').value = snapshot.dustLimit;
    const unit = group?.noun || 'titles';
    const scoreLabel = snapshot.mixed ? 'attraction percentiles' : group ? 'mean story similarity' : 'similarity scores';
    const brushNote = snapshot.colorByMagnet ? '' : 'Drag or resize the brush to highlight matching data below. ';
    $('#recommendation-score-note').textContent = `${brushNote}Zoom in for ${studios ? 'studio names' : people ? 'portraits' : 'posters'}. Hover or focus for ${scoreLabel}. Thicker links show a stronger pull. Select up to 3 ${unit}.`;
    const colorNote = snapshot.colorByMagnet ? ` Color identifies each ${group?.label.toLowerCase() || 'title'}’s highest-scoring magnet.` : '';
    $('#dust-connection-method').textContent = `Select a magnet to rank the displayed ${unit} by ${snapshot.mixed ? 'attraction percentile' : group ? 'mean signed cosine similarity' : 'cosine similarity'}. Thicker curves show higher scores within that magnet’s range.${colorNote} Dust members lists the ${unit} that score highest for the selected magnet. Scroll either list to see more ${unit}.`;
    const notes = {
      genres: [metric === 'count' ? 'Genres' : 'Genre ' + metric,
        row => row.genres.length && (metric === 'score' ? Number.isFinite(row.average_score) : metric !== 'popularity' || Number.isFinite(row.popularity)),
        reverse && metric === 'popularity' ? 'Sum of TMDB popularity scores. Titles can belong to multiple genres.' : 'Titles can belong to multiple genres.'],
      years: ['Release years', row => Number.isFinite(row.year), reverse ? 'Bars: movies · line: average TMDB score.' : 'Bars: titles · line: average score.']
    };
    if (reverse) {
      notes.reception = ['Movies with TMDB score and rank', AnivizChartData.hasMovieReception,
        snapshot.popularity.snapshotDate
          ? `TMDB snapshot ${snapshot.popularity.snapshotDate} UTC · Rank #1 is most popular in the movie sample.${colorNote}`
          : snapshot.popularity.status === 'unavailable' ? 'Archived TMDB reception data unavailable.'
            : 'Loading archived TMDB reception data…'];
    } else {
      notes.reception = ['Ratings', row => row.popularity > 0 && Number.isFinite(row.average_score), `Circle area: favourites.${group ? '' : colorNote}`];
    }
    Object.entries(notes).forEach(([kind, [label, predicate, suffix]]) => {
      const chartRecords = kind === 'reception' ? receptionTitles : records;
      const available = chartRecords.filter(predicate).length;
      $(`[data-coverage="${kind}"]`).textContent = !reverse && snapshot.metadataStatus === 'unavailable' && kind === 'reception'
        ? `${label} unavailable: metadata failed to load.` : (available < chartRecords.length ? `${label}: ${available} of ${chartRecords.length} · ` : '') + suffix;
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
      const label = snapshot.mixed || magnet.kind === 'genre' ? AnivizDust.magnetScoreLabel(magnet) : `Similarity to M${i + 1} · ${magnet.title}`;
      return `<option value="${escapeAttribute(magnet.key)}">${escapeHTML(label)}</option>`;
    }).join('');
    sort.value = snapshot.activeMagnetKeys.includes(snapshot.rankingSortKey) ? snapshot.rankingSortKey : 'average';
    $('[data-dust-ranking-order]').value = snapshot.rankingOrder;
    renderRanking();
    renderDetails();
    highlightRecommendation();
  }
  function recolorRanking() {
    const body = $('[data-dust-ranking-body]');
    body.classList.toggle('is-brushing', !latest.colorByMagnet);
    if (latest.colorByMagnet) return;
    for (const button of body.querySelectorAll('[data-dust-rank-id]')) {
      button.closest('tr').style.setProperty('--dust-color', brushColor(brushedKeys.has(button.dataset.dustRankId)));
    }
  }
  function renderRanking() {
    const { ranking, magnets, rankingOrder, mixed, selectedKeys } = latest, size = 10;
    const body = $('[data-dust-ranking-body]');
    const focusedKey = document.activeElement?.dataset.dustRankSelect;
    $('[data-dust-ranking-notice]').textContent = '';
    const total = Math.max(1, Math.ceil(ranking.length / size));
    rankingPage = Math.min(rankingPage, total - 1);
    const ordered = rankingOrder !== 'descending' ? ranking
      : [...ranking.filter(match => match.rank !== null).reverse(), ...ranking.filter(match => match.rank === null)];
    const start = rankingPage * size, rows = ordered.slice(start, start + size);
    const ranked = rows.filter(match => match.rank !== null);
    const metricNote = mixed
      ? ` · ${magnets.filter(AnivizDust.isMetricMagnet).map(metricDescription).join(' · ')}. Individual sorts use raw values. Combined ranks require values for all active metrics.` : '';
    const group = dustGroup();
    const corpus = group ? latest.lookup.size : ranking.length;
    const coverageNote = group ? ` · Filters apply to the field. Tied ranks list ${group.noun} with more catalogue titles first.` : '';
    $('[data-dust-ranking-note]').textContent = `${corpus} corpus ${dustNoun()} · ${ranked.length ? `ranks ${ranked[0].rank}–${ranked.at(-1).rank}` : 'Ranks unavailable'}` + metricNote + coverageNote;
    const title = group?.label || (isReverse() ? 'Movie' : 'Anime');
    const cohortLabels = magnets.map(magnet => magnet.kind === 'genre' ? AnivizDust.magnetScoreLabel(magnet) : '');
    const average = AnivizDust.averageLabel(mixed);
    const coverageHeading = group ? (isReverse() ? 'Movie counts' : 'Anime counts') : isReverse() ? 'Year' : 'Format / year';
    $('[data-dust-ranking-head]').innerHTML = `<tr><th scope="col" aria-sort="${rankingOrder}">Rank</th><th scope="col">${title}</th>${magnets.map((magnet, i) => `<th scope="col">M${i + 1} · ${escapeHTML(mixed ? AnivizDust.magnetScoreLabel(magnet) : cohortLabels[i] || magnet.title)}</th>`).join('')}<th scope="col">${average}</th><th scope="col">${coverageHeading}</th><th scope="col">Displayed dust</th></tr>`;
    body.innerHTML = rows.map(match => {
      const { record } = match;
      const artwork = latest.lookup.get(match.key).record;
      const cover = AnivizArtwork.dustThumbnail(artwork, match.key);
      const thumbnail = cover ? `<img src="${escapeAttribute(cover)}" alt="" loading="lazy">` : '';
      const year = record.year || 'Unknown';
      const format = group || isReverse() ? '' : escapeHTML(humanize(record.format)) + ' / ';
      const evidence = group ? formatNumber(record.memberIds.length) : format + year;
      const scores = match.scores.map((score, i) => mixed
        ? `<td title="${escapeAttribute(AnivizDust.mixedEvidence(match, magnets[i], i))}">${AnivizDust.formatRawScore(match.rawScores[i], magnets[i])}<br><small>Percentile ${AnivizDust.formatPercentile(score)}</small></td>`
        : `<td title="${escapeAttribute(cohortLabels[i] ? `${cohortLabels[i]}: ${score}` : `Cosine ${score}`)}">${AnivizDust.formatPercentile(score)}</td>`);
      const key = escapeAttribute(match.key);
      const selected = selectedKeys.includes(match.key);
      const comparison = match.displayed ? `<button type="button" class="small-button ghost" data-dust-rank-select="${key}" aria-label="Compare ${escapeAttribute(record.title)}" aria-pressed="${selected}"><span aria-hidden="true">✓</span> Compare</button>` : '—';
      return `<tr${selected ? ' class="is-selected"' : ''}><td>${match.rank ?? 'Unavailable'}</td><td><button type="button" class="recommendation-title-button anime-cell" data-dust-rank-id="${key}" aria-haspopup="dialog" aria-controls="detail-drawer">${thumbnail}${escapeHTML(record.title)}</button></td>${scores.join('')}<td title="${mixed ? average : 'Average cosine'} ${match.score ?? 'unavailable'}">${AnivizDust.formatPercentile(match.score)}</td><td>${evidence}</td><td>${comparison}</td></tr>`;
    }).join('');
    recolorRanking();
    if (focusedKey) body.querySelector(`[data-dust-rank-select="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
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
    else if (focusedMagnetKey) renderFocus();
    restoreScroll();
  }
  async function loadMetricData() {
    if (!isReverse()) {
      if (isOriginalCreatorDust()) void loadAnimeCredits();
      if (!isOriginalCreatorDust() || latest.metadataStatus !== 'ready') void loadMetadata();
      return;
    }
    const { status } = latest.popularity;
    if (!['idle', 'unavailable'].includes(status)) return;
    context.setMoviePopularity(null, 'loading');
    renderRecommendations();
    const payload = await AnivizData.moviePopularity(recommendationState.data, { retry: status === 'unavailable' })
      .catch(() => null);
    context.setMoviePopularity(payload, payload ? 'ready' : 'unavailable');
    if (isReverse()) renderRecommendations();
    restoreScroll();
  }
  async function loadAnimeCredits() {
    if (!['idle', 'unavailable'].includes(latest.animeCreditsStatus)) return;
    context.setAnimeCredits(null, 'loading');
    if (isOriginalCreatorDust()) renderRecommendations();
    const credits = await AnivizData.animeCredits().catch(() => null);
    context.setAnimeCredits(credits, credits ? 'ready' : 'unavailable');
    if (isOriginalCreatorDust()) renderRecommendations();
    restoreScroll();
  }
  function loadMovieDetails() {
    if (movieDetailsRequest || !recommendationState.data) return;
    context.setMovieDetails(null, 'loading');
    movieDetailsRequest = AnivizData.movieDetails(recommendationState.data)
      .then(details => {
        context.setMovieDetails(details);
        if (isMoviePersonDust()) renderRecommendations();
        else if (isReverse()) dustChart?.views?.forEach(view => view.drawArtwork());
        if (!isReverse() && focusedMagnetKey) renderFocus();
        if (isReverse() && elements.drawer.classList.contains('open')) {
          const drawer = elements.drawerContent.querySelector('.dust-movie-drawer');
          const record = latest.titleLookup.get(inspectedMovieKey)?.record;
          if (drawer && record) renderMovieDrawer(record, latest.ranking.find(row => row.key === inspectedMovieKey));
        }
      }, () => {
        movieDetailsRequest = null;
        context.setMovieDetails(null, 'unavailable');
        if (isMoviePersonDust()) renderRecommendations();
      })
      .finally(restoreScroll);
    if (isMoviePersonDust()) renderRecommendations();
  }
  function bind() {
    let storage;
    try { storage = sessionStorage; } catch (_) { /* Context reports storage denial. */ }
    context = AnivizDust.createContext({ storage, onNotice: notice });
    context.restore();
    latest = context.snapshot();
    $('#dust-magnet-strengths').addEventListener('input', event => {
      const input = event.target;
      context.setMagnetStrength(input.dataset.magnetStrength, input.valueAsNumber);
    });
    $('#reset-dust-motion').addEventListener('click', () => context.resetMagnetStrengths());
    composition = AnivizComposition.create({ onError: error => console.error(error) });
    document.querySelectorAll('[data-dust-chart]').forEach(container => {
      const kind = container.dataset.dustChart;
      const renderer = kind === 'connections' ? AnivizDustConnections.create({ container, d3, color,
          onSelect: key => select(key, { showDrawer: true }),
          onCoverage: text => { $('[data-coverage="connections"]').textContent = text; }, renderEmpty })
        : AnivizCharts.create(kind, { container, d3, helpers: chartHelpers() });
      chartRenderers.push(renderer);
      composition.mount(container, renderer, {
        preserveHeight: kind === 'connections',
        enabled: value => !value.movieRankLimit || !container.matches('[data-anime-chart]')
      });
    });
    context.subscribe(publish);
    $('#dust-color-mode').addEventListener('change', event => context.setColorByMagnet(event.target.value === 'magnet'));
    $('[data-dust-genre-metric]').addEventListener('change', () => publish(context.snapshot()));
    for (const selector of ['[data-dust-credit-mode]', '[data-dust-heatmap-mode]']) {
      $(selector).addEventListener('change', event => {
        if (event.target.value.split(':')[0] === 'originalCreators') void loadAnimeCredits();
        publish(context.snapshot());
      });
    }
    $('[data-dust-ranking-sort]').addEventListener('change', event => context.setRankingSort(event.target.value));
    $('[data-dust-ranking-order]').addEventListener('change', event => context.setRankingOrder(event.target.value));
    $('[data-dust-ranking-pages]').addEventListener('click', event => {
      const button = event.target.closest('[data-dust-page]');
      if (button && !button.disabled) { rankingPage = Number(button.dataset.dustPage); renderRanking(); }
    });
    $('[data-dust-ranking-body]').addEventListener('click', event => {
      const toggle = event.target.closest('[data-dust-rank-select]');
      if (toggle) {
        select(toggle.dataset.dustRankSelect);
        if (pendingNotice.startsWith('Compare up to 3')) $('[data-dust-ranking-notice]').textContent = pendingNotice;
        return;
      }
      const button = event.target.closest('tr')?.querySelector('[data-dust-rank-id]');
      if (button) {
        button.focus({ preventScroll: true });
        inspectRanking(button.dataset.dustRankId);
      }
    });
    for (const panel of [$('#dust-focus'), elements.drawerContent]) {
      panel.addEventListener('click', event => {
        const button = event.target.closest('[data-studio-work], [data-actor-work], [data-writer-work], [data-creator-work]');
        if (button) inspectTitle(button.dataset.studioWork || button.dataset.actorWork || button.dataset.writerWork || button.dataset.creatorWork);
      });
    }
    $('#recommendation-detail').addEventListener('click', event => {
      const remove = event.target.closest('[data-dust-remove]');
      if (remove) context.setSelection(latest.selectedKeys.filter(key => key !== remove.dataset.dustRemove));
      if (event.target.closest('[data-dust-clear]')) context.setSelection([]);
    });
    bindRecommendationControls();
    void loadMetadata();
  }
  function renderMotionControls() {
    const controls = $('#dust-magnet-strengths');
    controls.closest('fieldset').hidden = !latest.magnets.length;
    controls.innerHTML = latest.magnets.map(({ key, title }, index) => {
      const id = `dust-magnet-strength-${index + 1}`;
      return `<div class="dust-motion-setting" style="--magnet-color:${color(key)}">
        <label for="${id}">M${index + 1} · ${escapeHTML(title)}</label>
        <output for="${id}" aria-hidden="true"></output>
        <input id="${id}" data-magnet-strength="${escapeAttribute(key)}" type="range" min="0" max="2" step="0.1"
          aria-label="${escapeAttribute(title)} strength">
      </div>`;
    }).join('');
    syncMotionControls();
  }
  function syncMotionControls() {
    for (const input of $('#dust-magnet-strengths').querySelectorAll('input')) {
      const strength = latest.magnetStrengths[input.dataset.magnetStrength] ?? 1;
      const value = strength.toFixed(1);
      input.value = value;
      input.setAttribute('aria-valuetext', `${value} times`);
      input.previousElementSibling.value = `${value}×`;
    }
  }
  function loadLayout() {
    const layout = context.getLayout();
    recommendationState.magnetPositions = { ...layout.magnetPositions };
    magnetColors.clear();
    Object.entries(layout.magnetColors || {}).forEach(([key, value]) => {
      magnetColors.set(key, value === 'var(--color-primary-strong)' ? DUST_MAGNET_VIOLET : value);
    });
    const particles = layout.particles;
    const positions = Array.isArray(particles?.positions) ? particles.positions.filter(node =>
      typeof node?.key === 'string' && Number.isFinite(node.x) && Number.isFinite(node.y)) : [];
    dustChart = positions.length && particles.width > 0 && particles.height > 0
      ? { ...particles, positions: new Map(positions.map(node => [node.key, node])), stop() {} } : null;
  }
  function updateDustTypeControls() {
    const reverse = isReverse(), studios = isStudio(), group = dustGroup();
    const groupLabel = group?.label.toLowerCase();
    $('#dust-type').value = dustTypeByDirection[latest.direction];
    $('#dust-limit-control span').textContent = group ? `${group.label} dots` : reverse ? 'Movie dots' : 'Anime dots';
    $('#filter-title').textContent = `Filter ${dustNoun()}`;
    $('#dust-filter-search-label').textContent = group ? `Search ${groupLabel} names` : reverse ? 'Search titles or aliases' : 'Search titles, studios, or actors';
    const searchExamples = {
      [AnivizDust.STUDIOS]: 'MADHOUSE',
      [AnivizDust.ACTORS]: 'Kana Hanazawa',
      [AnivizDust.ORIGINAL_CREATORS]: 'Hajime Isayama',
      [AnivizDust.MOVIE_ACTORS]: 'Keanu Reeves',
      [AnivizDust.MOVIE_WRITERS]: 'Christopher Nolan'
    };
    elements.searchInput.placeholder = `e.g. ${searchExamples[latest.direction] || (reverse ? 'Pacific Rim' : 'Attack on Titan')}`;
    $('#dust-ranking-title').textContent = `Full ${groupLabel || (reverse ? 'movie' : 'anime')} ranking`;
    $('#reception h3').textContent = reverse ? 'Score vs. popularity rank'
      : group ? 'Score vs. popularity of catalogue anime' : 'Score vs. popularity';
    $('#dust-reception-guide').textContent = 'Zoom in for posters. Select a title to open its details.';
    $('#content h3').textContent = studios ? 'Genres of catalogue anime' : 'Genres';
    $('#content + article h3').textContent = studios ? 'Release years of catalogue anime' : 'Release years';
    $('#dust-connection-title').textContent = group ? `How do ${group.noun} compare against each magnet?` : 'Which stories are similar—and which differ?';
    $('#dust-connection-selection').textContent = studios
      ? 'Select up to three studios here or in the field to focus the analysis below on their catalogue anime. Select a studio again to remove it.'
      : group ? `Select up to three ${group.noun} here or in the field to filter ${reverse ? 'Score vs. popularity rank' : 'Score vs. popularity'} to their ${AnivizDust.titleNoun(latest.direction)} and highlight their contributions in the other charts. Select a dot again to remove it.`
        : 'Outlined titles are selected for comparison in the playground and here. Click an outlined title to remove it. Click any other title to open its details and add it to the comparison if there’s room for it. Compare up to three titles.';
    $('#dust-mirror-guide').textContent = `Zoom in for ${studios ? 'studio names' : group ? 'portraits' : 'posters'}. Select a title magnet to show it in the In Focus panel. Drag magnets or use arrow keys to move them. Select ${group?.noun || 'titles'} to compare them, or click empty space to remove the latest selection.`;
    $('[data-dust-genre-metric] option[value="popularity"]').textContent = reverse ? 'Popularity score' : 'Popularity';
    $('[data-dust-chart="heatmap"]').classList.toggle('studio-heatmap', studios);
    $('[data-title-studio-filter]').hidden = Boolean(group) || reverse;
    document.querySelectorAll('[data-anime-only], [data-anime-chart]').forEach(node => { node.hidden = reverse; });
    populateFilterChoices();
    resetMagnetPicker();
  }
  function restoreScroll() {
    if (scrollRestored || !recommendationState.data
      || (latest.magnets.some(magnet => !AnivizDust.isMetricMagnet(magnet)) && !recommendationState.scores)
      || (!isReverse() && latest.metadataStatus === 'loading')
      || (dustGroup() && ['idle', 'loading'].includes(latest.creditStatus))
      || AnivizDust.METRIC_MAGNET_TYPES.some(type => latest.magnetKeys.includes(latest[type].key)
        && ['idle', 'loading'].includes(latest[type].status))) return;
    scrollRestored = true;
    const direction = latest.direction;
    requestAnimationFrame(() => {
      if (latest.direction !== direction) return;
      const returning = ['back_forward', 'reload'].includes(performance.getEntriesByType('navigation')[0]?.type);
      const anchor = location.hash === '#creators' && isReverse() ? '#content' : location.hash;
      const target = !returning && ['#content', '#creators', '#reception'].includes(anchor) ? $(anchor) : null;
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
      updateDustTypeControls();
      if (isReverse()) {
        void loadMetricData();
        loadMovieDetails();
      } else if (isOriginalCreatorDust() || $('[data-dust-credit-mode]').value === 'originalCreators'
        || $('[data-dust-heatmap-mode]').value.startsWith('originalCreators:')) void loadAnimeCredits();
      restoreScroll();
    },
    setScores(scores) { context.setSources(recommendationState.data, scores); restoreScroll(); },
    switchDustType(dustType) {
      const direction = Object.keys(dustTypeByDirection).find(key => dustTypeByDirection[key] === dustType);
      if (!direction || direction === latest.direction) return;
      stopDustChart();
      saveLayout();
      closeDrawer();
      if (!pendingNotice.startsWith('Session storage')) notice('');
      context.setDirection(direction);
      if (isReverse()) {
        void loadMetricData();
        loadMovieDetails();
      } else if (isOriginalCreatorDust()) void loadAnimeCredits();
      renderRecommendations();
      scrollRestored = true;
      window.scrollTo(0, context.getLayout().scrollY || 0);
    },
    setMagnets(keys) { context.setMagnets(keys); renderRecommendations(); },
    setDustLimit(value) { context.setDustLimit(value); renderRecommendations(); },
    select, focusMagnet, color, dustColor, setBrushedKeys, saveLayout, loadMetricData, loadAnimeCredits, loadMovieDetails,
    deselectLast() {
      if (latest.selectedKeys.length) {
        focusedMagnetKey = null;
        context.setSelection(latest.selectedKeys.slice(0, -1));
      }
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
