"use strict";
// Explicit aliases share one implementation on Flask and project-prefixed static hosting.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    const script = document.currentScript;
    location.replace(new URL(api.resolve(script.dataset?.route, location.search, location.hash), script.src));
  }
})(globalThis, function () {
  const aliases = {
    intro: ["dust-magnet"], recommendations: ["dust-magnet"], "dust-magnet": ["dust-magnet"],
    content: ["dust-magnet", "content"], creators: ["dust-magnet", "creators"],
    reception: ["dust-magnet", "reception"], story: ["story"], history: ["story"],
    explorer: ["explorer"], catalogue: ["explorer"]
  };
  function resolve(entry, search = "", hash = "") {
    const fragment = hash.replace(/^#/, "");
    const [page, anchor] = aliases[entry || fragment] || aliases["dust-magnet"];
    const query = new URLSearchParams(search);
    query.delete("mode");
    if (page === "explorer") query.set("mode", "catalogue");
    const suffix = query.toString();
    return `../${page}/index.html${suffix ? `?${suffix}` : ""}${anchor ? `#${anchor}` : ""}`;
  }
  return { resolve };
});
