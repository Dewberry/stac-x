import "server-only";

import { readItems, toGeometry } from "./parquet";
import type { StacAsset, StacItem, StacLink } from "./stac";
import { head, NotFound, parseRef, readJson } from "./storage";

/**
 * A static STAC catalog in, STAC items out.
 *
 * An environment's folder or prefix can hold a catalog.json (or a versioned
 * catalog-v1.json) at its root. The catalog's `child` links are followed,
 * through sub-catalogs and parent collections, whatever their files are called
 * (collection-v1.0.json is fine). Each collection is one source, and its
 * items come from its linked stac-geoparquet file, individual JSON `item`
 * links, or JSON ItemCollections linked as `items` (including next pages).
 * GeoParquet is preferred when both representations exist. Without links, it has no
 * items, keeping its metadata and collection assets.
 *
 * JSON reads and freshness checks are bounded to eight files at a time.
 * Every linked file's ETag is tracked so item-only updates are picked up.
 * Hrefs in a static catalog are usually relative, so every link and asset
 * href is resolved against the file it came from; after that the rest of
 * the app treats these items exactly like ones read from parquet directly.
 */

/** A link to a parquet file, by its media type or its extension. */
const PARQUET_LINK = (l: StacLink) =>
  typeof l?.href === "string" &&
  l.rel !== "self" &&
  (/parquet/i.test(l.type ?? "") || /\.(geo)?parquet$|\.pq$/i.test(l.href));

export type JsonStac = {
  items: StacItem[];
  collections: Record<string, Record<string, unknown>>;
  /** The parquet file and its ETag, or null for JSON items or metadata only. */
  parquet: { uri: string; etag: string } | null;
  dependencies: { uri: string; etag: string }[];
};

/** Keep a large static catalog from opening thousands of S3 requests at once. */
async function inBatches<T, R>(values: T[], read: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < values.length; i += 8) {
    results.push(...await Promise.all(values.slice(i, i + 8).map(read)));
  }
  return results;
}

export async function jsonItemsChanged(dependencies: JsonStac["dependencies"]): Promise<boolean> {
  const changed = await inBatches(dependencies, async (file) => (await head(file.uri))?.etag !== file.etag);
  return changed.some(Boolean);
}

function linksOf(doc: Record<string, unknown>): StacLink[] {
  return Array.isArray(doc.links)
    ? doc.links.filter((link): link is StacLink => !!link && typeof link.href === "string" && typeof link.rel === "string")
    : [];
}

function jsonItem(value: unknown, base: string, collection: string, collectionUri: string): StacItem {
  const doc = value as Record<string, unknown> | null;
  if (!doc || doc.type !== "Feature" || typeof doc.id !== "string" || !doc.id ||
      !doc.properties || typeof doc.properties !== "object" || Array.isArray(doc.properties)) {
    throw new Error(`${base}: not a STAC Item (expected a Feature with a string id and properties)`);
  }
  const assets: Record<string, StacAsset> = {};
  for (const [key, value] of Object.entries(doc.assets ?? {})) {
    const asset = value as StacAsset | null;
    if (!asset || typeof asset.href !== "string") throw new Error(`${base}: asset ${key} has no href`);
    assets[key] = { ...asset, href: resolveHref(asset.href, base) };
  }
  const geometry = toGeometry(doc.geometry);
  const box = doc.bbox;
  const bbox = Array.isArray(box) && (box.length === 4 || box.length === 6) && box.every(Number.isFinite)
    ? (box.length === 6 ? [box[0], box[1], box[3], box[4]] : box) as StacItem["bbox"] : null;
  return {
    ...doc,
    type: "Feature",
    id: doc.id,
    stac_version: typeof doc.stac_version === "string" ? doc.stac_version : "1.0.0",
    stac_extensions: Array.isArray(doc.stac_extensions) ? doc.stac_extensions.filter((v): v is string => typeof v === "string") : [],
    collection,
    properties: doc.properties as Record<string, unknown>,
    geometry: geometry.value,
    ...(geometry.error ? { geometryError: geometry.error } : {}),
    bbox,
    assets,
    links: [
      { rel: "collection", href: collectionUri, type: "application/json" },
      ...linksOf(doc).filter((l) => l.rel !== "collection" && l.rel !== "parent")
        .map((l) => ({ ...l, href: resolveHref(l.href, base) })),
    ],
  };
}

/** Follow item links and ItemCollection pages, never following parent or child links. */
async function readJsonItems(links: StacLink[], collection: string, uri: string) {
  const items = new Map<string, StacItem>();
  const dependencies: JsonStac["dependencies"] = [];
  const seen = new Set<string>();
  let pending = links.filter((l) => l.rel === "item" || l.rel === "items").map((l) => resolveHref(l.href, uri));
  while (pending.length) {
    const batch = [...new Set(pending)].filter((href) => !seen.has(href));
    batch.forEach((href) => seen.add(href));
    pending = [];
    const docs = await inBatches(batch, async (href) => ({ href, ...await readJson<Record<string, unknown>>(href) }));
    for (const { href, value: doc, etag } of docs) {
      dependencies.push({ uri: href, etag });
      if (!doc || (doc.type !== "Feature" && doc.type !== "FeatureCollection")) {
        throw new Error(`${href}: not a STAC Item or ItemCollection`);
      }
      if (doc.type === "FeatureCollection" && !Array.isArray(doc.features)) {
        throw new Error(`${href}: ItemCollection has no features array`);
      }
      for (const feature of doc.type === "Feature" ? [doc] : doc.features as unknown[]) {
        const item = jsonItem(feature, href, collection, uri);
        if (!items.has(item.id)) items.set(item.id, item);
      }
      if (doc.type === "FeatureCollection") {
        pending.push(...linksOf(doc).filter((l) => l.rel === "next").map((l) => resolveHref(l.href, href)));
      }
    }
  }
  return { items: [...items.values()], dependencies };
}

