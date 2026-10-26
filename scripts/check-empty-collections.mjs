// Regression checks with isolated, in-memory sources. These never enter the app catalog.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib");
const require = createRequire(import.meta.url);
const files = new Map();
const sidecars = new Map();
let sources = [];
let revision = 0;
const put = (uri, value) => files.set(uri, { value, etag: String(++revision) });
class NotFound extends Error {}
class NotStac extends Error {}
const read = async (uri) => {
  if (!files.has(uri)) throw new NotFound(uri);
  return files.get(uri);
};
const mocks = {
  "server-only": {},
  "./config": { refreshMs: 0, sources: () => sources },
  "./edits": { readEdits: async (uri) => ({ edits: sidecars.get(uri) ?? { collections: {}, history: {} }, etag: null }) },
  "./parquet": {
    NotStac,
    readItems: async (uri) => {
      const { value, etag } = await read(uri);
      return { ...value, etag };
    },
  },
  "./storage": {
    NotFound,
    CATALOG_JSON: /catalog\.json$/,
    isJsonSource: (uri) => uri.endsWith(".json"),
    isS3: () => false,
    awsAvailable: async () => true,
    parseRef: (uri) => ({ uri }),
    head: async (uri) => files.has(uri) ? { etag: files.get(uri).etag } : null,
    readJson: read,
    listSourceFiles: async (uri) => [uri],
  },
};
// Compile the real reader and catalog with storage boundaries stubbed out.
// A separate global object keeps their cache out of the running app.
const context = vm.createContext({ console, URL, globalThis: {} });
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const loaded = { exports: {} };
  modules.set(file, loaded);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    return name.startsWith(".") ? load(resolve(dirname(file), `${name}.ts`)) : require(name);
  };
  vm.runInContext(`(function(require, module, exports) {${outputText}\n})`, context, { filename: file })(localRequire, loaded, loaded.exports);
  return loaded.exports;
}
const { childCollectionsOf, getCatalog, invalidate } = load(resolve(root, "catalog.ts"));
const { collectionsOf, readCollectionJson } = load(resolve(root, "stac-json.ts"));
const uri = "file:///checks/collection.json";
const parquet = "file:///checks/items.parquet";
const doc = {
  type: "Collection", id: "empty", title: "Empty collection", description: "Collection metadata",
  license: "proprietary", links: [],
  extent: { spatial: { bbox: [[-105, 39, -104, 40]] }, temporal: { interval: [[null, null]] } },
  assets: { overview: { href: "overview.png", type: "image/png" } },
};
const qc = { qc: "approved", date_approved: null, updated_at: "2026-01-01T00:00:00Z" };
const event = { kind: "qc", qc: "approved", at: qc.updated_at };
const snapshot = async () => {
  invalidate("dev");
  return getCatalog("dev");
};
put(uri, doc);
sidecars.set(uri, { collections: { empty: qc }, history: { empty: [event] } });
sources = [uri];
assert.equal((await readCollectionJson(uri)).parquet, null);
let catalog = await snapshot();
assert.equal(catalog.errors.length, 0);
assert.equal(catalog.collections.length, 1);
let c = catalog.collections[0];
assert.equal(c.itemCount, 0);
assert.equal(c.childCollectionCount, 0);
assert.equal(childCollectionsOf(c, catalog.collections).length, 0);
assert.equal(c.fromDocument, true);
assert.equal(c.title, "Empty Collection");
assert.equal(c.sourceTitle, doc.title);
assert.equal(c.description, doc.description);
assert.equal(c.license, doc.license);
assert.equal(JSON.stringify(c.bbox), JSON.stringify(doc.extent.spatial.bbox[0]));
assert.equal(c.docHref, uri);
assert.equal(c.assets.overview.href, "file:///checks/overview.png");
assert.equal(c.sources[0], uri);
assert.equal(c.qc, qc);
assert.equal(c.history[0], event);
assert.equal(catalog.sources[0].collections[0], doc.id);

// Discover the same metadata-only collection through a catalog child link.
const catalogUri = "file:///checks/catalog.json";
put(catalogUri, { type: "Catalog", links: [{ rel: "child", href: "collection.json" }] });
sources = [catalogUri];
assert.equal((await snapshot()).collections[0].id, doc.id);

