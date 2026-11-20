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
  function creditedPeople(titles, field) {
    const people = new Map();
    for (const work of titles) {
      for (const credit of work[field] || []) {
        if (credit.id == null || !credit.name) continue;
        const id = String(credit.id);
        if (!people.has(id)) {
          people.set(id, { id, name: credit.name, image: credit.image, profile_path: credit.profile_path, works: new Map() });
        }
        const person = people.get(id);
        person.image ||= credit.image;
        person.profile_path ||= credit.profile_path;
        person.works.set(String(work.id), work);
      }
    }
    return people;
  }
  function personGroups(titles, field, prefix, selectedIds = []) {
    const selected = new Set(selectedIds.map(String));
    return [...creditedPeople(titles, field).values()].map(({ id, name, image, profile_path, works }) => ({
      key: `${prefix}:${id}`, id, title: name, image, profile_path, ...summarize([...works.values()], selected)
    }));
  }
  const voiceActors = (anime, selectedIds) => personGroups(anime, "voice_actors", "anilist:staff", selectedIds);
  const originalCreators = (anime, selectedIds) => personGroups(anime, "original_creators", "anilist:staff", selectedIds);
  const movieActors = movies => personGroups(movies, "cast", "tmdb:person");
  const movieWriters = movies => personGroups(movies, "writers", "tmdb:person");
  const withOriginalCreators = (anime, credits) => anime.map(item => ({
    ...item, original_creators: credits[item.id]?.original_creators
  }));

  function creditHeatmap(anime, rowGroups, columnGroups, selectedIds = []) {
    const top = (groups, limit) => groups.slice().sort((a, b) => b.count - a.count).slice(0, limit);
    const rows = top(rowGroups, 15), columns = top(columnGroups, 10);
    const titles = new Map(anime.map(item => [String(item.id), item.title]));
    const selected = new Set(selectedIds.map(String));
    const cells = columns.flatMap(column => {
      const columnIds = new Set(column.ids);
      return rows.map(row => {
        const ids = row.ids.filter(id => columnIds.has(id));
        return { row, column, count: ids.length, titles: ids.map(id => titles.get(id)),
          selectedCount: ids.filter(id => selected.has(id)).length };
      });
    });
    return { rows, columns, cells };
  }
  function timeline(anime, selectedIds = []) {
    const selected = new Set(selectedIds.map(String)), groups = new Map();
    anime.filter(row => Number.isFinite(row.year)).forEach(row => {
      if (!groups.has(row.year)) groups.set(row.year, []);
      groups.get(row.year).push(row);
    });
    return [...groups].map(([year, rows]) => ({ year, count: rows.length, ids: rows.map(row => String(row.id)),
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
  return { genres, studios, creditedPeople, voiceActors, originalCreators, withOriginalCreators, creditHeatmap,
    movieActors, movieWriters, timeline, correlation, comparisonValues, hasMovieReception };
});
