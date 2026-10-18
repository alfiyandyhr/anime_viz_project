"use strict";

// Pure data transformations, kept separate from scrolling and DOM rendering.
// Chapter metadata lives on .story-step elements in index.html.
const StoryData = (() => {
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

  return { validate, summarizePeriod, locatePeriod, yearScrollProgress };
})();
if (typeof module !== "undefined" && module.exports) module.exports = StoryData;
