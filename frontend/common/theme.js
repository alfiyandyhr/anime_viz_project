"use strict";

// Apply the saved preference before styles render to avoid a theme flash.
(() => {
  const key = "animoviz-theme";
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const valid = value => value === "light" || value === "dark";
  let preference;
  let transition;
  try { preference = localStorage.getItem(key); } catch { /* Storage is optional. */ }

  function apply({ animate = false } = {}) {
    const theme = valid(preference) ? preference : system.matches ? "dark" : "light";
    const update = () => {
      // Read the latest choice so rapid clicks cannot restore an older theme.
      const current = valid(preference) ? preference : system.matches ? "dark" : "light";
      root.dataset.theme = current;
      const button = document.querySelector("[data-theme-toggle]");
      if (button) {
        const label = `Switch to ${current === "dark" ? "light" : "dark"} mode`;
        button.setAttribute("aria-label", label);
        button.title = label;
      }
    };
    transition?.skipTransition();
    if (animate && root.dataset.theme !== theme && !reducedMotion.matches && document.startViewTransition) {
      // Crossfade the complete view, including gradients and SVG chart colors.
      const active = document.startViewTransition(update);
      transition = active;
      active.ready.catch(() => {}); // A newer click can skip snapshot capture.
      active.finished.catch(() => {}).finally(() => {
        if (transition === active) transition = null;
      });
    } else {
      update();
    }
  }

  apply();
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
      preference = (valid(preference) ? preference : root.dataset.theme) === "dark" ? "light" : "dark";
      try { localStorage.setItem(key, preference); } catch { /* Keep the current session usable. */ }
      apply({ animate: true });
    });
  }, { once: true });
  system.addEventListener("change", apply);
  window.addEventListener("pageshow", apply);
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) {
      preference = event.newValue;
      apply();
    }
  });
})();
