const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync, readdirSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

test("all views have exactly four shared destinations, with relative resources and no rail or journey", () => {
  const active = {"dust-magnet": "Dust &amp; Magnet", story: "History", network: "Network", explorer: "Full Catalogue"};
  for (const page of readdirSync(path.join(root, "frontend"))) {
    const filename = path.join(root, "frontend", page, "index.html");
    if (!existsSync(filename)) continue;
    const html = readFileSync(filename, "utf8");
    if (["intro", "recommendations", "content", "creators", "reception"].includes(page)) {
      assert.match(html, /data-route="(?:intro|recommendations|content|creators|reception)"/);
    } else {
      const nav = html.match(/<nav id="view-destinations"[\s\S]*?<\/nav>/)[0];
      assert.deepEqual([...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(([, href, label]) => [href, label]), [
        ["../dust-magnet/index.html", "Dust &amp; Magnet"], ["../story/index.html", "History"],
        ["../network/index.html", "Network"], ["../explorer/index.html?mode=catalogue", "Full Catalogue"]
      ], page);
      assert.equal((html.match(/data-view-menu/g) || []).length, 1);
      assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
      if (active[page]) assert.ok(html.includes(`<summary aria-controls="view-destinations">${active[page]}</summary>`));
    }
    assert.doesNotMatch(html, /class="rail|id="journey-(?:overview|next)"|Optional exploration|Task [1-4]/, page);
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

test("Dust & Magnet owns contextual controls and details in normal flow; Network owns graph controls", () => {
  const dust = readFileSync(path.join(root, "frontend/dust-magnet/index.html"), "utf8");
  assert.match(dust, /data-field-options/);
  assert.match(dust, /id="recommendation-detail"[^>]* hidden/);
  assert.ok(dust.indexOf('id="recommendation-chart"') < dust.indexOf('id="recommendation-detail"'));
  assert.ok(dust.indexOf('id="recommendation-detail"') < dust.indexOf('id="dust-analysis"'));
  const network = readFileSync(path.join(root, "frontend/network/index.html"), "utf8");
  assert.doesNotMatch(network, /id="filterbar"/);
  assert.match(network, /id="network-search"/);
  assert.match(network, /data-network-type="actor"/);
  assert.doesNotMatch(network, /id="(?:studio-chart|heatmap-chart|cohort-studios)"/);
  for (const stylesheet of ['frontend/common/styles.css', 'frontend/explorer/styles.css', 'frontend/story/styles.css']) {
    assert.doesNotMatch(readFileSync(path.join(root, stylesheet), 'utf8'), /--rail-width|grid-template-columns:\s*300px/, stylesheet);
  }
  const history = readFileSync(path.join(root, "frontend/story/index.html"), "utf8");
  assert.doesNotMatch(history, /id="filterbar"|movie-search-banner/);
});

test('main and catalogue score controls and overflowing tables have accessible names', () => {
  for (const page of ['dust-magnet', 'explorer']) {
    const html = readFileSync(path.join(root, `frontend/${page}/index.html`), 'utf8');
    assert.match(html, /<label class="range-control" for="score-filter"[^>]*>/);
    assert.match(html, /class="table-wrapper" (?:tabindex="0" role="region"|role="region" tabindex="0") aria-label="[^"]+"/);
  }
});

test('view disclosure supports keyboard focus, Escape, focus departure and restored browser pages', () => {
  const events = {}, documentEvents = {}, windowEvents = {};
  const document = { activeElement: null, addEventListener: (name, callback) => { documentEvents[name] = callback; } };
  const focusable = name => ({ name, focus() { document.activeElement = this; } });
  const summary = focusable('summary');
  const links = ['Dust & Magnet', 'History', 'Network', 'Full Catalogue'].map(focusable);
  const menu = { open: false, querySelector: () => summary, querySelectorAll: () => links,
    addEventListener: (name, callback) => { events[name] = callback; },
    hasAttribute: name => name === 'data-view-menu', contains: target => [summary, ...links].includes(target) };
  document.querySelectorAll = () => [menu];
  vm.runInNewContext(readFileSync(path.join(root, 'frontend/common/navigation.js'), 'utf8'), {
    document, window: { addEventListener: (name, callback) => { windowEvents[name] = callback; } }
  });
  const key = name => { let prevented = false; events.keydown({ key: name, preventDefault() { prevented = true; }, stopPropagation() {} }); return prevented; };
  summary.focus(); assert.equal(key('ArrowDown'), true); assert.equal(menu.open, true); assert.equal(document.activeElement, links[0]);
  key('End'); assert.equal(document.activeElement, links[3]);
  key('ArrowDown'); assert.equal(document.activeElement, links[0]);
  key('ArrowUp'); assert.equal(document.activeElement, links[3]);
  key('Home'); assert.equal(document.activeElement, links[0]);
  assert.equal(key('Tab'), false, 'native Tab and Enter behavior must remain available');
  key('Escape'); assert.equal(menu.open, false); assert.equal(document.activeElement, summary);
  menu.open = true; events.focusout({ relatedTarget: {} }); assert.equal(menu.open, false);
  menu.open = true; documentEvents.click({ target: links[1] }); assert.equal(menu.open, true);
  documentEvents.click({ target: {} }); assert.equal(menu.open, false);
  menu.open = true; windowEvents.pageshow(); assert.equal(menu.open, false);
});
