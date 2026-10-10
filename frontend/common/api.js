"use strict";

// Small shared JSON client. All AniList requests stay on the Flask backend.
window.AnivizAPI = Object.freeze({
  async fetchJSON(url, { timeout = 65000, signal } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, timeout);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" }, signal: controller.signal
      });
      if (!response.ok) throw new Error(`Data request failed (${response.status})`);
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
});
