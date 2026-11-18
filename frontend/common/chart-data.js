"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnivizChartData = api;
})(globalThis, function () {
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  function genres(anime, selectedIds = []) {
    const selected = new Set(selectedIds.map(String));
    const groups = new Map();
    for (const item of anime) {
      for (const genre of new Set(item.genres || [])) {
        if (!groups.has(genre)) groups.set(genre, []);
        groups.get(genre).push(item);
      }
    }
    return [...groups].map(([genre, rows]) => ({ genre, ...summarize(rows, selected) }));
  }
  function summarize(rows, selected) {
    const scores = rows.map(row => row.average_score).filter(Number.isFinite);
    const popularity = rows.map(row => row.popularity).filter(Number.isFinite);
    const favourites = rows.map(row => row.favourites).filter(Number.isFinite);
    const genres = new Map();
    rows.forEach(row => (row.genres || []).forEach(genre => genres.set(genre, (genres.get(genre) || 0) + 1)));
    return { count: rows.length, ids: rows.map(row => String(row.id)),
      selectedCount: rows.filter(row => selected.has(String(row.id))).length,
      averageScore: mean(scores), scoreCount: scores.length, popularityCount: popularity.length,
      totalPopularity: popularity.length ? popularity.reduce((a, b) => a + b, 0) : null,
      totalFavourites: favourites.length ? favourites.reduce((a, b) => a + b, 0) : null,
      dominantGenre: [...genres].sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown" };
  }
  function studios(anime, selectedIds = []) {
    const selected = new Set(selectedIds.map(String)), groups = new Map();
    for (const item of anime) {
      const credits = (item.studios || []).filter(credit => credit.id != null && credit.name);
      const names = new Set(credits.map(credit => credit.name));
      const studios = [...credits, ...(item.studio_names || []).filter(name => !names.has(name)).map(name => ({ name }))];
      for (const { id, name } of studios) {
        const key = id == null ? `name:${name}` : `anilist:studio:${id}`;
        if (!groups.has(key)) groups.set(key, { studio: name, key, studioId: id == null ? null : String(id), works: new Map() });
        groups.get(key).works.set(String(item.id), item);
      }
    }
    return [...groups.values()].map(({ works, ...studio }) => ({
      ...studio, ...summarize([...works.values()], selected)
    }));
  }
  function voiceActors(anime) {
    const actors = new Map();
    for (const work of anime) {
      for (const actor of work.voice_actors || []) {
        if (actor.id == null || !actor.name) continue;
        const key = `anilist:staff:${actor.id}`;
        if (!actors.has(key)) {
          actors.set(key, { key, id: String(actor.id), title: actor.name, image: actor.image, works: new Map() });
        }
        const group = actors.get(key);
        group.image ||= actor.image;
        group.works.set(String(work.id), work);
      }
    }
    return [...actors.values()].map(({ works, ...actor }) => ({
      ...actor, ...summarize([...works.values()], new Set())
    }));
  }
  function timeline(anime, selectedIds = []) {
    const selected = new Set(selectedIds.map(String)), groups = new Map();
    anime.filter(row => Number.isFinite(row.year)).forEach(row => {
      if (!groups.has(row.year)) groups.set(row.year, []);
      groups.get(row.year).push(row);
    });
    return [...groups].map(([year, rows]) => ({ year, count: rows.length,
      selectedCount: rows.filter(row => selected.has(String(row.id))).length,
      averageScore: mean(rows.map(row => row.average_score).filter(Number.isFinite)),
      totalPopularity: rows.some(row => Number.isFinite(row.popularity))
        ? rows.reduce((sum, row) => sum + (row.popularity ?? 0), 0) : null
    })).sort((a, b) => a.year - b.year);
  }
  function correlation(points) {
    const valid = points.filter(p => p.every(Number.isFinite));
    if (valid.length < 3) return null;
    const x = mean(valid.map(p => p[0])), y = mean(valid.map(p => p[1]));
    const xx = valid.reduce((s, p) => s + (p[0] - x) ** 2, 0);
    const yy = valid.reduce((s, p) => s + (p[1] - y) ** 2, 0);
    return xx && yy ? valid.reduce((s, p) => s + (p[0] - x) * (p[1] - y), 0) / Math.sqrt(xx * yy) : null;
  }
  function comparisonValues(anime) {
    const episodes = Number.isFinite(anime.episodes) && anime.episodes > 0 ? anime.episodes : null;
    const duration = Number.isFinite(anime.duration) && anime.duration > 0 ? anime.duration : null;
    return { format: anime.format || null, year: Number.isFinite(anime.year) ? anime.year : null,
      episodes, duration, runtime: episodes && duration ? episodes * duration : null,
      score: Number.isFinite(anime.average_score) ? anime.average_score : null, status: anime.status || null };
  }
  const hasMovieReception = movie => Number.isInteger(movie.popularity_rank) && movie.popularity_rank >= 1
    && Number.isFinite(movie.vote_average) && movie.vote_average >= 0 && movie.vote_average <= 10;
  return { genres, studios, voiceActors, timeline, correlation, comparisonValues, hasMovieReception };
});
