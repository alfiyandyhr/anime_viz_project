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
    assert.match(html, /data-goto="creators"[\s\S]*?<\/a>\s*<a class="rail-link[^>]*data-goto="reception" href="\.\.\/reception\/index\.html">\s*<span class="idx">04<\/span>[\s\S]*?<strong>Reception<\/strong>[\s\S]*?<\/a>\s*<a class="rail-link[^>]*data-goto="explorer"/, page);
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

test("Reception renders audience context and Explorer renders the catalogue after filter or resize updates", () => {
  for (const page of ["reception", "explorer"]) {
    const renders = [];
    let controls;
    const context = vm.createContext({
      elements: {},
      state: { data: {}, filteredAnime: [{ id: 1 }, { id: 2 }] },
      document: { querySelector: () => ({}) },
      registerPage: value => { controls = value; },
      record: view => renders.push({ view, ids: context.state.filteredAnime.map(item => item.id) })
    });
    vm.runInContext(readFileSync(path.join(root, `frontend/${page}/app.js`), "utf8"), context);
    vm.runInContext(`
      renderKPIs = () => {};
      ${page === "reception" ? 'renderScatterplot = () => record("scatter");' : `
        renderInsights = () => {};
        renderAnimeTable = () => record("table");
        renderComparison = () => {};
      `}
    `, context);
    controls.render();
    context.state.filteredAnime = [{ id: 2 }];
    controls.render(); // Shared filters and resize both call the page renderer.
    assert.deepEqual(renders, [
      { view: page === "reception" ? "scatter" : "table", ids: [1, 2] },
      { view: page === "reception" ? "scatter" : "table", ids: [2] }
    ]);
  }
  const reception = readFileSync(path.join(root, "frontend/reception/index.html"), "utf8");
  assert.doesNotMatch(reception, /http-equiv="refresh"/);
  assert.match(reception, /id="scatter-chart"/);
  assert.match(reception, /aria-current="page" data-goto="reception"/);
  const explorer = readFileSync(path.join(root, "frontend/explorer/index.html"), "utf8");
  assert.doesNotMatch(explorer, /id="(?:scatter-chart|tab-scatter)"/);
  assert.match(explorer, /id="anime-table-body"/);
  assert.match(explorer, /id="comparison-footer"/);
});

test("catalogue entries explicitly activate catalogue mode on every page, including the introduction", () => {
  for (const page of readdirSync(path.join(root, "frontend"))) {
    const filename = path.join(root, "frontend", page, "index.html");
    if (!existsSync(filename)) continue;
    const html = readFileSync(filename, "utf8");
    assert.match(html, /class="rail-link catalogue-entry"[^>]*href="\.\.\/explorer\/index\.html\?mode=catalogue"/, page);
    if (page === "intro") {
      assert.match(html, /class="button button-secondary" href="\.\.\/explorer\/index\.html\?mode=catalogue"[\s\S]*?Browse full catalogue →/);
    }
    if (["content", "creators", "reception", "explorer"].includes(page)) {
      const header = html.match(/<header class="chapter-head">[\s\S]*?<\/header>/)[0];
      assert.match(header, /Full catalogue/);
      assert.doesNotMatch(header, /your matches|Task [234]|selected movie/);
    }
  }
});

test("all four tasks and Explorer provide journey guidance alongside optional rail explorations", () => {
  for (const page of ['recommendations', 'content', 'creators', 'reception', 'explorer']) {
    const html = readFileSync(path.join(root, `frontend/${page}/index.html`), 'utf8');
    assert.match(html, /<\/header>\s*<div id="journey-overview"/, page);
    if (['content', 'creators', 'reception'].includes(page)) {
      assert.match(html, /id="journey-next"[^>]*aria-label="Continue your movie journey"/, page);
    }
    assert.match(html, /Story — Optional exploration/);
    assert.match(html, /Dust &amp; Magnet — Optional exploration/);
  }
});
