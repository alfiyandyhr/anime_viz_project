"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnivizChartData = api;
})(globalThis, function () {
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  function aggregate(anime, field, name, selectedIds = []) {
    const selected = new Set(selectedIds.map(String)), groups = new Map();
    anime.forEach(item => [...new Set(item[field] || [])].forEach(key => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }));
    return [...groups].map(([key, rows]) => {
      const scores = rows.map(row => row.average_score).filter(Number.isFinite);
      const popularity = rows.map(row => row.popularity).filter(Number.isFinite);
      const favourites = rows.map(row => row.favourites).filter(Number.isFinite);
      const genres = new Map();
      rows.forEach(row => (row.genres || []).forEach(genre => genres.set(genre, (genres.get(genre) || 0) + 1)));
      return { [name]: key, count: rows.length, ids: rows.map(row => String(row.id)),
        selectedCount: rows.filter(row => selected.has(String(row.id))).length,
        averageScore: mean(scores), scoreCount: scores.length,
        totalPopularity: popularity.length ? popularity.reduce((a, b) => a + b, 0) : null,
        totalFavourites: favourites.length ? favourites.reduce((a, b) => a + b, 0) : null,
        dominantGenre: [...genres].sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown" };
    });
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
  return { genres: (anime, selected) => aggregate(anime, "genres", "genre", selected),
    studios: (anime, selected) => aggregate(anime, "studio_names", "studio", selected), timeline, correlation, comparisonValues };
});
