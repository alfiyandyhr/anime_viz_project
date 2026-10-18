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

test("every frontend page links to recommendations and resolves its local resources", () => {
  for (const page of readdirSync(path.join(root, "frontend"))) {
    const filename = path.join(root, "frontend", page, "index.html");
    if (!existsSync(filename)) continue;
    const html = readFileSync(filename, "utf8");
    assert.match(html, /href="\.\.\/recommendations\/index\.html"/, page);
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