// Nested collections are discovered from a catalog or a collection root.
// Shared children and child-link cycles must not duplicate sources or hang.
const childUri = "file:///checks/child/collection-v01.json";
const grandchildUri = "file:///checks/child/deeper/collection.json";
put(uri, { ...doc, links: [
  { rel: "child", href: "child/collection-v01.json" },
  { rel: "child", href: "./child/collection-v01.json" },
  { rel: "child", href: "collection.json" },
  { rel: "child", href: "child/deeper/collection.json" },
] });
put(childUri, { ...doc, id: "child", links: [{ rel: "child", href: "deeper/collection.json" }] });
put(grandchildUri, { ...doc, id: "grandchild", links: [{ rel: "child", href: "../../collection.json" }] });
for (const rootUri of [catalogUri, uri]) {
  sources = [rootUri];
  catalog = await snapshot();
  assert.equal(catalog.errors.length, 0);
  assert.equal(JSON.stringify(catalog.collections.map((c) => c.id).sort()), JSON.stringify(["child", "empty", "grandchild"]));
  assert.equal(catalog.sources.length, 3);
  assert.ok(catalog.collections.every((c) => c.itemCount === 0 && c.fromDocument));
  assert.equal(catalog.collections.find((c) => c.id === "child").assets.overview.href, "file:///checks/child/overview.png");
  assert.equal(catalog.collections.find((c) => c.id === "empty").childCollectionCount, 2);
  assert.equal(catalog.collections.find((c) => c.id === "child").childCollectionCount, 1);
  for (const parent of catalog.collections) {
    const children = childCollectionsOf(parent, catalog.collections);
    assert.equal(children.length, parent.childCollectionCount);
    assert.ok(children.every((child) => child.id !== parent.id));
  }
  const children = childCollectionsOf(catalog.collections.find((c) => c.id === "empty"), catalog.collections);
  assert.equal(JSON.stringify(children.map((c) => c.id)), JSON.stringify(["child", "grandchild"]));
  assert.equal(JSON.stringify(childCollectionsOf(catalog.collections.find((c) => c.id === "child"), catalog.collections).map((c) => c.id)), JSON.stringify(["grandchild"]));
}

// Unreadable or invalid children report errors without hiding valid siblings.
put("file:///checks/invalid.json", { type: "Feature" });
put(uri, { ...doc, links: [
  { rel: "child", href: "child/collection-v01.json" },
  { rel: "child", href: "missing.json" },
  { rel: "child", href: "invalid.json" },
] });
const nested = await collectionsOf(uri);
assert.equal(nested.collections.length, 3);
assert.equal(nested.missing.length, 2);
assert.ok(nested.missing.some((m) => m.href.endsWith("missing.json") && m.error === "not found"));
assert.ok(nested.missing.some((m) => m.href.endsWith("invalid.json") && m.error === "not a STAC Catalog or Collection"));
catalog = await snapshot();
assert.equal(catalog.collections.length, 3);
assert.equal(catalog.errors.length, 2);
assert.equal(catalog.collections.find((c) => c.id === "empty").childCollectionCount, 1);
assert.equal(JSON.stringify(childCollectionsOf(catalog.collections.find((c) => c.id === "empty"), catalog.collections).map((c) => c.id)), JSON.stringify(["child"]));
put(uri, doc);
sources = [catalogUri];

// A child whose parent is listed but then fails to load (here, the parent's
// parquet link points at nothing) sits at the top of the tree and says so.
// A child linked straight from the catalog the environment starts at doesn't.
{
  const parentUri = "file:///checks/parent/collection.json";
  const orphanUri = "file:///checks/parent/orphan/collection.json";
  put(catalogUri, { type: "Catalog", id: "root", links: [{ rel: "child", href: "parent/collection.json" }, { rel: "child", href: "collection.json" }] });
  put(parentUri, { type: "Collection", id: "parent", description: "d", links: [{ rel: "child", href: "orphan/collection.json" }, { rel: "items", href: "gone.parquet" }] });
  put(orphanUri, { type: "Collection", id: "orphan", description: "d", links: [] });
  const found = await collectionsOf(catalogUri);
  assert.equal(found.parents[orphanUri], parentUri);
  assert.equal(found.parents[parentUri], undefined);
  const snap = await snapshot();
  assert.equal(JSON.stringify(snap.collections.map((c) => c.id).sort()), JSON.stringify(["empty", "orphan"]));
  assert.equal(snap.collections.find((c) => c.id === "orphan").parentMissing, true);
  assert.equal(snap.collections.find((c) => c.id === "empty").parentMissing, false);
  files.delete(parentUri);
  files.delete(orphanUri);
}

