import "server-only";

import { readItems } from "./parquet";
import type { StacAsset, StacItem, StacLink } from "./stac";
import { NotFound, parseRef, readJson } from "./storage";

/**
 * A static STAC catalog in, STAC items out.
 *
 * An environment's folder or prefix can hold a catalog.json at its root.
 * The catalog's `child` links are followed, through any sub-catalogs, to
 * collections, whatever their files are called (collection-v1.0.json is
 * fine). Each collection is one source. Its items are the ones its `item`
 * links point at (the Development catalog), or, when it has none, the rows
 * of the stac-geoparquet file it links to as an `alternate` (the Test
 * catalog). Hrefs in a static catalog are usually relative, so every link
 * and asset href is resolved against the file it came from; after that the
 * rest of the app treats these items exactly like ones read from parquet.
 */

/** A link to a parquet file, by its media type or its extension. */
const PARQUET_LINK = (l: StacLink) =>
  typeof l?.href === "string" &&
  l.rel !== "self" &&
  (/parquet/i.test(l.type ?? "") || /\.(geo)?parquet$|\.pq$/i.test(l.href));

export type JsonStac = {
  items: StacItem[];
  collections: Record<string, Record<string, unknown>>;
};

/**
 * Every collection a catalog reaches through its child links. A child that
 * can't be read is reported rather than dropped, so a catalog pointing at
 * files that haven't been uploaded says so on the page.
 */
export async function collectionsOf(
  catalogUri: string,
): Promise<{ collections: string[]; missing: { href: string; error: string }[] }> {
  const collections: string[] = [];
  const missing: { href: string; error: string }[] = [];
  const seen = new Set<string>();
  const walk = async (uri: string) => {
    if (seen.has(uri)) return;
    seen.add(uri);
    let doc: Record<string, unknown>;
    try {
      doc = (await readJson<Record<string, unknown>>(uri)).value;
    } catch (e) {
      missing.push({ href: uri, error: e instanceof NotFound ? "not found" : e instanceof Error ? e.message : String(e) });
      return;
    }
    if (doc?.type === "Collection") {
      collections.push(uri);
      return;
    }
    if (doc?.type !== "Catalog") {
      missing.push({ href: uri, error: "not a STAC Catalog or Collection" });
      return;
    }
    const links = Array.isArray(doc.links) ? (doc.links as StacLink[]) : [];
    for (const l of links) {
      if (l?.rel === "child" && typeof l.href === "string") await walk(resolveHref(l.href, uri));
    }
  };
  await walk(parseRef(catalogUri).uri);
  return { collections, missing };
}

export async function readCollectionJson(uri: string): Promise<JsonStac> {
  const { value: doc } = await readJson<Record<string, unknown>>(uri);
  if (!doc || doc.type !== "Collection" || typeof doc.id !== "string") {
    throw new Error("not a STAC Collection");
  }
  const id = doc.id;
  const links = Array.isArray(doc.links) ? (doc.links as StacLink[]) : [];
  const hrefs = links.filter((l) => l?.rel === "item" && typeof l.href === "string").map((l) => resolveHref(l.href, uri));
  if (hrefs.length) {
    const items = await Promise.all(
      hrefs.map(async (href) => {
        const { value } = await readJson<Record<string, unknown>>(href);
        return toItem(value, href, id);
      }),
    );
    return { items, collections: { [id]: doc } };
  }
  // No item links: the items are the rows of the parquet file the collection
  // links to. The file is this collection's, whatever its rows say: the
  // portable catalog's rows carry the ids they had before they were
  // packaged (or none), and their collection links are relative to item
  // files that aren't in this catalog. So each item gets this collection's
  // id and a collection link to this file, which is also what the version
  // grouping keys on; the rest of its links are left as written.
  const parquet = links.find(PARQUET_LINK);
  if (!parquet) return { items: [], collections: { [id]: doc } };
  const read = await readItems(resolveHref(parquet.href, uri));
  const own: StacLink = { rel: "collection", href: uri, type: "application/json" };
  return {
    items: read.items.map((item) => ({
      ...item,
      collection: id,
      links: [own, ...item.links.filter((l) => l.rel !== "collection" && l.rel !== "parent")],
    })),
    collections: { ...read.collections, [id]: doc },
  };
}

function toItem(raw: Record<string, unknown>, uri: string, collection: string): StacItem {
  if (!raw || raw.type !== "Feature" || typeof raw.id !== "string") throw new Error(`${uri} is not a STAC Item`);
  const links = Array.isArray(raw.links) ? (raw.links as StacLink[]) : [];
  const assets = raw.assets && typeof raw.assets === "object" ? (raw.assets as Record<string, StacAsset>) : {};
  const bbox = Array.isArray(raw.bbox) && raw.bbox.length >= 4 ? (raw.bbox as number[]) : null;
  return {
    type: "Feature",
    stac_version: typeof raw.stac_version === "string" ? raw.stac_version : "1.0.0",
    stac_extensions: Array.isArray(raw.stac_extensions) ? (raw.stac_extensions as string[]) : [],
    id: raw.id,
    collection: typeof raw.collection === "string" ? raw.collection : collection,
    geometry: (raw.geometry as StacItem["geometry"]) ?? null,
    bbox: bbox ? [bbox[0], bbox[1], bbox[2], bbox[3]] : null,
    properties: raw.properties && typeof raw.properties === "object" ? (raw.properties as Record<string, unknown>) : {},
    links: links.filter((l) => l && typeof l.href === "string").map((l) => ({ ...l, href: resolveHref(l.href, uri) })),
    assets: Object.fromEntries(
      Object.entries(assets)
        .filter(([, a]) => a && typeof a.href === "string")
        .map(([k, a]) => [k, { ...a, href: resolveHref(a.href, uri) }]),
    ),
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
  const path = decodeURIComponent(new URL(href, `http://x/${m[2].replace(/^\/+/, "")}`).pathname);
  return m[1] === "file" ? `file://${path}` : `s3:/${path}`;
}
