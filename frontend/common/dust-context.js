"use strict";

// Analytical state only. Particle/magnet positions and scroll live in the session envelope.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./chart-data.js"));
  else root.AnivizDust = factory(root.AnivizChartData);
})(globalThis, function (ChartData) {
  const VERSION = 2;
  const STORAGE_KEY = "aniviz-dust-session-v2";
  const LEGACY_KEY = "aniviz-dust-session-v1";
  const FORWARD = "movie-to-anime", REVERSE = "anime-to-movies", STUDIOS = "movie-to-studios";
  const ACTORS = "movie-to-actors", MOVIE_ACTORS = "anime-to-actors", MOVIE_WRITERS = "anime-to-writers";
  const ORIGINAL_CREATORS = "movie-to-original-creators";
  const DIRECTIONS = {
    [FORWARD]: { magnet: "tmdb", dust: "anilist", example: "Inception" },
    [REVERSE]: { magnet: "anilist", dust: "tmdb", example: "Attack on Titan" },
    [STUDIOS]: { magnet: "tmdb", dust: "anilist", example: "Inception",
      group: { prefix: "anilist:studio", label: "Studio", noun: "studios" } },
    [ACTORS]: { magnet: "tmdb", dust: "anilist", example: "Inception",
      group: { prefix: "anilist:staff", label: "Voice actor", noun: "voice actors" } },
    [ORIGINAL_CREATORS]: { magnet: "tmdb", dust: "anilist", example: "Inception",
      group: { prefix: "anilist:staff", label: "Original creator", noun: "original creators" } },
    [MOVIE_ACTORS]: { magnet: "anilist", dust: "tmdb", example: "Attack on Titan",
      group: { prefix: "tmdb:person", label: "Movie actor", noun: "movie actors" } },
    [MOVIE_WRITERS]: { magnet: "anilist", dust: "tmdb", example: "Attack on Titan",
      group: { prefix: "tmdb:person", label: "Movie writer", noun: "movie writers" } }
  };
  const groupFor = direction => DIRECTIONS[direction].group;
  const isMovieDust = direction => DIRECTIONS[direction].dust === "tmdb";
  const popularityLabel = direction => isMovieDust(direction) ? "TMDB popularity" : "AniList users";
  const titleNoun = (direction, count) => isMovieDust(direction) ? (count === 1 ? "movie" : "movies") : "anime";
  const normalizeStrength = value => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(2, value)) * 10) / 10 : 1;
  const keyFor = (catalogue, id) => `${catalogue}:${id}`;
  const catalogueFor = (data, catalogue) => (catalogue === "tmdb" ? data?.movies : data?.anime) || [];
  const METRIC_MAGNET_TYPES = ["popularity", "score"];
  const GROUP_METRICS = {
    popularity: { value: "totalPopularity", count: "popularityCount" },
    score: { value: "averageScore", count: "scoreCount" }
  };
  const genreCountPrefix = direction => isMovieDust(direction) ? "tmdb:movie-genre:" : "anilist:anime-genre:";
  const titleCountKey = direction => keyFor(DIRECTIONS[direction].dust, "title-count");
  const isCountKey = (direction, key) => {
    if (!groupFor(direction)) return false;
    const prefix = genreCountPrefix(direction);
    return key === titleCountKey(direction) || key.startsWith(prefix) && key.length > prefix.length;
  };
  const isCountMagnet = magnet => magnet.kind === "genre-count" || magnet.kind === "title-count";
  const isMetricMagnet = magnet => isCountMagnet(magnet) || METRIC_MAGNET_TYPES.includes(magnet.kind);
  const magnetScoreLabel = magnet => isMetricMagnet(magnet) ? magnet.metric
    : magnet.kind === "genre" ? magnet.title : `Cosine to ${magnet.title}`;
  const cohortDescription = magnet => `${magnet.source} · ${magnet.memberIds.length} ${magnet.noun}`;
  const metricMagnetKey = (direction, kind) => keyFor(DIRECTIONS[direction].dust, kind);
  const isMetricKey = (direction, key) => METRIC_MAGNET_TYPES.some(kind => key === metricMagnetKey(direction, kind));
  const averageLabel = mixed => mixed ? "Average attraction percentile" : "Average similarity";
  const formatPercentile = value => Number.isFinite(value) ? value.toFixed(3) : "Unavailable";
  const metricNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
  function formatRawScore(value, magnet) {
    if (!Number.isFinite(value)) return "Unavailable";
    if (!isMetricMagnet(magnet)) return formatPercentile(value);
    const formatted = metricNumber.format(value);
    return magnet.kind === "score" ? `${formatted} / ${magnet.scale}` : formatted;
  }
  function mixedEvidence(match, magnet, index) {
    const raw = formatRawScore(match.rawScores[index], magnet);
    return `${magnetScoreLabel(magnet)}: ${raw} · Attraction percentile: ${formatPercentile(match.scores[index])}`;
  }
  const defaults = direction => ({ search: "", genre: "All", yearFrom: null, yearTo: null,
    ...(direction === FORWARD ? { studio: "All" } : {}),
    ...(isMovieDust(direction) ? {} : { format: "All", minimumScore: 0 }) });
  const id = (value) => String(value);
  const ids = (values) => [...new Set((values || []).filter(v => typeof v === "string" || typeof v === "number").map(id))];
  const finite = (v) => Number.isFinite(v) ? v : null;
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

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
      && (isMovieDust(direction) || ((filters.studio === "All" || studio_names.includes(filters.studio))
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

  function genreCountMagnet(direction, genre, memberIds = [], total = 0) {
    const title = `${genre} ${titleNoun(direction)}`;
    return { key: genreCountPrefix(direction) + genre, kind: "genre-count", title,
      metric: `${genre} ${titleNoun(direction, 1)} count`,
      memberIds: new Set(memberIds), eligible: total, total };
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

  function scoreDust(records, magnets, direction, pairScore, cohortVectors, metricValues, groups) {
    if (!magnets.length || (!pairScore && magnets.some(magnet => !isMetricMagnet(magnet)))) return [];
    const scorePair = isMovieDust(direction)
      ? (magnetId, dustId) => pairScore(dustId, magnetId) : pairScore;
    const rawColumns = magnets.map(magnet => {
      if (isMetricMagnet(magnet)) return groupFor(direction) ? null
        : records.map(record => finite(metricValues[magnet.kind]?.get(id(record.id))));
      if (magnet.kind !== "genre") return records.map(record => scorePair(magnet.id, record.id));
      if (!cohortVectors.has(magnet.key)) {
        const vector = records.map(record => magnet.memberIds.reduce((sum, memberId) =>
          sum + scorePair(memberId, record.id), 0) / magnet.memberIds.length);
        cohortVectors.set(magnet.key, vector);
      }
      return cohortVectors.get(magnet.key);
    });
    const mixed = magnets.some(isMetricMagnet);
    return groupFor(direction) ? scoreGroups(records, magnets, rawColumns, metricValues, groups, direction, mixed)
      : dustVectors(records, rawColumns, direction, mixed);
  }

  function scoreGroups(records, magnets, storyScores, metricValues, groups, direction, mixed) {
    const titleIndexes = new Map(records.map((record, index) => [id(record.id), index]));
    const metricsOnly = storyScores.every(column => column === null);
    const contributes = (magnet, workId) => magnet.kind === "title-count"
      || (magnet.kind === "genre-count" ? magnet.memberIds.has(workId)
        : Number.isFinite(metricValues[magnet.kind]?.get(workId)));
    const summaries = groups.map(group => {
      const works = group.memberIds.map(memberId => {
        const index = titleIndexes.get(memberId);
        return { id: memberId, scores: storyScores.map(column => column?.[index]) };
      });
      const aggregates = magnets.map((magnet, index) => {
        if (isCountMagnet(magnet)) {
          const count = magnet.kind === "title-count" ? group.count
            : group.memberIds.filter(memberId => magnet.memberIds.has(memberId)).length;
          return { value: count, count };
        }
        const metric = GROUP_METRICS[magnet.kind];
        if (metric) return { value: group[metric.value], count: group[metric.count] };
        const scores = works.map(work => work.scores[index]).filter(Number.isFinite);
        return { value: scores.length ? mean(scores) : null, count: scores.length };
      });
      const supportingWorks = works.flatMap(work => {
        const scores = work.scores.filter(Number.isFinite);
        if (scores.length) return [{ id: work.id, similarity: mean(scores) }];
        return metricsOnly && magnets.some(magnet => contributes(magnet, work.id))
          ? [{ id: work.id, similarity: null }] : [];
      }).sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      return { aggregates, supportingWorks };
    });
    const columns = magnets.map((_, index) => summaries.map(summary => summary.aggregates[index].value));
    return dustVectors(groups, columns, direction, mixed).map((match, index) => ({
      ...match,
      contributingCounts: summaries[index].aggregates.map(aggregate => aggregate.count),
      supportingWorks: summaries[index].supportingWorks
    }));
  }

  function dustVectors(records, rawColumns, direction, mixed) {
    const eligible = records.flatMap((_, index) =>
      rawColumns.every(column => Number.isFinite(column[index])) ? [index] : []);
    const eligibleSet = new Set(eligible);
    // Keep geometry ranks with the scored vectors so sampling and filtering cannot change them.
    const percentiles = rawColumns.map(column => midrankPercentiles(column, eligible));
    const columns = mixed ? percentiles : rawColumns;
    return records.map((record, index) => {
      const scores = columns.map(column => column[index]);
      const available = eligibleSet.has(index);
      const closest = available ? scores.indexOf(Math.max(...scores)) : null;
      return { record, key: groupFor(direction) ? record.key : keyFor(DIRECTIONS[direction].dust, record.id), index, scores,
        rawScores: mixed ? rawColumns.map(column => column[index]) : scores,
        score: available ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
        closest, winnerPercentile: available ? percentiles[closest][index] : null,
        magnetPercentiles: percentiles.map(column => column[index]), group: "dust" };
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
  const blankState = direction => ({ magnetKeys: [], magnetStrengths: {}, dustLimit: 60, candidateKeys: [], displayedKeys: [],
    rankingSortKey: "average", rankingOrder: "ascending", filters: defaults(direction), selectedKeys: [], example: false,
    ...(groupFor(direction) ? { supportingIds: [] } : {}) });
  const blankLayout = () => ({ magnetPositions: {}, magnetColors: {}, particles: null, scrollY: 0 });

  function readSession(direction, saved) {
    const state = blankState(direction), value = saved.state;
    const { magnet, dust } = DIRECTIONS[direction];
    const typedIds = (values, catalogue) => ids(Array.isArray(values) ? values : []).filter(key => key.startsWith(`${catalogue}:`));
    const magnetKeys = ids(Array.isArray(value.magnetKeys) ? value.magnetKeys : [])
      .filter(key => key.startsWith(`${magnet}:`) || isMetricKey(direction, key)
        || isCountKey(direction, key)).slice(0, 3);
    return {
      state: { ...state, magnetKeys,
        magnetStrengths: Object.fromEntries(magnetKeys.map(key => [key, normalizeStrength(value.magnetStrengths?.[key])])
          .filter(([, strength]) => strength !== 1)),
        selectedKeys: typedIds(value.selectedKeys, groupFor(direction)?.prefix || dust).slice(0, 3),
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
    let animeCredits = {}, animeCreditsStatus = "idle";
    let movieDetails = {}, movieDetailsStatus = "idle", movieReception = {};
    let session = { state: blankState(direction), layout: blankLayout() };
    const sessions = new Map();
    // Catalogue-qualified keys separate directions. A new data or matrix object invalidates the bundle cache.
    const cohortVectors = new Map();
    const metricSources = {
      [FORWARD]: { status: "loading", snapshotDate: null, values: {} },
      [REVERSE]: { status: "idle", snapshotDate: null, values: {} }
    };
    let cohorts = [], genreCountMagnets = new Map(), titleCount;
    let catalogue = new Map(), lookup = new Map(), titleLookup = new Map(), groups = [];
    let magnets = [], magnetSlots = [], vectors = [], candidates = [], displayed = [], ranking = [];
    let metricMagnets = {};
    let persistent = true, warned = false, revision = 0, colorByMagnet = false;
    const listeners = new Set();
    const creditStatus = () => direction === ORIGINAL_CREATORS ? animeCreditsStatus
      : isMovieDust(direction) ? movieDetailsStatus : metadataStatus;
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
        const serialized = JSON.stringify({ version: VERSION, direction, colorByMagnet, sessions: Object.fromEntries(sessions) });
        storage.setItem(STORAGE_KEY, serialized);
        if (storage.getItem(STORAGE_KEY) !== serialized) storageFailure();
      } catch (_) { storageFailure(); }
    }
    function snapshot() {
      const state = session.state;
      const visible = new Set(state.displayedKeys);
      return { ...state, version: VERSION, direction, revision, colorByMagnet, magnets, magnetSlots, genreCohorts: cohorts,
        genreCountMagnets: [...genreCountMagnets.values()], titleCount, candidateDust: candidates, displayedDust: displayed,
        ranking, lookup, titleLookup, metadataStatus, movieDetailsStatus, creditStatus: creditStatus(),
        animeCredits, animeCreditsStatus,
        persistent, ...metricMagnets, mixed: magnets.some(isMetricMagnet),
        activeMagnetKeys: magnets.map(magnet => magnet.key),
        missingMetadataIds: direction === FORWARD ? state.candidateKeys.filter(key => !lookup.get(key)?.metadata) : [],
        filteredOutIds: state.candidateKeys.filter(key => !visible.has(key)) };
    }
    function publish() {
      if (groupFor(direction)) {
        const { selectedKeys, displayedKeys } = session.state;
        session.state.supportingIds = [...new Set((selectedKeys.length ? selectedKeys : displayedKeys)
          .flatMap(key => lookup.get(key)?.record.memberIds || []))];
      }
      revision++;
      persist();
      const value = snapshot();
      listeners.forEach(listener => listener(value));
      return value;
    }
    function refreshLookup() {
      const group = groupFor(direction);
      let summaries = [];
      if (isMovieDust(direction)) {
        titleLookup = new Map(catalogueFor(data, "tmdb").map(record => {
          const reception = movieReception[record.id];
          return [keyFor("tmdb", record.id), {
            record: { ...record, ...movieDetails[record.id], ...reception, average_score: reception?.vote_average ?? null }
          }];
        }));
        if (group) {
          const movies = [...titleLookup.values()].map(row => row.record);
          summaries = direction === MOVIE_WRITERS ? ChartData.movieWriters(movies) : ChartData.movieActors(movies);
        }
      } else {
        titleLookup = new Map([...joinRecords(data?.anime || [], metadata)].map(([id, row]) =>
          [keyFor("anilist", id), { record: row.anime, metadata: row.metadata }]));
        if (group) {
          for (const row of metadata) {
            const key = keyFor("anilist", row.id);
            if (!titleLookup.has(key)) titleLookup.set(key, { record: joinAnimeRecord(row, row), metadata: row });
          }
          if (direction === ORIGINAL_CREATORS) {
            const anime = [...titleLookup.values()].map(row => row.record);
            const creditedAnime = ChartData.withOriginalCreators(anime, animeCredits);
            summaries = ChartData.originalCreators(creditedAnime);
          } else {
            summaries = direction === ACTORS ? ChartData.voiceActors(metadata)
              : ChartData.studios(metadata).filter(studio => studio.studioId !== null)
                .map(({ studio, studioId, ...summary }) => ({ ...summary, id: studioId, title: studio }));
          }
        }
      }
      // Prefer groups with more catalogue titles when scores tie.
      groups = summaries.sort((a, b) => b.count - a.count).map(({ ids, ...summary }) => ({ ...summary, memberIds: ids }));
      lookup = group ? new Map(groups.map(record => [record.key, { record }])) : titleLookup;
      genreCountMagnets = new Map();
      titleCount = undefined;
      if (group) {
        const provider = DIRECTIONS[direction].dust;
        const total = groups.length;
        titleCount = { key: titleCountKey(direction), kind: "title-count", title: "Title count", metric: "Title count",
          eligible: total, total };
        const creditedIds = new Set(groups.flatMap(record => record.memberIds));
        const creditedTitles = [...creditedIds].map(memberId => titleLookup.get(keyFor(provider, memberId)).record);
        for (const { genre, memberIds } of genreCohorts(creditedTitles, provider)) {
          const magnet = genreCountMagnet(direction, genre, memberIds.map(id), total);
          genreCountMagnets.set(magnet.key, magnet);
        }
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
      return ids(values).filter(key => catalogue.has(key) || isMetricKey(direction, key)
        || isCountKey(direction, key)).slice(0, 3);
    }
    function derive({ rescore = false, resample = false, rerank = false } = {}) {
      const state = session.state;
      const group = groupFor(direction);
      const movie = isMovieDust(direction);
      const provider = DIRECTIONS[direction].dust;
      const metricSource = metricSources[movie ? REVERSE : FORWARD];
      if (rescore) {
        state.magnetKeys = validMagnets(state.magnetKeys);
        const records = catalogueFor(data, provider);
        const source = metricSource;
        const status = direction === ORIGINAL_CREATORS && source.status === "ready" ? creditStatus() : source.status;
        const definitions = {
          popularity: { title: "Popularity", metric: popularityLabel(direction) },
          score: { title: "Score", metric: group ? "Average score" : movie ? "TMDB score" : "AniList score", scale: movie ? 10 : 100 }
        };
        metricMagnets = Object.fromEntries(METRIC_MAGNET_TYPES.map(kind => [kind, {
          ...definitions[kind], key: metricMagnetKey(direction, kind), kind,
          snapshotDate: source.snapshotDate, status, total: group ? groups.length : records.length,
          eligible: group
            ? groups.filter(row => Number.isFinite(row[GROUP_METRICS[kind].value])).length
            : records.filter(record => Number.isFinite(source.values[kind]?.get(id(record.id)))).length
        }]));
        const metrics = new Map(Object.values(metricMagnets).map(magnet => [magnet.key, magnet]));
        magnetSlots = state.magnetKeys.map(key => catalogue.get(key) || metrics.get(key)
          || (key === titleCount?.key ? titleCount : genreCountMagnets.get(key)
            || genreCountMagnet(direction, key.slice(genreCountPrefix(direction).length))));
        magnets = magnetSlots.filter(magnet => !isMetricMagnet(magnet) || magnet.eligible);
        vectors = scoreDust(records, magnets, direction, pairScore, cohortVectors, source.values, groups);
      }
      if (rescore || resample) {
        const { search, ...memberFilters } = state.filters;
        const titleFilters = { ...memberFilters, search: "", studio: "All" };
        const normalizedSearch = search.toLowerCase();
        const pool = group ? vectors.filter(match => match.record.title.toLowerCase().includes(normalizedSearch)
          && match.record.memberIds.some(member => passesFilters(titleLookup.get(keyFor(provider, member)).record, titleFilters, direction)))
          : vectors;
        candidates = sampleDust(pool, magnets.length, state.dustLimit);
        state.candidateKeys = candidates.map(match => match.key);
      }
      displayed = group ? candidates
        : candidates.filter(match => passesFilters(lookup.get(match.key).record, state.filters, direction));
      state.displayedKeys = displayed.map(match => match.key);
      const visible = new Set(state.displayedKeys);
      const waitingForMetrics = state.magnetKeys.some(key => isMetricKey(direction, key))
        && ["idle", "loading"].includes(metricSource.status);
      const selectionReady = (!group || creditStatus() === "ready") && (movie || metadataStatus !== "loading");
      if ((pairScore || vectors.length) && !waitingForMetrics && selectionReady) {
        const retained = state.selectedKeys.filter(key => visible.has(key));
        if (retained.length < state.selectedKeys.length) onNotice(`Selection updated. ${group?.label ? group.label + "s" : "Titles"} no longer displayed were removed.`);
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
          colorByMagnet = saved.colorByMagnet === true;
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
        const previous = sessions.get(next);
        const sameCatalogue = isMovieDust(next) === isMovieDust(direction);
        const base = isMovieDust(next) ? REVERSE : FORWARD;
        const carry = sameCatalogue ? session.state : !previous ? sessions.get(base)?.state : null;
        direction = next;
        session = previous || { state: blankState(direction), layout: blankLayout() };
        activate();
        if (carry) {
          session.state.magnetKeys = [...carry.magnetKeys];
          session.state.example = carry.example;
          session.state.magnetStrengths = Object.fromEntries(Object.entries(session.state.magnetStrengths)
            .filter(([key]) => carry.magnetKeys.includes(key)));
        } else if (!previous) seed();
        sessions.set(direction, session);
        return derive({ rescore: true });
      },
      setMetadata(rows, status = "ready", snapshotDate = null) {
        metadata = rows || []; metadataStatus = status;
        metricSources[FORWARD] = { status, snapshotDate: typeof snapshotDate === "string" ? snapshotDate : null,
          values: { popularity: new Map(metadata.map(row => [id(row.id), row.popularity])),
            score: new Map(metadata.map(row => [id(row.id), row.average_score])) } };
        if (!data || isMovieDust(direction)) return snapshot();
        refreshLookup();
        return derive({ rescore: true });
      },
      setAnimeCredits(credits, status = "ready") {
        animeCredits = credits || {};
        animeCreditsStatus = status;
        if (direction !== ORIGINAL_CREATORS || !data) return publish();
        refreshLookup();
        return derive({ rescore: true });
      },
      getMagnetRecord(key) {
        const magnet = magnets.find(magnet => magnet.key === key && magnet.kind === undefined);
        if (!magnet) return null;
        return !isMovieDust(direction) ? { ...magnet, ...movieDetails[magnet.id] }
          : joinAnimeRecord(magnet, metadata.find(row => id(row.id) === magnet.id));
      },
      setMovieDetails(details, status = "ready") {
        movieDetails = details || {};
        movieDetailsStatus = status;
        if (!isMovieDust(direction)) return snapshot();
        refreshLookup();
        if (groupFor(direction)) return derive({ rescore: true });
        return publish();
      },
      setMoviePopularity(payload, status) {
        movieReception = payload?.movies || {};
        metricSources[REVERSE] = { status, snapshotDate: payload?.snapshot_date,
          values: { popularity: new Map(Object.entries(payload?.popularity || {})),
            score: new Map(Object.entries(payload?.vote_average || {})) } };
        if (!isMovieDust(direction)) return snapshot();
        refreshLookup();
        return derive({ rescore: true });
      },
      setMagnets(values) {
        const keys = validMagnets(values);
        if (keys.length === session.state.magnetKeys.length && keys.every((key, index) => key === session.state.magnetKeys[index])) return snapshot();
        session.state.magnetKeys = keys;
        session.state.magnetStrengths = Object.fromEntries(Object.entries(session.state.magnetStrengths)
          .filter(([key]) => keys.includes(key)));
        session.state.example = false;
        return derive({ rescore: true });
      },
      setDustLimit(value) {
        session.state.dustLimit = dustLimit(value);
        return derive({ resample: true });
      },
      setColorByMagnet(value) {
        if (colorByMagnet === (value === true)) return snapshot();
        colorByMagnet = value === true;
        return publish();
      },
      setMagnetStrength(key, value) {
        const strengths = session.state.magnetStrengths;
        const strength = normalizeStrength(value);
        if (!magnets.some(magnet => magnet.key === key) || strength === (strengths[key] ?? 1)) return snapshot();
        session.state.magnetStrengths = { ...strengths, [key]: strength };
        if (strength === 1) delete session.state.magnetStrengths[key];
        return publish();
      },
      resetMagnetStrengths() {
        if (!Object.keys(session.state.magnetStrengths).length) return snapshot();
        session.state.magnetStrengths = {};
        return publish();
      },
      setFilters(patch) {
        for (const key of Object.keys(defaults(direction))) {
          if (Object.hasOwn(patch, key)) session.state.filters = { ...session.state.filters, [key]: patch[key] };
        }
        return derive({ resample: Boolean(groupFor(direction)) });
      },
      resetFilters() { session.state.filters = defaults(direction); return derive({ resample: Boolean(groupFor(direction)) }); },
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
          const group = groupFor(direction);
          const noun = group?.noun || titleNoun(direction);
          onNotice(`Compare up to 3 ${noun}. Remove a selected ${group?.label.toLowerCase() || "title"} before adding another.`);
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
  return { VERSION, STORAGE_KEY, FORWARD, REVERSE, STUDIOS, ACTORS, ORIGINAL_CREATORS, MOVIE_ACTORS, MOVIE_WRITERS, DIRECTIONS,
    groupFor, isMovieDust, popularityLabel, titleNoun, METRIC_MAGNET_TYPES, isMetricMagnet,
    keyFor, catalogueFor, magnetScoreLabel, cohortDescription,
    averageLabel, formatPercentile, formatRawScore, mixedEvidence, defaults, joinRecords,
    passesFilters, createScoreAccessor, forwardVectors, rankCorpus, sampleDust, createContext };
});
