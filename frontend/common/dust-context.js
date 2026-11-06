"use strict";

// Analytical state only. Particle/magnet positions and scroll live in the session envelope.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnivizDust = api;
})(globalThis, function () {
  const VERSION = 1;
  const STORAGE_KEY = "aniviz-dust-session-v1";
  const defaults = () => ({ search: "", genre: "All", studio: "All", format: "All", yearFrom: null, yearTo: null, minimumScore: 0 });
  const id = (value) => String(value);
  const ids = (values) => [...new Set((values || []).filter(v => typeof v === "string" || typeof v === "number").map(id))];
  const finite = (v) => Number.isFinite(v) ? v : null;

  function joinRecords(recommendations, metadata = []) {
    const dashboard = new Map(metadata.map(row => [id(row.id), row]));
    return new Map(recommendations.map(record => {
      const meta = dashboard.get(id(record.id));
      // Recommendation text can support filtering, but cannot invent ratings, cast or studios.
      const anime = { ...record, ...meta, id: id(record.id),
        genres: meta?.genres || record.genres || [], studio_names: meta?.studio_names || [],
        voice_actors: meta?.voice_actors || [], primary_genre: meta?.primary_genre || record.genres?.[0] || "Unknown",
        average_score: finite(meta?.average_score), popularity: finite(meta?.popularity),
        favourites: finite(meta?.favourites), episodes: finite(meta?.episodes), duration: finite(meta?.duration),
        year: finite(meta?.year ?? record.year), metadataAvailable: Boolean(meta) };
      return [anime.id, { recommendation: record, metadata: meta || null, anime }];
    }));
  }

  function passesFilters(anime, filters) {
    const text = [anime.title, ...Object.values(anime.titles || {}), ...(anime.aliases || []),
      ...anime.genres, ...anime.studio_names, ...anime.voice_actors.map(actor => actor.name)].filter(Boolean).join(" ").toLowerCase();
    return (!filters.search || text.includes(filters.search.toLowerCase()))
      && (filters.genre === "All" || anime.genres.includes(filters.genre))
      && (filters.studio === "All" || anime.studio_names.includes(filters.studio))
      && (filters.format === "All" || anime.format === filters.format)
      && (filters.yearFrom === null || Number.isFinite(anime.year) && anime.year >= filters.yearFrom)
      && (filters.yearTo === null || Number.isFinite(anime.year) && anime.year <= filters.yearTo)
      && (!filters.minimumScore || Number.isFinite(anime.average_score) && anime.average_score >= filters.minimumScore);
  }

  function rankCorpus(data, scores, movieIds, sortKey = "average") {
    if (!data || !scores || !movieIds.length) return [];
    const indices = movieIds.map(movieId => data.movies.findIndex(movie => id(movie.id) === id(movieId)));
    if (indices.some(index => index < 0)) return [];
    const selected = movieIds.indexOf(sortKey);
    return data.anime.map((anime, index) => {
      const values = indices.map(movieIndex => scores[movieIndex * data.anime.length + index]);
      const score = values.reduce((sum, value) => sum + value, 0) / values.length;
      return { anime, index, scores: values, score, sortScore: selected < 0 ? score : values[selected] };
    }).sort((a, b) => b.sortScore - a.sortScore || a.index - b.index)
      .map((match, index) => ({ ...match, rank: index + 1 }));
  }

  function createContext({ getDustMatches, storage, onNotice = () => {} } = {}) {
    let data = null, scores = null, metadata = [], lookup = new Map();
    let state = { version: VERSION, revision: 0, movieIds: [], dustLimit: 60,
      candidateDustIds: [], displayedDustIds: [], perMovieScores: {}, rankingSortKey: "average",
      filters: defaults(), selectedAnimeIds: [] };
    let candidates = [], ranking = [], displayed = [], signature = null;
    let layout = { magnetPositions: {}, particles: null, scrollY: 0 };
    let metadataStatus = "loading", persistent = true, warned = false, sessionRestored = false;
    const listeners = new Set();
    function storageFailure() {
      persistent = false;
      if (!warned) { warned = true; onNotice("Session storage is unavailable. Changes work here, but may not survive navigation or reload."); }
    }
    function persist() {
      try {
        if (!storage) { storageFailure(); return; }
        const serialized = JSON.stringify({ version: VERSION, state, layout });
        storage.setItem(STORAGE_KEY, serialized);
        if (storage.getItem(STORAGE_KEY) !== serialized) storageFailure();
      }
      catch (_) { storageFailure(); }
    }
    function snapshot() {
      return { ...state, candidateDust: candidates, displayedDust: displayed, ranking,
        lookup, metadataStatus, persistent,
        missingMetadataIds: state.candidateDustIds.filter(key => !lookup.get(key)?.metadata),
        filteredOutIds: state.candidateDustIds.filter(key => !state.displayedDustIds.includes(key)) };
    }
    function publish() {
      state = { ...state, revision: state.revision + 1 };
      persist();
      const value = snapshot();
      listeners.forEach(listener => listener(value));
      return value;
    }
    function derive({ resample = false, rerank = false } = {}) {
      if (resample) {
        const next = data && scores ? JSON.stringify([state.movieIds, state.dustLimit]) : null;
        if (signature !== next || !data || !scores) {
          signature = next;
          candidates = next ? getDustMatches(data, scores, state.movieIds, state.dustLimit) : [];
        }
      }
      state.candidateDustIds = candidates.map(match => id(match.anime.id));
      state.perMovieScores = Object.fromEntries(candidates.map(match => [id(match.anime.id),
        Object.fromEntries(state.movieIds.map((movieId, i) => [movieId, match.scores[i]]))]));
      displayed = candidates.filter(match => passesFilters(lookup.get(id(match.anime.id)).anime, state.filters));
      state.displayedDustIds = displayed.map(match => id(match.anime.id));
      const retained = state.selectedAnimeIds.filter(key => state.displayedDustIds.includes(key));
      if (data && scores && metadataStatus !== "loading" && retained.length < state.selectedAnimeIds.length) onNotice("Selection updated: titles no longer displayed were removed.");
      if (data && scores && metadataStatus !== "loading") state.selectedAnimeIds = retained;
      if (!state.movieIds.includes(state.rankingSortKey)) state.rankingSortKey = "average";
      if (rerank) ranking = rankCorpus(data, scores, state.movieIds, state.rankingSortKey);
      const visible = new Set(state.displayedDustIds);
      ranking = ranking.map(match => ({ ...match, displayed: visible.has(id(match.anime.id)) }));
      return publish();
    }
    const api = {
      snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      restore() {
        let raw;
        try { raw = storage?.getItem(STORAGE_KEY); }
        catch (_) { storageFailure(); return false; }
        try {
          const saved = JSON.parse(raw || "null");
          if (saved?.version === VERSION && saved.state?.version === VERSION) {
            sessionRestored = true;
            const s = saved.state;
            state = { ...state, movieIds: ids(s.movieIds).slice(0, 3), dustLimit: [30, 60, 90].includes(s.dustLimit) ? s.dustLimit : 60,
              rankingSortKey: typeof s.rankingSortKey === "string" ? s.rankingSortKey : "average",
              filters: { ...defaults(), ...s.filters }, selectedAnimeIds: ids(s.selectedAnimeIds).slice(0, 3) };
            if (saved.layout && typeof saved.layout === "object") layout = { ...layout, ...saved.layout };
            return true;
          }
        } catch (_) { /* Malformed saved data does not imply storage is disabled. */ }
        return false;
      },
      // Import only a resolvable seed. Old Top-20 IDs, filters, ranking and layout
      // are deliberately excluded; the next source derivation uses today's algorithm.
      migrateLegacy(recommendations) {
        if (sessionRestored) return false;
        let raw;
        try { raw = storage?.getItem("aniviz_seed_movie"); }
        catch (_) { storageFailure(); return false; }
        try {
          const seed = JSON.parse(raw || "null");
          const movie = recommendations?.movies.find(row => id(row.id) === String(seed?.tmdbId));
          if (!movie) return false;
          state.movieIds = [id(movie.id)];
          return true;
        } catch (_) { return false; }
      },
      setSources(recommendations, matrix) {
        if (data !== recommendations || scores !== matrix) signature = null;
        data = recommendations; scores = matrix;
        lookup = joinRecords(data?.anime || [], metadata);
        state.movieIds = state.movieIds.filter(key => data?.movies.some(movie => id(movie.id) === key));
        return derive({ resample: true, rerank: true });
      },
      setMetadata(rows, status = "ready") {
        metadata = rows || []; metadataStatus = status;
        lookup = joinRecords(data?.anime || [], metadata);
        return derive();
      },
      setMovies(values) {
        state.movieIds = ids(values).filter(key => data?.movies.some(movie => id(movie.id) === key)).slice(0, 3);
        return derive({ resample: true, rerank: true });
      },
      setDustLimit(value) {
        state.dustLimit = [30, 60, 90].includes(Number(value)) ? Number(value) : 60;
        return derive({ resample: true });
      },
      setFilters(patch) { state.filters = { ...state.filters, ...patch }; return derive(); },
      resetFilters() { state.filters = defaults(); return derive(); },
      setRankingSort(key) {
        state.rankingSortKey = state.movieIds.includes(id(key)) ? id(key) : "average";
        return derive({ rerank: true });
      },
      setSelection(values) {
        state.selectedAnimeIds = ids(values).filter(key => state.displayedDustIds.includes(key)).slice(0, 3);
        return publish();
      },
      toggleSelection(value) {
        const key = id(value);
        if (!state.displayedDustIds.includes(key)) return snapshot();
        if (state.selectedAnimeIds.includes(key)) return api.setSelection(state.selectedAnimeIds.filter(item => item !== key));
        if (state.selectedAnimeIds.length >= 3) {
          onNotice("Compare up to 3 anime. Remove a selected title before adding another.");
          return snapshot();
        }
        return api.setSelection([...state.selectedAnimeIds, key]);
      },
      getLayout() { return layout; },
      saveLayout(patch) { layout = { ...layout, ...patch }; persist(); },
      resetPositions() { layout = { ...layout, magnetPositions: {}, particles: null }; persist(); }
    };
    return api;
  }
  return { VERSION, STORAGE_KEY, defaults, joinRecords, passesFilters, rankCorpus, createContext };
});
