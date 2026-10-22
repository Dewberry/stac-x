import "server-only";

import { readItems } from "./parquet";
import type { StacItem, StacLink } from "./stac";
import { NotFound, parseRef, readJson } from "./storage";

/**
 * A static STAC catalog in, STAC items out.
 *
 * An environment's folder or prefix can hold a catalog.json (or a versioned
 * catalog-v1.json) at its root. The catalog's `child` links are followed,
 * through any sub-catalogs, to collections, whatever their files are called
 * (collection-v1.0.json is fine). Each collection is one source, and its
 * items are the rows of the stac-geoparquet file it links to, as `items` or
 * `alternate`. Every environment reads its catalog this way.
 *
 * A collection that links to one JSON file per item isn't read. Fetching
 * thousands of small files from S3 is what made the old Development catalog
 * slow, and the pipeline writes a parquet file for every collection now.
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
  /** The parquet file the items were read from, and its ETag at the time. */
  parquet: { uri: string; etag: string };
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
    // Siblings are read together; a catalog of a dozen collections is one
    // round trip deep instead of a dozen.
    await Promise.all(
      links.filter((l) => l?.rel === "child" && typeof l.href === "string").map((l) => walk(resolveHref(l.href, uri))),
    );
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
  const parquet = links.find(PARQUET_LINK);
  if (!parquet) {
    throw new Error(
      links.some((l) => l?.rel === "item")
        ? "links to its items as JSON files, which aren't read. Link it to a stac-geoparquet file."
        : "doesn't link to a stac-geoparquet file",
    );
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
