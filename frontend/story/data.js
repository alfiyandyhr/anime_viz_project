"use strict";

// Pure data transformations, kept separate from scrolling and DOM rendering.
const StoryData = (() => {
  const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0) || a.id - b.id;

  function validate(payload) {
    const meta = payload?.meta;
    if (meta?.schema_version !== 1 || meta.start_year !== 1963
      || !Number.isInteger(meta.end_year) || meta.end_year < 1963
      || !Array.isArray(payload.years)) throw new Error("Invalid annual archive");
    const seen = new Set();
    for (const row of payload.years) {
      if (!Number.isInteger(row.year) || row.year < meta.start_year || row.year > meta.end_year
        || seen.has(row.year) || !Array.isArray(row.anime) || row.anime.length > 10) {
        throw new Error("Invalid annual ranking");
      }
      seen.add(row.year);
      const ids = new Set();
      for (const anime of row.anime) {
        if (!Number.isInteger(anime.id) || ids.has(anime.id) || anime.year !== row.year
          || typeof anime.title !== "string") throw new Error("Invalid anime record");
        ids.add(anime.id);
      }
    }
    return payload;
  }

  function summarizePeriod(payload, period) {
    const rows = payload.years.filter(row => row.year >= period.start && row.year <= period.end);
    const anime = rows.filter(row => row.status !== "unavailable").flatMap(row => row.anime);
    const genres = new Map();
    const studios = new Map();
    for (const work of anime) {
      for (const genre of new Set(work.genres || [])) genres.set(genre, (genres.get(genre) || 0) + 1);
      for (const studio of new Set(work.studio_names || [])) {
        if (studio !== "Unknown studio") studios.set(studio, (studios.get(studio) || 0) + 1);
      }
    }
    const ranking = counts => [...counts].map(([name, count]) => ({
      name, count, percent: anime.length ? 100 * count / anime.length : 0
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const available = new Set(rows.filter(row => row.status !== "unavailable").map(row => row.year));
    const missing = [];
    for (let year = period.start; year <= period.end; year++) {
      if (!available.has(year)) missing.push(year);
    }
    return { anime, genres: ranking(genres), studios: ranking(studios), missing,
      stale: rows.filter(row => row.status === "stale").map(row => row.year),
      availableYears: available.size };
  }

  function topAnime(payload, period, limit = 10) {
    const works = new Map(payload.years.filter(row => row.status !== "unavailable"
      && row.year >= period.start && row.year <= period.end)
      .flatMap(row => row.anime).map(work => [work.id, work]));
    return [...works.values()].sort(byPopularity).slice(0, limit);
  }

  // Finish before the next chapter starts, leaving time to view its last year.
  const chapterTravel = .9;

  function yearScrollProgress(period, year) {
    return chapterTravel * (year - period.start + .5) / (period.end - period.start + 1);
  }

  function locatePeriod(steps, probe) {
    let index = 0;
    for (let i = 0; i < steps.length; i++) {
      // Fractional layout pixels can put an anchored heading just past the
      // activation line; this tolerance keeps chapter links deterministic.
      if (steps[i].top <= probe + 2) index = i;
    }
    const step = steps[index];
    const progress = Math.max(0, Math.min(1, (probe - step.top) / Math.max(1, step.height * chapterTravel)));
    const year = Math.min(step.end, step.start + Math.floor(progress * (step.end - step.start + 1)));
    return { index, progress, year };
  }

  function yearPairs(archive, bundle) {
    if (bundle?.schema_version !== 1 || !Array.isArray(bundle.years) || !Array.isArray(bundle.movies)
      || !Number.isInteger(bundle.meta?.movie_count) || bundle.meta.movie_count < bundle.movies.length) {
      throw new Error("Invalid annual movie matches");
    }
    const movies = new Map();
    for (const movie of bundle.movies) {
      if (typeof movie.id !== "string" || movies.has(movie.id)
        || typeof movie.title !== "string" || !Number.isInteger(movie.year)) {
        throw new Error("Invalid movie record");
      }
      movies.set(movie.id, movie);
    }
    const matches = new Map();
    for (const match of bundle.years) {
      if (!Number.isInteger(match.year) || matches.has(match.year) || !Number.isInteger(match.anime_id)
        || !movies.has(match.movie_id) || !Number.isFinite(match.score) || Math.abs(match.score) > 1) {
        throw new Error("Invalid annual movie match");
      }
      matches.set(match.year, match);
    }
    const rows = new Map(archive.years.map(row => [row.year, row]));
    const { start_year: start, end_year: end } = archive.meta;
    return Array.from({ length: end - start + 1 }, (_, index) => {
      const year = start + index;
      const row = rows.get(year);
      const anime = row && row.status !== "unavailable" ? [...row.anime].sort(byPopularity)[0] || null : null;
      const match = matches.get(year);
      if (anime && anime.id === match?.anime_id) {
        return { year, anime, movie: movies.get(match.movie_id), score: match.score };
      }
      return { year, anime, movie: null, score: null };
    });
  }

  function movieYearPairs(catalogue, { popularity }) {
    const winners = new Map();
    for (const movie of catalogue.movies) {
      const value = popularity[movie.id];
      if (!Number.isInteger(movie.year) || !Number.isFinite(value)) continue;
      const current = winners.get(movie.year);
      if (!current || value > popularity[current.id]) winners.set(movie.year, movie);
    }
    if (!winners.size) throw new Error("No movies with a release year and popularity score");

    return [...winners.values()].sort((a, b) => a.year - b.year).map(movie => {
      // The exporter ranks each movie against the entire anime catalogue.
      const [index, score] = movie.matches?.[0] || [];
      const anime = catalogue.anime[index];
      if (!Number.isInteger(index) || !Number.isInteger(anime?.year)
        || !Number.isFinite(score) || Math.abs(score) > 1) {
        throw new Error(`Invalid best match for movie ${movie.id}`);
      }
      return {
        year: movie.year,
        movie: { ...movie, popularity: popularity[movie.id] },
        anime: { ...anime, description: anime.synopsis, site_url: anime.url },
        score
      };
    });
  }

  return { validate, summarizePeriod, topAnime, locatePeriod, yearScrollProgress, yearPairs, movieYearPairs };
})();
if (typeof module !== "undefined" && module.exports) module.exports = StoryData;
