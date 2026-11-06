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
    explorer: ["explorer"], catalogue: ["explorer"], network: ["network"]
  };
  const graphAnchors = new Set(["network", "network-chart", "tab-network", "collaboration", "collaboration-structure"]);
  function resolve(entry, search = "", hash = "") {
    const fragment = hash.replace(/^#/, "");
    const name = entry || fragment;
    let [page, anchor] = aliases[name] || aliases["dust-magnet"];
    if (name === "creators" && graphAnchors.has(fragment)) page = "network", anchor = null;
    const query = new URLSearchParams(search);
    const mode = query.get("mode");
    query.delete("mode");
    if (page === "explorer") query.set("mode", "catalogue");
    if (page === "network" && ["matches", "catalogue"].includes(mode)) query.set("scope", mode === "matches" ? "dust" : "catalogue");
    const suffix = query.toString();
    return `../${page}/index.html${suffix ? `?${suffix}` : ""}${anchor ? `#${anchor}` : ""}`;
  }
  return { resolve };
});
