// Catalog tree checks: how nodes are classified, counted and searched.
//
//   node scripts/check-catalog-tree.mjs                 the rules, on a small tree in memory
//   node --env-file=.env.local scripts/check-catalog-tree.mjs --live
//                                                       also Development's real tree, read as the app reads it
//
// The live numbers are the tree as it stood in October 2026 (125 nodes, 7
// datasets). When a dataset lands, update them with it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib");
const require = createRequire(import.meta.url);
// Compile the real modules. A separate global object keeps their cache out
// of the running app's.
const context = vm.createContext({ console, URL, process, Buffer, setTimeout, clearTimeout, TextDecoder, TextEncoder, fetch, AbortController, globalThis: {} });
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const loaded = { exports: {} };
  modules.set(file, loaded);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const localRequire = (name) => name === "server-only" ? {} : name.startsWith(".") ? load(resolve(dirname(file), `${name}.ts`)) : require(name);
  vm.runInContext(`(function(require, module, exports) {${outputText}
})`, context, { filename: file })(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

// Catalogs and datasets. A Collection with no items and no assets is a
// catalog until the generator types it, leaf or not; a node with items and
// children is a dataset that also holds catalogs.
const { collectionParents, hierarchyOf, kindOf, searchCollections } = load(resolve(root, "collection-hierarchy.ts"));
const node = (over) => ({ type: "Collection", itemCount: 0, linksItems: false, assets: {}, childCollectionHrefs: [], ...over });
assert.equal(kindOf(node({ type: "Catalog" })), "catalog");
assert.equal(kindOf(node({ type: "Catalog", itemCount: 3 })), "catalog");
assert.equal(kindOf(node({ childCollectionHrefs: ["a.json"] })), "catalog");
assert.equal(kindOf(node({})), "catalog"); // An empty leaf is a shelf, not a dataset.
assert.equal(kindOf(node({ itemCount: 1 })), "dataset");
assert.equal(kindOf(node({ childCollectionHrefs: ["a.json"], itemCount: 1 })), "dataset");
assert.equal(kindOf(node({ assets: { plot: { href: "p.png" } } })), "dataset");
assert.equal(kindOf(node({ linksItems: true })), "dataset"); // A parquet file with no rows yet.

// The tree's shape in miniature: two roots with datasets, one without, a
// same-named empty catalog in two places, and a dataset that holds catalogs.
const tree = [
  { slug: "basin", name: "Basin Data", kind: "catalog", parentSlugs: [] },
  { slug: "storms", name: "Storm Catalog", kind: "dataset", blurb: "Hourly rain", parentSlugs: ["basin"] },
  { slug: "scoping", name: "Project Scoping", kind: "dataset", parentSlugs: ["basin"] },
  { slug: "scoping-a", name: "Archive", kind: "catalog", parentSlugs: ["scoping"] },
  { slug: "dams", name: "Dams", kind: "catalog", parentSlugs: ["basin"] },
  { slug: "nid", name: "NID", kind: "catalog", parentSlugs: ["dams"] },
  { slug: "terrain", name: "Terrain", kind: "catalog", parentSlugs: [] },
  { slug: "base", name: "Terrain Base", kind: "dataset", parentSlugs: ["terrain"] },
  { slug: "conf", name: "Conformance", kind: "catalog", parentSlugs: [] },
  { slug: "conf-storms", name: "Storm Catalog", kind: "catalog", parentSlugs: ["conf"] },
  { slug: "conf-a", name: "Archive", kind: "catalog", parentSlugs: ["conf-storms"] },
  { slug: "orphan", name: "Orphan", kind: "dataset", parentSlugs: ["missing"] },
];
const h = hierarchyOf(tree);
const slugsOf = (list) => Array.from(list, (n) => n.slug);
assert.deepEqual([...h.roots], ["basin", "terrain", "conf", "orphan"]);
assert.equal(h.datasetsBelow("basin"), 2);
assert.equal(h.catalogsBelow("basin"), 1);
assert.equal(h.datasetsBelow("conf"), 0);
assert.equal(h.datasetsBelow("storms"), 0);
assert.equal(h.catalogsBelow("scoping"), 1);
assert.ok(h.isEmpty("conf") && h.isEmpty("dams") && h.isEmpty("scoping-a"));
assert.ok(!h.isEmpty("basin") && !h.isEmpty("storms") && !h.isEmpty("terrain"));
assert.deepEqual(slugsOf(h.childrenOf("basin")), ["dams", "scoping", "storms"]);
assert.deepEqual(Array.from(h.pathOf("conf-a")), ["Conformance", "Storm Catalog"]);
assert.deepEqual(Array.from(h.pathOf("basin")), []);
assert.equal(h.rootCatalogOf("storms").slug, "basin");
assert.equal(h.rootCatalogOf("scoping-a").slug, "basin");
assert.equal(h.rootCatalogOf("basin"), null);
assert.equal(h.rootCatalogOf("orphan"), null);

// Search finds both kinds by title and description, and never brings a
// match's descendants along.
const found = (query) => slugsOf(searchCollections(tree, query));
assert.deepEqual(found(""), []);
assert.deepEqual(found("  "), []);
assert.deepEqual(found("STORM"), ["storms", "conf-storms"]);
assert.deepEqual(found("archive"), ["scoping-a", "conf-a"]);
assert.deepEqual(found("hourly"), ["storms"]);
assert.deepEqual(found("conformance"), ["conf"]);
assert.deepEqual(found("nothing matches"), []);

const cyclic = [
  { slug: "a", name: "A", kind: "catalog", parentSlugs: ["b"] },
  { slug: "b", name: "B", kind: "catalog", parentSlugs: ["a"] },
  { slug: "c", name: "C", kind: "dataset", parentSlugs: ["b"] },
];
const hc = hierarchyOf(cyclic);
assert.equal(hc.roots.size, 3); // Rootless bad links don't hide data.
assert.equal(hc.datasetsBelow("a"), 1);
assert.deepEqual(Array.from(hc.pathOf("c")), ["A", "B"]);
const selfLink = hierarchyOf([{ slug: "self", name: "Self", kind: "catalog", parentSlugs: ["self"] }]);
assert.equal(selfLink.roots.size, 1);
assert.equal(selfLink.datasetsBelow("self"), 0);

// A child link to an older version still parents the latest visible series.
const family = [
  { id: "p", series: { id: "p", latest: "p" }, docHref: "file:///p.json", childCollectionHrefs: ["file:///old.json"] },
  { id: "old", series: { id: "s", latest: "new" }, docHref: "file:///old.json", childCollectionHrefs: [] },
  { id: "new", series: { id: "s", latest: "new" }, docHref: "file:///new.json", childCollectionHrefs: [] },
];
assert.deepEqual(Array.from(collectionParents(family, new Set(["p", "new"])).get("s")), ["p"]);
assert.deepEqual(Array.from(collectionParents(family, new Set(["new"])).get("s")), []); // Failed parent becomes an orphan.
console.log("Catalog hierarchy and search regression checks passed.");

if (process.argv.includes("--live")) {
  const { getCatalog } = load(resolve(root, "catalog.ts"));
  const { treeNodesOf } = load(resolve(root, "collection-hierarchy.ts"));
  const catalog = await getCatalog("dev");
  assert.equal(catalog.errors.length, 0, `Development read with errors: ${catalog.errors.join("; ")}`);
  const nodes = treeNodesOf(catalog.collections).map((n) => ({ ...n, blurb: n.collection.description ?? undefined }));
  const t = hierarchyOf(nodes);
  const datasets = nodes.filter((n) => n.kind === "dataset");
  const byName = (name) => nodes.filter((n) => n.name === name);
  const one = (name) => {
    const [n, ...rest] = byName(name);
    assert.ok(n && !rest.length, `expected one node named ${name}`);
    return n;
  };
  assert.equal(nodes.length, 125);
  assert.equal(datasets.length, 7);
  assert.equal(nodes.length - datasets.length, 118);
  assert.deepEqual(Array.from(datasets, (d) => d.collection.itemCount).sort((a, b) => b - a), [450, 363, 192, 39, 2, 1, 1]);
  // Every dataset has items or assets; no catalog has either.
  assert.ok(datasets.every((d) => d.collection.itemCount > 0 || Object.keys(d.collection.assets).length > 0));
  assert.ok(nodes.every((n) => n.kind === "dataset" || (n.collection.itemCount === 0 && !Object.keys(n.collection.assets).length)));
  const roots = nodes.filter((n) => t.roots.has(n.slug));
  assert.deepEqual(Array.from(roots, (r) => r.name).sort(), ["Basin Data", "Calibration", "Conformance", "Production", "Terrain"]);
  assert.ok(roots.every((r) => r.kind === "catalog"));
  const basin = one("Basin Data");
  assert.equal(t.childrenOf(basin.slug).length, 23);
  assert.equal(t.datasetsBelow(basin.slug), 6);
  assert.equal(t.catalogsBelow(basin.slug), 17);
  assert.equal(t.childrenOf(basin.slug).filter((c) => t.isEmpty(c.slug)).length, 17);
  assert.equal(t.datasetsBelow(one("Terrain").slug), 1);
  for (const name of ["Calibration", "Conformance", "Production"]) assert.ok(t.isEmpty(one(name).slug), `${name} should be empty`);
  // Project Scoping: one item and ten empty catalogs, a dataset.
  const scoping = one("Project Scoping");
  assert.equal(scoping.kind, "dataset");
  assert.equal(scoping.collection.itemCount, 1);
  assert.equal(t.catalogsBelow(scoping.slug), 10);
  assert.ok(t.childrenOf(scoping.slug).every((c) => t.isEmpty(c.slug)));
  for (const d of datasets) assert.ok(t.rootCatalogOf(d.slug), `${d.name} has no root catalog`);
  assert.equal(datasets.filter((d) => t.rootCatalogOf(d.slug).slug === basin.slug).length, 6);
  // Search: "storm" is one dataset and three empty catalogs; "archive" is seven empty catalogs.
  const storm = searchCollections(nodes, "storm");
  assert.equal(storm.filter((n) => n.kind === "dataset").length, 1);
  assert.equal(storm.filter((n) => n.kind === "catalog" && t.isEmpty(n.slug)).length, 3);
  const archive = searchCollections(nodes, "archive");
  assert.equal(archive.filter((n) => n.kind === "dataset").length, 0);
  assert.equal(archive.length, 7);
  assert.equal(new Set(archive.map((n) => n.name)).size, 1);
  // Catalogs at depth 5, with their trail.
  const grids = nodes.find((n) => n.collection.id === "conformance-simulations-frequency-calibration-summary-output-grids");
  assert.ok(grids && grids.kind === "catalog");
  assert.equal(t.pathOf(grids.slug)[0], "Conformance");
  assert.equal(t.catalogsBelow(grids.slug), 3);
  assert.equal(t.datasetsBelow(grids.slug), 0);
  console.log("Development tree checks passed.");
}
