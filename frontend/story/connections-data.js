"use strict";

const StoryMovies = (() => {
  function validate(data) {
    if (data?.schema_version !== 1 || data.meta?.model?.id !== "Qwen/Qwen3-Embedding-4B"
      || !Array.isArray(data.periods) || !Array.isArray(data.movies)) throw new Error("Invalid story movie snapshot");
    const movies = new Set();
    for (const movie of data.movies) {
      if (typeof movie.id !== "string" || movies.has(movie.id) || typeof movie.title !== "string") {
        throw new Error("Invalid movie record");
      }
      movies.add(movie.id);
    }
    const periods = new Set();
    for (const period of data.periods) {
      if (periods.has(period.id) || !Number.isInteger(period.start) || !Number.isInteger(period.end)
        || period.end < period.start || !Array.isArray(period.anime)) throw new Error("Invalid movie period");
      periods.add(period.id);
      const animeIds = new Set();
      for (const anime of period.anime) {
        if (!Number.isInteger(anime.id) || animeIds.has(anime.id) || !Array.isArray(anime.matches)
          || anime.matches.length !== 3) throw new Error("Invalid period anime");
        animeIds.add(anime.id);
        const seen = new Set();
        anime.matches.forEach((match, i) => {
          if (!movies.has(match.movie_id) || seen.has(match.movie_id) || !Number.isFinite(match.score)
            || match.score < -1 || match.score > 1 || (i && match.score > anime.matches[i - 1].score)) {
            throw new Error("Invalid anime to movie match");
          }
          seen.add(match.movie_id);
        });
      }
    }
    return data;
  }

  // Count only complete cards that fit inside the chapter's existing whitespace.
  // This must never extend the chapter or alter the year-to-scroll mapping.
  function fitCount(available, headingHeight, cardHeights, gap = 20) {
    if (!Number.isFinite(available) || available <= headingHeight) return 0;
    let used = headingHeight, count = 0;
    for (const height of cardHeights) {
      if (!Number.isFinite(height) || height <= 0 || used + height + (count ? gap : 0) > available) break;
      used += height + (count ? gap : 0);
      count++;
    }
    return count;
  }

  return { validate, fitCount };
})();
if (typeof module !== "undefined" && module.exports) module.exports = StoryMovies;