// A sub-catalog typed Catalog is still a node of the tree (a catalog, as it
// has no items or assets); the catalog the environment is read from isn't.
const subUri = "file:///checks/sub/catalog.json";
put(catalogUri, { type: "Catalog", id: "root", links: [{ rel: "child", href: "sub/catalog.json" }] });
put(subUri, { type: "Catalog", id: "sub", title: "Sub", description: "A folder", links: [{ rel: "child", href: "../collection.json" }] });
catalog = await snapshot();
assert.equal(catalog.errors.length, 0);
assert.equal(JSON.stringify(catalog.collections.map((c) => c.id).sort()), JSON.stringify(["empty", "sub"]));
const sub = catalog.collections.find((c) => c.id === "sub");
assert.equal(sub.type, "Catalog");
assert.equal(sub.kind, "catalog");
assert.equal(sub.description, "A folder");
assert.equal(JSON.stringify(childCollectionsOf(sub, catalog.collections).map((c) => c.id)), JSON.stringify(["empty"]));
// A metadata-only collection with an asset of its own is a dataset.
assert.equal(catalog.collections.find((c) => c.id === "empty").kind, "dataset");
put(catalogUri, { type: "Catalog", links: [{ rel: "child", href: "collection.json" }] });

// Adding a parquet link and later removing it must refresh without stale items.
put(parquet, { items: [], collections: {} });
put(uri, { ...doc, assets: {}, links: [{ rel: "items", href: "items.parquet" }] });
c = (await snapshot()).collections[0];
assert.equal(c.itemCount, 0);
// A collection that links a data file is a dataset waiting for rows, not a folder.
assert.equal(c.itemsLinked, true);
assert.equal(c.kind, "dataset");
put(uri, { ...doc, links: [{ rel: "items", href: "items.parquet" }] });
put(parquet, { items: [{ id: "one", collection: "old-id", properties: {}, links: [], assets: {}, geometry: null, bbox: null }], collections: {} });
c = (await snapshot()).collections[0];
assert.equal(c.itemCount, 1);
assert.equal(c.items[0].collection, doc.id);
put(uri, doc);
assert.equal((await snapshot()).collections[0].itemCount, 0);

// Zero rows in a direct parquet source still retain its embedded collection.
put(parquet, { items: [], collections: { empty: doc } });
sources = [parquet];
c = (await snapshot()).collections[0];
assert.equal(c.itemCount, 0);
assert.equal(c.fromDocument, true);
assert.equal(c.sources[0], parquet);
assert.equal(c.assets.overview.href, "file:///checks/overview.png");

// Missing referenced files aren't empty collections, whether the link is to
// a JSON item, an ItemCollection or a parquet file.
for (const rel of ["item", "items"]) {
  put(uri, { ...doc, links: [{ rel, href: "item.json" }] });
  await assert.rejects(readCollectionJson(uri), NotFound);
}
put(uri, { ...doc, links: [{ rel: "items", href: "missing.parquet" }] });
await assert.rejects(readCollectionJson(uri), NotFound);
sources = [uri];
catalog = await snapshot();
assert.equal(catalog.collections.length, 0);
assert.equal(catalog.errors.length, 1);
console.log("Empty collection regression checks passed.");

// Shared labels preserve namespace identity, casing, and existing overrides.
const { humanize } = load(resolve(root, "format.ts"));
for (const [key, expected] of [
  ["ffrd:foobar", "FFRD: Foobar"],
  ["FfRd:foo_bar", "FFRD: Foo bar"],
  ["custom-v2:some_field", "CUSTOM-V2: Some field"],
  ["proj:epsg", "PROJ: EPSG"],
  ["file:values", "FILE: Values"],
  ["ffrd:date_approved", "FFRD: Date approved"],
  ["ffrd", "FFRD"],
  ["drain_area_va", "Drainage area (mi²)"],
  ["stac_version", "STAC version"],
  ["", ""],
]) assert.equal(humanize(key), expected, key);
console.log("Property label regression checks passed.");
