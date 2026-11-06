"use strict";
// Read the published analytical snapshot without restoring or writing dust state.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnivizNetworkScope = api;
})(globalThis, function () {
  function read(storage) {
    try {
      const saved = JSON.parse(storage.getItem("aniviz-dust-session-v1") || "null");
      const state = saved?.state;
      if (saved?.version !== 1 || state?.version !== 1 || !Array.isArray(state.movieIds)
        || !state.movieIds.length || !Array.isArray(state.candidateDustIds)
        || !Array.isArray(state.displayedDustIds)) return null;
      const candidates = new Set(state.candidateDustIds.map(String));
      return { ids: [...new Set(state.displayedDustIds.map(String))].filter(id => candidates.has(id)) };
    } catch (_) { return null; }
  }
  function resolve(anime, dust, scope) {
    if (scope !== "dust" || !dust) return { anime, total: anime.length, missing: 0 };
    const lookup = new Map(anime.map(work => [String(work.id), work]));
    const works = dust.ids.map(id => lookup.get(id)).filter(Boolean);
    return { anime: works, total: dust.ids.length, missing: dust.ids.length - works.length };
  }
  return { read, resolve };
});