/**
 * Every collection and sub-catalog a catalog reaches through its child
 * links; the catalog it starts from isn't one of them. A sub-catalog is a
 * node of the tree like a collection (a folder, lib/collection-hierarchy.ts),
 * so a generator that types its containers as Catalog keeps its folders. A
 * child that can't be read is reported rather than dropped, so a catalog
 * pointing at files that haven't been uploaded says so on the page. For a
 * collection reached through another collection's child link, `parents`
 * names that collection's file (the first one found), so the tree can tell
 * a node that's top-level by design from one whose parent didn't load.
 */
export async function collectionsOf(
  catalogUri: string,
): Promise<{ collections: string[]; parents: Record<string, string>; missing: { href: string; error: string }[] }> {
  const collections: string[] = [];
  const parents: Record<string, string> = {};
  const missing: { href: string; error: string }[] = [];
  const seen = new Set<string>();
  const start = parseRef(catalogUri).uri;
  const walk = async (uri: string, from: string | null) => {
    if (seen.has(uri)) return;
    seen.add(uri);
    if (from && from !== start) parents[uri] = from;
    let doc: Record<string, unknown>;
    try {
      doc = (await readJson<Record<string, unknown>>(uri)).value;
    } catch (e) {
      missing.push({ href: uri, error: e instanceof NotFound ? "not found" : e instanceof Error ? e.message : String(e) });
      return;
    }
    if (doc?.type === "Collection" || (doc?.type === "Catalog" && uri !== start)) {
      collections.push(uri);
    } else if (doc?.type !== "Catalog") {
      missing.push({ href: uri, error: "not a STAC Catalog or Collection" });
      return;
    }
    const links = Array.isArray(doc.links) ? (doc.links as StacLink[]) : [];
    // Collections can have children too. Keep the parent as a source and
    // follow its children; the seen set handles shared children and cycles.
    // Siblings are read together; a catalog of a dozen collections is one
    // round trip deep instead of a dozen.
    await Promise.all(
      links.filter((l) => l?.rel === "child" && typeof l.href === "string").map((l) => walk(resolveHref(l.href, uri), uri)),
    );
  };
  await walk(start, null);
  return { collections, parents, missing };
}

export async function readCollectionJson(uri: string): Promise<JsonStac> {
  uri = parseRef(uri).uri;
  const { value: doc } = await readJson<Record<string, unknown>>(uri);
  if (!doc || (doc.type !== "Collection" && doc.type !== "Catalog") || typeof doc.id !== "string") {
    throw new Error("not a STAC Collection or Catalog");
  }
  const id = doc.id;
  // A sub-catalog is metadata and child links; its items, if it has any
  // links to them, aren't read, since a catalog has no data of its own.
  if (doc.type === "Catalog") return { items: [], collections: { [id]: doc }, parquet: null, dependencies: [] };
  const links = linksOf(doc);
  const parquet = links.find(PARQUET_LINK);
  if (!parquet) {
    const read = await readJsonItems(links, id, uri);
    return { ...read, collections: { [id]: doc }, parquet: null };
  }
  // The file is this collection's, whatever its rows say: the rows carry
  // the ids they had before they were packaged (or none), and their
  // collection links are relative to item files that aren't in this
  // catalog. So each item gets this collection's id and a collection link
  // to this file, which is also what the version grouping keys on; the rest
  // of its links are left as written.
  const href = resolveHref(parquet.href, uri);
  const read = await readItems(href);
  const own: StacLink = { rel: "collection", href: uri, type: "application/json" };
  return {
    items: read.items.map((item) => ({
      ...item,
      collection: id,
      links: [own, ...item.links.filter((l) => l.rel !== "collection" && l.rel !== "parent")],
    })),
    collections: { ...read.collections, [id]: doc },
    parquet: { uri: href, etag: read.etag },
    dependencies: [],
  };
}

/**
 * An href relative to the file it's in, made absolute: s3:// stays s3://,
 * a local file stays file://, and anything with its own scheme is left alone.
 */
export function resolveHref(href: string, base: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  const m = /^(s3|file):\/\/(.*)$/.exec(base);
  if (!m) return href;
  // The URL parser does the ../ arithmetic; any scheme with a path works.
  const encoded = new URL(href, `http://x/${m[2].replace(/^\/+/, "")}`).pathname;
  let path: string;
  try {
    path = decodeURIComponent(encoded);
  } catch {
    // A stray % in the href. Kept as written rather than failing the collection.
    path = encoded;
  }
  return m[1] === "file" ? `file://${path}` : `s3:/${path}`;
}
