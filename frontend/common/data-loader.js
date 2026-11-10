"use strict";
// Independent promise caches: a failed metadata request cannot reject similarity or History.
(function (root) {
  const base = new URL("../../", document.currentScript.src);
  const requests = new Map();
  function once(key, loader) {
    if (!requests.has(key)) requests.set(key, Promise.resolve().then(loader).catch(error => {
      requests.delete(key); // Explicit retries are possible; successful resources remain cached.
      throw error;
    }));
    return requests.get(key);
  }
  async function json(path, cache = "default") {
    const response = await fetch(new URL(path, base), { headers: { Accept: "application/json" }, cache });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  root.AnivizData = Object.freeze({
    dashboard: () => once("dashboard", async () => {
      const payload = await json("data.json");
      if (!Array.isArray(payload.anime) || !payload.meta) throw new Error("Invalid dashboard metadata");
      return payload;
    }),
    recommendations: () => once("recommendations", () => json("data/movie_recommendations.json")),
    movieDetails: data => {
      const movieIds = data.movies.map(movie => String(movie.id)).sort();
      return once(`movie-details:${movieIds.join(",")}`, async () => {
        const payload = await json("data/movie_details.json");
        const movies = payload?.movies;
        if (payload?.schema_version !== 1 || payload.source !== "TMDB"
          || payload.record_count !== movieIds.length || !movies || Object.keys(movies).length !== movieIds.length
          || movieIds.some(id => !Object.hasOwn(movies, id) || !movies[id] || typeof movies[id] !== "object")) {
          throw new Error("Invalid TMDB details for this movie sample");
        }
        // Reception always comes from the archived popularity and ratings, collected separately.
        return Object.fromEntries(movieIds.map(id => {
          const { poster_path, backdrop_path, runtime } = movies[id];
          return [id, { poster_path, backdrop_path, runtime: Number.isInteger(runtime) && runtime > 0 ? runtime : null }];
        }));
      });
    },
    moviePopularity: data => {
      const movieIds = data.movies.map(movie => String(movie.id));
      return once(`movie-popularity:${movieIds.join(",")}`, async () => {
        const ids = new Set(movieIds);
        const payload = await json("data/movie_popularity.json", "no-cache");
        const { popularity, vote_average: ratings, snapshot_date: date } = payload || {};
        const entries = Object.entries(popularity || {});
        const validValues = (values, valid) => values && typeof values === "object" && !Array.isArray(values)
          && Object.keys(values).length === ids.size
          && movieIds.every(id => Object.hasOwn(values, id) && (values[id] === null || valid(values[id])));
        const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date) : null;
        if (payload?.schema_version !== 1 || payload.source !== "TMDB" || payload.metric !== "popularity"
          || !parsedDate || !Number.isFinite(+parsedDate) || parsedDate.toISOString().slice(0, 10) !== date
          || !/^[a-f0-9]{64}$/.test(payload.input_sha256)
          || ids.size !== movieIds.length || payload.record_count !== ids.size
          || !validValues(popularity, value => Number.isFinite(value) && value >= 0)
          || (ratings !== undefined && !validValues(ratings, value => Number.isFinite(value) && value >= 0 && value <= 10))
          || payload.eligible_count !== entries.filter(([, value]) => Number.isFinite(value)).length) {
          throw new Error("Invalid archived TMDB data for this movie sample");
        }
        const rankedIds = movieIds.filter(id => Number.isFinite(popularity[id]))
          .sort((a, b) => popularity[b] - popularity[a]);
        const ranks = new Map(rankedIds.map((id, index) => [id, index + 1]));
        const movies = Object.fromEntries(movieIds.map(id => [id, {
          popularity: popularity[id],
          popularity_rank: ranks.get(id) ?? null,
          vote_average: ratings?.[id] ?? null
        }]));
        return { ...payload, movies };
      });
    },
    history: () => once("history", () => json("story.json")),
    matrix: data => once(`matrix:${data.meta.score_matrix?.sha256}`, async () => {
      const meta = data.meta.score_matrix;
      if (!meta || meta.dtype !== "float32-le" || meta.layout !== "movie-major"
        || meta.rows !== data.movies.length || meta.columns !== data.anime.length) throw new Error("Invalid similarity matrix metadata");
      const response = await fetch(new URL(meta.file, new URL("data/movie_recommendations.json", base)));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== meta.rows * meta.columns * 4) throw new Error("Incomplete similarity matrix");
      if (root.crypto?.subtle) {
        const digest = await root.crypto.subtle.digest("SHA-256", buffer);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        if (hash !== meta.sha256) throw new Error("Similarity matrix does not match the movie data");
      }
      const view = new DataView(buffer), scores = new Float32Array(meta.rows * meta.columns);
      for (let i = 0; i < scores.length; i++) {
        scores[i] = view.getFloat32(i * 4, true);
        if (!Number.isFinite(scores[i]) || Math.abs(scores[i]) > 1) throw new Error("Invalid similarity score");
      }
      return scores;
    })
  });
})(globalThis);
