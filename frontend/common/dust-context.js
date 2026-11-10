"use strict";

// Analytical state only. Particle/magnet positions and scroll live in the session envelope.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnivizDust = api;
})(globalThis, function () {
  const VERSION = 2;
  const STORAGE_KEY = "aniviz-dust-session-v2";
  const LEGACY_KEY = "aniviz-dust-session-v1";
  const FORWARD = "movie-to-anime", REVERSE = "anime-to-movies";
  const DIRECTIONS = {
    [FORWARD]: { magnet: "tmdb", dust: "anilist", example: "Inception" },
    [REVERSE]: { magnet: "anilist", dust: "tmdb", example: "Attack on Titan" }
  };
  const keyFor = (catalogue, id) => `${catalogue}:${id}`;
  const catalogueFor = (data, catalogue) => (catalogue === "tmdb" ? data?.movies : data?.anime) || [];
  const magnetScoreLabel = magnet => magnet.kind === "popularity" ? magnet.metric
    : magnet.kind === "genre" ? `Mean cosine to ${magnet.title}` : `Cosine to ${magnet.title}`;
  const cohortDescription = magnet => `${magnet.source} · ${magnet.memberIds.length} ${magnet.noun}`;
  const popularityKey = direction => keyFor(DIRECTIONS[direction].dust, "popularity");
  const averageLabel = mixed => mixed ? "Average attraction percentile" : "Average similarity";
  const formatPercentile = value => Number.isFinite(value) ? value.toFixed(3) : "Unavailable";
  const formatRawScore = (value, magnet) => Number.isFinite(value) && magnet.kind === "popularity"
    ? String(value) : formatPercentile(value);
  function mixedEvidence(match, magnet, index) {
    const raw = formatRawScore(match.rawScores[index], magnet);
    return `${magnetScoreLabel(magnet)}: ${raw} · Attraction percentile: ${formatPercentile(match.scores[index])}`;
  }
  const defaults = direction => ({ search: "", genre: "All", yearFrom: null, yearTo: null, ...(direction === REVERSE ? {} : { studio: "All", format: "All", minimumScore: 0 }) });
  const id = (value) => String(value);
  const ids = (values) => [...new Set((values || []).filter(v => typeof v === "string" || typeof v === "number").map(id))];
  const finite = (v) => Number.isFinite(v) ? v : null;

  function joinAnimeRecord(record, meta) {
    // Recommendation text can support filtering, but cannot invent ratings, cast or studios.
    return { ...record, ...meta, id: id(record.id),
      genres: meta?.genres || record.genres || [], studio_names: meta?.studio_names || [],
      voice_actors: meta?.voice_actors || [], primary_genre: meta?.primary_genre || record.genres?.[0] || "Unknown",
      average_score: finite(meta?.average_score), popularity: finite(meta?.popularity),
      favourites: finite(meta?.favourites), episodes: finite(meta?.episodes), duration: finite(meta?.duration),
      year: finite(meta?.year ?? record.year), metadataAvailable: Boolean(meta) };
  }

  function joinRecords(recommendations, metadata = []) {
    const dashboard = new Map(metadata.map(row => [id(row.id), row]));
    return new Map(recommendations.map(record => {
      const meta = dashboard.get(id(record.id));
      const anime = joinAnimeRecord(record, meta);
      return [anime.id, { recommendation: record, metadata: meta || null, anime }];
    }));
  }

  function passesFilters(record, filters, direction = FORWARD) {
    const { genres = [], studio_names = [], voice_actors = [] } = record;
    const text = [record.title, ...Object.values(record.titles || {}), ...(record.aliases || []),
      ...(direction === FORWARD ? [...genres, ...studio_names, ...voice_actors.map(actor => actor.name)] : [])]
      .filter(Boolean).join(" ").toLowerCase();
    return (!filters.search || text.includes(filters.search.toLowerCase()))
      && (filters.genre === "All" || genres.includes(filters.genre))
      && (filters.yearFrom === null || Number.isFinite(record.year) && record.year >= filters.yearFrom)
      && (filters.yearTo === null || Number.isFinite(record.year) && record.year <= filters.yearTo)
      && (direction === REVERSE || ((filters.studio === "All" || studio_names.includes(filters.studio))
        && (filters.format === "All" || record.format === filters.format)
        && (!filters.minimumScore || Number.isFinite(record.average_score) && record.average_score >= filters.minimumScore)));
  }

  // The validated bundle is movie-major. Both directions use the same pair lookup.
  function createScoreAccessor(data, matrix) {
    const rows = new Map(data.movies.map((record, index) => [id(record.id), index]));
    const columns = new Map(data.anime.map((record, index) => [id(record.id), index]));
    const stride = data.anime.length;
    return (movieId, animeId) => {
      const row = rows.get(id(movieId)), column = columns.get(id(animeId));
      return row === undefined || column === undefined ? undefined : matrix[row * stride + column];
    };
  }

  function genreCohorts(records, catalogue) {
    const groups = new Map();
    const source = catalogue === "tmdb" ? "TMDB" : "AniList";
    const noun = catalogue === "tmdb" ? "movies" : "anime";
    for (const record of records) {
      for (const genre of new Set(record.genres || [])) {
        if (!groups.has(genre)) groups.set(genre, []);
        groups.get(genre).push(record.id);
      }
    }
    return [...groups.keys()].sort((a, b) => a.localeCompare(b)).map(genre => ({
      key: keyFor(catalogue, `genre:${genre}`), kind: "genre", genre, title: `${genre} ${noun}`, source, noun, memberIds: groups.get(genre)
    }));
  }

  function midrankPercentiles(column, eligible) {
    const sorted = [...eligible].sort((a, b) => column[a] - column[b]);
    const percentiles = Array(column.length).fill(null);
    for (let start = 0; start < sorted.length;) {
      let end = start + 1;
      while (end < sorted.length && column[sorted[end]] === column[sorted[start]]) end++;
      const value = sorted.length === 1 ? 0.5 : (start + end - 1) / (2 * (sorted.length - 1));
      for (let i = start; i < end; i++) percentiles[sorted[i]] = value;
      start = end;
    }
    return percentiles;
  }

  function scoreDust(records, magnets, direction, pairScore, cohortVectors, popularityValues) {
    if (!magnets.length || (!pairScore && magnets.some(magnet => magnet.kind !== "popularity"))) return [];
    const scorePair = direction === REVERSE
      ? (magnetId, dustId) => pairScore(dustId, magnetId) : pairScore;
    const rawColumns = magnets.map(magnet => {
      if (magnet.kind === "popularity") return records.map(record => finite(popularityValues.get(id(record.id))));
      if (magnet.kind !== "genre") return records.map(record => scorePair(magnet.id, record.id));
      if (!cohortVectors.has(magnet.key)) {
        const vector = records.map(record => magnet.memberIds.reduce((sum, memberId) =>
          sum + scorePair(memberId, record.id), 0) / magnet.memberIds.length);
        cohortVectors.set(magnet.key, vector);
      }
      return cohortVectors.get(magnet.key);
    });
    const popularityIndex = magnets.findIndex(magnet => magnet.kind === "popularity");
    const eligible = popularityIndex < 0 ? null : records.flatMap((_, index) =>
      Number.isFinite(rawColumns[popularityIndex][index]) ? [index] : []);
    const columns = eligible ? rawColumns.map(column => midrankPercentiles(column, eligible)) : rawColumns;
    return records.map((record, index) => {
      const scores = columns.map(column => column[index]);
      const available = scores[0] !== null;
      return { record, key: keyFor(DIRECTIONS[direction].dust, record.id), index, scores,
        rawScores: eligible ? rawColumns.map(column => column[index]) : scores,
        score: available ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
        closest: available ? scores.indexOf(Math.max(...scores)) : null, group: "dust" };
    });
  }

  function rankDust(vectors, magnetIndex = -1) {
    return vectors.map(match => ({ ...match, sortScore: magnetIndex < 0 ? match.score : match.rawScores[magnetIndex] }))
      .sort((a, b) => (b.sortScore ?? -Infinity) - (a.sortScore ?? -Infinity) || a.index - b.index)
      .map((match, index) => ({ ...match, rank: match.sortScore === null ? null : index + 1 }));
  }

  // Take an equal share of each magnet's strongest matches, then fill by average attraction.
  function sampleDust(vectors, magnetCount, limit) {
    vectors = vectors.filter(match => match.score !== null);
    if (!vectors.length) return [];
    const ranked = rankDust(vectors);
    const count = Math.min(vectors.length, limit);
    const chosen = new Set();
    const perMagnet = Math.floor(count / (magnetCount * 2));
    for (let i = 0; i < magnetCount; i++) {
      vectors.slice().sort((a, b) => b.scores[i] - a.scores[i] || a.index - b.index)
        .slice(0, perMagnet).forEach(match => chosen.add(match.index));
    }
    for (const match of ranked) {
      if (chosen.size >= count) break;
      chosen.add(match.index);
    }
    return ranked.filter(match => chosen.has(match.index));
  }

  function forwardVectors(data, matrix, movieIds) {
    if (!data || !matrix || !movieIds.length) return [];
    const movies = movieIds.map(movieId => data.movies.find(movie => id(movie.id) === id(movieId)));
    if (movies.some(movie => !movie)) return [];
    return scoreDust(data.anime, movies, FORWARD, createScoreAccessor(data, matrix));
  }

  // Compatibility for the original single-direction helpers.
  function rankCorpus(data, scores, movieIds, sortKey = "average") {
    return rankDust(forwardVectors(data, scores, movieIds), movieIds.indexOf(sortKey))
      .map(({ record, index, scores, score, sortScore, rank }) => ({ anime: record, index, scores, score, sortScore, rank }));
  }

  const dustLimit = value => [30, 60, 90].includes(Number(value)) ? Number(value) : 60;
  const blankState = direction => ({ magnetKeys: [], dustLimit: 60, candidateKeys: [], displayedKeys: [],
    rankingSortKey: "average", rankingOrder: "ascending", filters: defaults(direction), selectedKeys: [], example: false });
  const blankLayout = () => ({ magnetPositions: {}, magnetColors: {}, particles: null, scrollY: 0 });

  function readSession(direction, saved) {
    const state = blankState(direction), value = saved.state;
    const { magnet, dust } = DIRECTIONS[direction];
    const typedIds = (values, catalogue) => ids(Array.isArray(values) ? values : []).filter(key => key.startsWith(`${catalogue}:`));
    return {
      state: { ...state, magnetKeys: ids(Array.isArray(value.magnetKeys) ? value.magnetKeys : [])
        .filter(key => key.startsWith(`${magnet}:`) || key === popularityKey(direction)).slice(0, 3),
        selectedKeys: typedIds(value.selectedKeys, dust).slice(0, 3),
        dustLimit: dustLimit(value.dustLimit), rankingSortKey: typeof value.rankingSortKey === "string" ? value.rankingSortKey : "average",
        rankingOrder: value.rankingOrder === "descending" ? "descending" : "ascending",
        filters: Object.fromEntries(Object.entries(state.filters).map(([key, fallback]) =>
          [key, typeof value.filters?.[key] === (fallback === null ? "number" : typeof fallback) ? value.filters[key] : fallback])),
        example: value.example === true },
      layout: { ...blankLayout(), ...saved.layout }
    };
  }

  function importV1(saved) {
    const { state, layout } = saved;
    const typed = values => ids(Array.isArray(values) ? values : []);
    return readSession(FORWARD, {
      state: { ...state, magnetKeys: typed(state.movieIds).map(value => keyFor("tmdb", value)),
        selectedKeys: typed(state.selectedAnimeIds).map(value => keyFor("anilist", value)),
        rankingSortKey: state.rankingSortKey && state.rankingSortKey !== "average" ? keyFor("tmdb", state.rankingSortKey) : "average" },
      layout: { scrollY: layout?.scrollY || 0,
        magnetPositions: Object.fromEntries(Object.entries(layout?.magnetPositions || {}).map(([key, value]) =>
          [key.replace(/^(\d+):/, "$1:tmdb:"), value])),
        magnetColors: Object.fromEntries(Object.entries(layout?.movieColors || {}).map(([key, value]) =>
          [keyFor("tmdb", key), value])),
        particles: Array.isArray(layout?.particles?.positions) && { ...layout.particles, positions: layout.particles.positions
          .filter(node => node?.anime?.id != null).map(({ anime, ...node }) => ({ ...node, key: keyFor("anilist", anime.id) })) }
      }
    });
  }

  function createContext({ storage, onNotice = () => {} } = {}) {
    let direction = FORWARD, data, matrix, pairScore, metadata = [], metadataStatus = "loading";
    let movieDetails = {};
    let session = { state: blankState(direction), layout: blankLayout() };
    const sessions = new Map();
    // Catalogue-qualified keys separate directions. A new data or matrix object invalidates the bundle cache.
    const cohortVectors = new Map();
    const popularitySources = {
      [FORWARD]: { status: "loading", snapshotDate: null, values: new Map() },
      [REVERSE]: { status: "idle", snapshotDate: null, values: new Map() }
    };
    let cohorts = [];
    let catalogue = new Map(), lookup = new Map(), magnets = [], vectors = [], candidates = [], displayed = [], ranking = [];
    let popularity;
    let persistent = true, warned = false, revision = 0;
    const listeners = new Set();
    function storageFailure() {
      persistent = false;
      if (!warned) { warned = true; onNotice("Session storage is unavailable. Changes work here, but may not survive navigation or reload."); }
    }
    function read(key) {
      let raw;
      try { raw = storage?.getItem(key); } catch (_) { storageFailure(); }
      try { return JSON.parse(raw || "null"); } catch (_) { return null; }
    }
    function persist() {
      if (!data) return;
      try {
        if (!storage) { storageFailure(); return; }
        const serialized = JSON.stringify({ version: VERSION, direction, sessions: Object.fromEntries(sessions) });
        storage.setItem(STORAGE_KEY, serialized);
        if (storage.getItem(STORAGE_KEY) !== serialized) storageFailure();
      } catch (_) { storageFailure(); }
    }
    function snapshot() {
      const state = session.state;
      const visible = new Set(state.displayedKeys);
      return { ...state, version: VERSION, direction, revision, magnets, genreCohorts: cohorts, candidateDust: candidates, displayedDust: displayed,
        ranking, lookup, metadataStatus, persistent, popularity, mixed: magnets.some(magnet => magnet.kind === "popularity"),
        activeMagnetKeys: magnets.map(magnet => magnet.key),
        missingMetadataIds: direction === FORWARD ? state.candidateKeys.filter(key => !lookup.get(key)?.metadata) : [],
        filteredOutIds: state.candidateKeys.filter(key => !visible.has(key)) };
    }
    function publish() {
      revision++;
      persist();
      const value = snapshot();
      listeners.forEach(listener => listener(value));
      return value;
    }
    function refreshLookup() {
      if (direction === FORWARD) {
        lookup = new Map([...joinRecords(data?.anime || [], metadata)].map(([id, row]) =>
          [keyFor("anilist", id), { record: row.anime, metadata: row.metadata }]));
      } else {
        lookup = new Map(catalogueFor(data, "tmdb").map(record =>
          [keyFor("tmdb", record.id), { record: { ...movieDetails[record.id], ...record } }]));
      }
    }
    function activate() {
      const { magnet } = DIRECTIONS[direction];
      const records = catalogueFor(data, magnet);
      catalogue = new Map(records.map(record =>
        [keyFor(magnet, record.id), { ...record, id: id(record.id), key: keyFor(magnet, record.id) }]));
      cohorts = genreCohorts(records, magnet);
      for (const cohort of cohorts) catalogue.set(cohort.key, cohort);
      refreshLookup();
    }
    function validMagnets(values) {
      return ids(values).filter(key => catalogue.has(key) || key === popularityKey(direction)).slice(0, 3);
    }
    function derive({ rescore = false, resample = false, rerank = false } = {}) {
      const state = session.state;
      if (rescore) {
        state.magnetKeys = validMagnets(state.magnetKeys);
        const records = catalogueFor(data, DIRECTIONS[direction].dust);
        const source = popularitySources[direction], reverse = direction === REVERSE;
        const eligible = records.filter(record => Number.isFinite(source.values.get(id(record.id)))).length;
        popularity = { key: popularityKey(direction), kind: "popularity",
          title: `High ${reverse ? "movie" : "anime"} popularity`,
          metric: reverse ? "TMDB popularity" : "AniList list users",
          snapshotDate: source.snapshotDate, status: source.status, eligible, total: records.length };
        magnets = state.magnetKeys.map(key => key === popularity.key
          ? (eligible ? popularity : null) : catalogue.get(key)).filter(Boolean);
        vectors = scoreDust(records, magnets, direction, pairScore, cohortVectors, source.values);
      }
      if (rescore || resample) {
        candidates = sampleDust(vectors, magnets.length, state.dustLimit);
        state.candidateKeys = candidates.map(match => match.key);
      }
      displayed = candidates.filter(match => passesFilters(lookup.get(match.key).record, state.filters, direction));
      state.displayedKeys = displayed.map(match => match.key);
      const visible = new Set(state.displayedKeys);
      const waitingForPopularity = state.magnetKeys.includes(popularity?.key) && ["idle", "loading"].includes(popularity.status);
      if ((pairScore || vectors.length) && !waitingForPopularity && (direction === REVERSE || metadataStatus !== "loading")) {
        const retained = state.selectedKeys.filter(key => visible.has(key));
        if (retained.length < state.selectedKeys.length) onNotice("Selection updated. Titles no longer displayed were removed.");
        state.selectedKeys = retained;
      }
      if (!state.magnetKeys.includes(state.rankingSortKey)) state.rankingSortKey = "average";
      if (rescore || rerank) ranking = rankDust(vectors, magnets.findIndex(magnet => magnet.key === state.rankingSortKey));
      ranking = ranking.map(match => ({ ...match, displayed: visible.has(match.key) }));
      return publish();
    }
    function seed() {
      const example = [...catalogue.values()].find(record => record.title === DIRECTIONS[direction].example) || catalogue.values().next().value;
      if (example) { session.state.magnetKeys = [example.key]; session.state.example = true; }
    }
    const api = {
      snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      restore() {
        const saved = read(STORAGE_KEY);
        if (saved?.version === VERSION && Object.hasOwn(DIRECTIONS, saved.direction)
          && Array.isArray(saved.sessions?.[saved.direction]?.state?.magnetKeys)) {
          for (const name of Object.keys(DIRECTIONS)) {
            const entry = saved.sessions[name];
            if (Array.isArray(entry?.state?.magnetKeys)) sessions.set(name, readSession(name, entry));
          }
          direction = saved.direction;
        } else {
          const legacy = read(LEGACY_KEY);
          if (legacy?.version !== 1 || legacy.state?.version !== 1 || !Array.isArray(legacy.state.movieIds)) return false;
          sessions.set(FORWARD, importV1(legacy));
        }
        session = sessions.get(direction);
        return true;
      },
      // Only the resolvable title is imported from the older Top-20 experience.
      migrateLegacy(recommendations) {
        if (sessions.has(FORWARD)) return false;
        const seed = read("aniviz_seed_movie");
        const movie = recommendations?.movies.find(row => id(row.id) === id(seed?.tmdbId));
        if (!movie) return false;
        session.state.magnetKeys = [keyFor("tmdb", movie.id)];
        sessions.set(FORWARD, session);
        return true;
      },
      setSources(recommendations, scores, { seedExample = false } = {}) {
        const changed = data !== recommendations || matrix !== scores;
        data = recommendations; matrix = scores;
        if (changed) {
          cohortVectors.clear();
          pairScore = data && matrix ? createScoreAccessor(data, matrix) : null;
        }
        activate();
        if (seedExample && !sessions.has(direction) && !api.migrateLegacy(data)) seed();
        sessions.set(direction, session);
        return derive({ rescore: changed || seedExample });
      },
      setDirection(next) {
        if (!data || next === direction || !Object.hasOwn(DIRECTIONS, next)) return snapshot();
        direction = next;
        const previous = sessions.get(direction);
        session = previous || { state: blankState(direction), layout: blankLayout() };
        activate();
        if (!previous) seed();
        sessions.set(direction, session);
        return derive({ rescore: true });
      },
      setMetadata(rows, status = "ready", snapshotDate = null) {
        metadata = rows || []; metadataStatus = status;
        popularitySources[FORWARD] = { status, snapshotDate: typeof snapshotDate === "string" ? snapshotDate : null,
          values: new Map(metadata.map(row => [id(row.id), row.popularity])) };
        if (!data || direction === REVERSE) return snapshot();
        refreshLookup();
        return derive({ rescore: true });
      },
      setMovieDetails(details) {
        movieDetails = details;
        if (direction !== REVERSE) return snapshot();
        refreshLookup();
        return publish();
      },
      getMagnetRecord(key) {
        const magnet = magnets.find(magnet => magnet.key === key && magnet.kind === undefined);
        if (!magnet) return null;
        return direction === FORWARD ? { ...movieDetails[magnet.id], ...magnet }
          : joinAnimeRecord(magnet, metadata.find(row => id(row.id) === magnet.id));
      },
      setMoviePopularity(payload, status) {
        popularitySources[REVERSE] = { status, snapshotDate: payload?.snapshot_date,
          values: new Map(Object.entries(payload?.popularity || {})) };
        return direction === REVERSE ? derive({ rescore: true }) : snapshot();
      },
      setMagnets(values) {
        const keys = validMagnets(values);
        if (keys.length === session.state.magnetKeys.length && keys.every((key, index) => key === session.state.magnetKeys[index])) return snapshot();
        session.state.magnetKeys = keys;
        session.state.example = false;
        return derive({ rescore: true });
      },
      setDustLimit(value) {
        session.state.dustLimit = dustLimit(value);
        return derive({ resample: true });
      },
      setFilters(patch) {
        for (const key of Object.keys(defaults(direction))) {
          if (Object.hasOwn(patch, key)) session.state.filters = { ...session.state.filters, [key]: patch[key] };
        }
        return derive();
      },
      resetFilters() { session.state.filters = defaults(direction); return derive(); },
      setRankingSort(key) { session.state.rankingSortKey = id(key); return derive({ rerank: true }); },
      setRankingOrder(order) {
        session.state.rankingOrder = order === "descending" ? "descending" : "ascending";
        return publish();
      },
      setSelection(values) {
        session.state.selectedKeys = ids(values).filter(key => session.state.displayedKeys.includes(key)).slice(0, 3);
        return publish();
      },
      toggleSelection(value) {
        const key = id(value), { displayedKeys, selectedKeys } = session.state;
        if (!displayedKeys.includes(key)) return snapshot();
        if (selectedKeys.includes(key)) return api.setSelection(selectedKeys.filter(item => item !== key));
        if (selectedKeys.length >= 3) {
          onNotice(`Compare up to 3 ${direction === REVERSE ? "movies" : "anime"}. Remove a selected title before adding another.`);
          return snapshot();
        }
        return api.setSelection([...selectedKeys, key]);
      },
      getLayout() { return session.layout; },
      saveLayout(patch) { session.layout = { ...session.layout, ...patch }; persist(); },
      resetPositions() { api.saveLayout({ magnetPositions: {}, particles: null }); }
    };
    return api;
  }
  return { VERSION, STORAGE_KEY, FORWARD, REVERSE, DIRECTIONS, keyFor, catalogueFor, magnetScoreLabel, cohortDescription,
    averageLabel, formatPercentile, formatRawScore, mixedEvidence, defaults, joinRecords,
    passesFilters, createScoreAccessor, forwardVectors, rankCorpus, sampleDust, createContext };
});
