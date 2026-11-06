"use strict";
// Lazy chart lifecycle. Off-screen updates erase obsolete marks and keep only the latest snapshot.
(function (root) {
  function create({ observerFactory, onError = () => {} } = {}) {
    const entries = new Map();
    let active = true, destroyed = false;
    const factory = observerFactory || (root.IntersectionObserver
      ? callback => new root.IntersectionObserver(callback, { rootMargin: "400px 0px" }) : null);
    const observer = factory?.(records => records.forEach(record => {
      const entry = entries.get(record.target);
      if (!entry) return;
      entry.visible = record.isIntersecting;
      if (entry.visible) flush(entry);
      else entry.renderer.pause?.();
    }));
    function flush(entry) {
      if (!active || destroyed || !entry.visible || !entry.latest) return;
      try { entry.renderer.update(entry.latest); entry.dirty = false; }
      catch (error) { entry.container.textContent = "Chart unavailable."; onError(error); }
    }
    return {
      mount(container, renderer) {
        if (entries.has(container)) throw new Error("Container already mounted");
        entries.set(container, { container, renderer, visible: !observer, latest: null, dirty: false });
        observer?.observe(container);
      },
      update(value) {
        entries.forEach(entry => {
          entry.latest = value; entry.dirty = true;
          if (active && entry.visible) flush(entry);
          else { entry.renderer.pause?.(); entry.container.replaceChildren(); }
        });
      },
      refresh() { entries.forEach(entry => flush(entry)); },
      setActive(value) {
        if (active === value) return;
        active = value;
        entries.forEach(entry => {
          if (active) flush(entry);
          else entry.renderer.pause?.();
        });
      },
      destroy() {
        if (destroyed) return;
        destroyed = true; observer?.disconnect();
        entries.forEach(entry => entry.renderer.destroy?.()); entries.clear();
      }
    };
  }
  root.AnivizComposition = Object.freeze({ create });
})(globalThis);
