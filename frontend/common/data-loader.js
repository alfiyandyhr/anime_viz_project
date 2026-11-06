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
  async function json(path) {
    const response = await fetch(new URL(path, base), { headers: { Accept: "application/json" } });
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
