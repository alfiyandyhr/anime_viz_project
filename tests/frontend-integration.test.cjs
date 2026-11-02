const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync, readdirSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

test("legacy recommendation bookmarks preserve the deployment prefix and query", () => {
  const source = readFileSync(path.join(root, "frontend/common/redirect.js"), "utf8");
  for (const prefix of ["/", "/anime_viz_project/"]) {
    let target;
    vm.runInNewContext(source, {
      URL,
      location: { hash: "#recommendations", search: "?view=shared", replace: url => { target = url.href; } },
      document: { currentScript: { src: `https://example.com${prefix}frontend/common/redirect.js` } }
    });
    assert.equal(target, `https://example.com${prefix}frontend/recommendations/index.html?view=shared`);
  }
});

test("every frontend page links to recommendations and the separate dust playground, and resolves local resources", () => {
  for (const page of readdirSync(path.join(root, "frontend"))) {
    const filename = path.join(root, "frontend", page, "index.html");
    if (!existsSync(filename)) continue;
    const html = readFileSync(filename, "utf8");
    assert.match(html, /href="\.\.\/recommendations\/index\.html"/, page);
    assert.match(html, /data-goto="explorer"[\s\S]*?<\/a>\s*<a class="rail-link[^"]*"[^>]*data-goto="dust-magnet" href="\.\.\/dust-magnet\/index\.html"/, page);
    assert.doesNotMatch(html, /data-recommendation-viz="magnets"/, page);
    for (const [, resource] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (/^(?:https?:|mailto:|data:)/.test(resource)) continue;
      assert.ok(existsSync(path.resolve(path.dirname(filename), resource.split(/[?#]/)[0])), `${page}: ${resource}`);
    }
  }
});

test("pages with independent data initialize and resize without loading the dashboard", async () => {
  let initialize;
  let dashboardRequests = 0;
  let binds = 0;
  let renders = 0;
  const context = vm.createContext({
    URL, Intl, Set,
    document: {
      currentScript: { src: "https://example.com/frontend/common/app.js" },
      querySelector: () => ({ addEventListener() {} }),
      addEventListener: (event, callback) => { if (event === "DOMContentLoaded") initialize = callback; }
    },
    window: { addEventListener() {} },
    fetch: () => { dashboardRequests++; throw new Error("Dashboard unavailable"); }
  });
  vm.runInContext(readFileSync(path.join(root, "frontend/common/app.js"), "utf8"), context);
  context.controls = { usesDashboard: false, bindControls: () => binds++, render: () => renders++ };
  vm.runInContext("registerPage(controls)", context);
  await initialize();
  vm.runInContext("renderPage()", context);
  assert.equal(binds, 1);
  assert.equal(renders, 2);
  assert.equal(dashboardRequests, 0);
});

test("Explorer tabs defer rendering until data arrives and refresh only the visible view", () => {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: selector === "#panel-scatter",
      attributes: {},
      listeners: {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { this.focused = true; }
    });
    return nodes.get(selector);
  };
  const renders = [];
  let controls;
  const context = vm.createContext({
    elements: {},
    state: { data: null, filteredAnime: [], tablePage: 2 },
    document: { querySelector: node },
    registerPage: value => { controls = value; },
    hideTooltip() {},
    record: view => renders.push({ view, anime: [...context.state.filteredAnime] })
  });
  vm.runInContext(readFileSync(path.join(root, "frontend/explorer/app.js"), "utf8"), context);
  vm.runInContext(`
    renderKPIs = () => {};
    renderInsights = () => {};
    renderAnimeTable = () => record("table");
    renderScatterplot = () => record("scatter");
    renderComparison = () => {};
  `, context);
  controls.bindControls();

  node("#tab-scatter").listeners.click();
  assert.deepEqual(renders, [], "a tab can be selected while the dashboard is still loading");
  assert.equal(node("#panel-table").hidden, true);
  assert.equal(node("#panel-scatter").hidden, false);

  context.state.data = {};
  context.state.filteredAnime = [{ id: 1 }, { id: 2 }];
  controls.render();
  context.state.filteredAnime = [{ id: 2 }];
  controls.render(); // Shared filters and resize both call the page renderer.
  assert.deepEqual(renders, [
    { view: "scatter", anime: [{ id: 1 }, { id: 2 }] },
    { view: "scatter", anime: [{ id: 2 }] }
  ]);

  const key = (selector, value) => {
    let prevented = false;
    node(selector).listeners.keydown({ key: value, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  };
  key("#tab-scatter", "ArrowLeft");
  assert.deepEqual(renders.at(-1), { view: "table", anime: [{ id: 2 }] });
  assert.equal(node("#panel-scatter").hidden, true);
  assert.equal(node("#tab-table").attributes["aria-selected"], "true");
  assert.equal(node("#tab-table").tabIndex, 0);
  assert.equal(node("#tab-scatter").tabIndex, -1);
  assert.equal(node("#tab-table").focused, true);
  assert.equal(context.state.tablePage, 2, "switching views retains table pagination");

  key("#tab-table", "End");
  assert.equal(renders.at(-1).view, "scatter");
  key("#tab-scatter", "Home");
  assert.equal(renders.at(-1).view, "table");
  key("#tab-table", "ArrowRight");
  assert.equal(renders.at(-1).view, "scatter");
});
