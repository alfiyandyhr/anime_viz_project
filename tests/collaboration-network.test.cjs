const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Load the pure graph builder without bootstrapping the dashboard DOM.
const source = readFileSync(path.join(__dirname, "../frontend/creators/app.js"), "utf8");
const start = source.indexOf("function buildCollaborationNetwork(");
const end = source.indexOf("function renderNetwork()", start);
const build = vm.runInNewContext(`(${source.slice(start, end).trim()})`);
const allTypes = new Set(["actor", "character", "work"]);
const anime = [
  { id: 1, title: "First work", popularity: 10, voice_actors: [
    { id: "1", name: "Actor One", characters: ["Alex", "Alex"] },
    { id: "2", name: "Actor Two", characters: ["Sam"] }
  ] },
  { id: 2, title: "Second work", popularity: 20, voice_actors: [
    { id: "1", name: "Actor One", characters: ["Alex"] }
  ] }
];

test("all five relationship types have valid endpoints and no duplicate edges", () => {
  const graph = build(anime, allTypes);
  assert.equal(graph.nodes.length, 7);
  assert.equal(graph.links.length, 11);
  const types = new Map(graph.nodes.map((node) => [node.id, node.type]));
  const pairs = new Set(graph.links.map((link) =>
    `${types.get(link.source)}-${types.get(link.target)}`));
  assert.deepEqual([...pairs].sort(), ["actor-actor", "actor-character", "actor-work", "character-character", "character-work"]);
  assert.equal(new Set(graph.links.map((link) => `${link.source}|${link.target}`)).size, 11);
  assert.equal(graph.nodes.filter((node) => node.name === "Alex").length, 2);
});

test("all eight node-type combinations remove hidden endpoints and recompute degree", () => {
  for (let mask = 0; mask < 8; mask++) {
    const selected = new Set([...allTypes].filter((_, index) => mask & (1 << index)));
    const { nodes, links } = build(anime, selected);
    const ids = new Set(nodes.map((node) => node.id));
    assert.ok(nodes.every((node) => selected.has(node.type)));
    assert.ok(links.every((link) => ids.has(link.source) && ids.has(link.target)));
    for (const node of nodes) {
      const neighbors = new Set(links.flatMap((link) => link.source === node.id
        ? [link.target] : link.target === node.id ? [link.source] : []));
      assert.equal(node.degree, neighbors.size);
      assert.ok(Number.isFinite(node.opacity) && node.opacity >= 0.3 && node.opacity <= 1);
    }
    if (selected.size === 1) {
      assert.equal(links.length, selected.has("work") ? 0 : 1);
    }
    if (mask === 0) assert.equal(nodes.length, 0);
  }
});

test("more distinct connections strictly increase opacity", () => {
  const { nodes } = build(anime, allTypes);
  for (const a of nodes) {
    for (const b of nodes) {
      if (a.degree > b.degree) assert.ok(a.opacity > b.opacity);
      if (a.degree === b.degree) assert.equal(a.opacity, b.opacity);
    }
  }
  assert.equal(Math.max(...nodes.map((node) => node.opacity)), 1);
});

test("search finds works by actor, character, and title before applying popularity limit", () => {
  for (const query of [" ACTOR TWO ", "sam", "first work"]) {
    const graph = build(anime, allTypes, query, 1);
    assert.equal(graph.sampledWorkCount, 1);
    assert.equal(graph.matchingWorkCount, 1);
    assert.equal(graph.nodes.find((node) => node.type === "work").id, "work:1");
  }
  const limited = build(anime, allTypes, "", 1);
  assert.equal(limited.matchingWorkCount, 2);
  assert.equal(limited.nodes.find((node) => node.type === "work").id, "work:2");
  assert.equal(build(anime, allTypes, "missing").nodes.length, 0);
});

test("handles empty cast data, empty results, and equal node degrees", () => {
  assert.equal(build([], allTypes).links.length, 0);
  const isolated = build([{ id: 3, title: "No cast" }], allTypes);
  assert.equal(isolated.nodes[0].degree, 0);
  assert.equal(isolated.nodes[0].opacity, 0.3);
  const triangle = build([anime[1]], allTypes);
  assert.ok(triangle.nodes.every((node) => node.degree === 2 && node.opacity === 1));
});

test("bundled dataset produces every relationship type without mutating source records", () => {
  const data = JSON.parse(readFileSync(path.join(__dirname, "../data.json"), "utf8"));
  const before = JSON.stringify(data.anime);
  const graph = build(data.anime, allTypes);
  assert.equal(graph.sampledWorkCount, 35);
  assert.equal(graph.matchingWorkCount, data.anime.length);
  assert.equal(graph.nodes.filter((node) => node.type === "work").length, 35);
  assert.equal(new Set(graph.links.map((link) => link.relation)).size, 5);
  assert.equal(JSON.stringify(data.anime), before);
});

test("co-starring links aggregate shared works despite reverse cast order and duplicate records", () => {
  const repeated = [...anime, {
    id: 3, title: "Third work", popularity: 30, voice_actors: [
      { id: "2", name: "Actor Two", characters: ["Taylor"] },
      { id: "1", name: "Actor One", characters: ["Jordan"] },
      { id: "1", name: "Actor One", characters: ["Jordan"] }
    ]
  }];
  const { nodes, links } = build(repeated, new Set(["actor"]));
  assert.equal(links.length, 1);
  assert.equal(links[0].relation, "Co-stars in");
  assert.deepEqual(Array.from(links[0].works, (work) => work.id).sort(), [1, 3]);
  assert.ok(nodes.every((node) => node.degree === 1));
  assert.ok(links.every((link) => link.source !== link.target));
});

test("character peers link only within their anime, including roles voiced by one actor", () => {
  const works = [...anime, {
    id: 4, title: "Dual roles", voice_actors: [
      { id: "3", name: "Actor Three", characters: ["Twin One", "Twin Two"] }
    ]
  }];
  const { links } = build(works, new Set(["character"]));
  assert.equal(links.length, 2);
  assert.ok(links.every((link) => link.relation === "Appears together in"));
  assert.ok(links.every((link) => link.source.split(":")[1] === link.target.split(":")[1]));
});

const profileStart = source.indexOf("function buildVoiceActorProfile(");
const profileEnd = source.indexOf("function openVoiceActorDetail(", profileStart);
const buildProfile = vm.runInNewContext(`(${source.slice(profileStart, profileEnd).trim()})`);

test("actor profile groups characters by work and uses actor ID, not a shared name", () => {
  const works = [...anime, { id: 5, title: "Namesake", voice_actors: [
    { id: "99", name: "Actor One", characters: ["Unrelated"] }
  ] }];
  const profile = buildProfile("1", works);
  assert.equal(profile.name, "Actor One");
  assert.equal(profile.credits.length, 2);
  assert.equal(profile.roleCount, 2);
  assert.deepEqual(Array.from(profile.credits, (credit) => credit.work.id), [2, 1]);
  assert.equal(profile.credits[1].characters.length, 1);
  assert.equal(buildProfile("absent", works), null);
});

test("actor profile includes sampled works beyond the network display limit", () => {
  const data = JSON.parse(readFileSync(path.join(__dirname, "../data.json"), "utf8"));
  const actor = data.network.nodes[0];
  const profile = buildProfile(actor.id, data.anime);
  assert.equal(profile.credits.length, actor.show_ids.length);
  assert.equal(profile.image, actor.image);
  assert.equal(profile.site_url, actor.site_url);
});
