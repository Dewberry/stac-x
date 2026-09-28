import "server-only";

import { refreshMs, sources as configuredSources } from "./config";
import { editKey, readEdits } from "./edits";
import { readItems } from "./parquet";
import type { CatalogItem, Collection, Provider, StacItem } from "./stac";
import { awsLooksConfigured, head, isS3, listParquet, readJson } from "./storage";

/**
 * The in-memory catalog.
 *
 * Every request wants the same thing: all items from all configured parquet
 * files, with edits merged in, grouped by collection. Parsing a file is
 * milliseconds for hundreds of rows and under a second for a hundred
 * thousand, so the whole thing is held in memory and rebuilt when a file's
 * ETag changes. ETags are checked at most every STAC_REFRESH_SECONDS, so a
 * page view is normally zero calls to S3.
 *
 * The cache hangs off globalThis so it survives dev-server hot reloads, which
 * otherwise re-parse every file on every edit to a component.
 */

type SourceState = {
  uri: string;
  etag: string;
  items: StacItem[];
  editsEtag: string | null;
  edits: Record<string, CatalogItem["edit"]>;
  checkedAt: number;
  error: string | null;
};

type CollectionDoc = Record<string, unknown> | null;

type Cache = {
  sources: Map<string, SourceState>;
  listing: { at: number; uris: string[]; errors: string[] } | null;
  docs: Map<string, { at: number; doc: CollectionDoc }>;
  building: Promise<Catalog> | null;
};

export type Catalog = {
  collections: Collection[];
  sources: { uri: string; itemCount: number; error: string | null }[];
  errors: string[];
  refreshedAt: string;
};

const g = globalThis as unknown as { __stacx?: Cache };
const cache: Cache = (g.__stacx ??= { sources: new Map(), listing: null, docs: new Map(), building: null });

export async function getCatalog(): Promise<Catalog> {
  // Coalesce concurrent builds: the three server components of a page all
  // ask, and one build serves them.
  if (cache.building) return cache.building;
  cache.building = build().finally(() => (cache.building = null));
  return cache.building;
}

export async function getCollection(id: string): Promise<Collection | null> {
  const c = await getCatalog();
  return c.collections.find((x) => x.id === id) ?? null;
}

export async function getItem(collection: string, id: string): Promise<CatalogItem | null> {
  const c = await getCollection(collection);
  return c?.items.find((x) => x.id === id) ?? null;
}

/** Called after a write so the next read sees it without waiting for the ETag check. */
export function invalidateEdits(sourceUri: string) {
  const s = cache.sources.get(sourceUri);
  if (s) s.checkedAt = 0;
}

async function build(): Promise<Catalog> {
  const now = Date.now();
  const listing = await listSources(now);
  const uris = listing.uris;
  // A copy: the listing is cached, and source errors are added below.
  const errors = [...listing.errors];

  await Promise.all(uris.map((uri) => refreshSource(uri, now)));
  for (const key of Array.from(cache.sources.keys())) {
    if (!uris.includes(key)) cache.sources.delete(key);
  }

  const byCollection = new Map<string, CatalogItem[]>();
  const sourcesOut: Catalog["sources"] = [];
  for (const uri of uris) {
    const s = cache.sources.get(uri)!;
    sourcesOut.push({ uri, itemCount: s.items.length, error: s.error });
    if (s.error) errors.push(`${uri}: ${s.error}`);
    for (const item of s.items) {
      const list = byCollection.get(item.collection) ?? [];
      list.push({ ...item, source: uri, edit: s.edits[editKey(item.collection, item.id)] ?? null });
      byCollection.set(item.collection, list);
    }
  }

  const collections = await Promise.all(
    Array.from(byCollection.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, items]) => describeCollection(id, items, now)),
  );

  return { collections, sources: sourcesOut, errors, refreshedAt: new Date(now).toISOString() };
}

async function listSources(now: number) {
  if (cache.listing && now - cache.listing.at < refreshMs) return cache.listing;
  const uris: string[] = [];
  const errors: string[] = [];
  for (const entry of configuredSources()) {
    try {
      uris.push(...(await listParquet(entry)));
    } catch (e) {
      errors.push(`${entry}: ${message(e)}`);
      console.error(`stac-x: listing ${entry} failed:`, e);
    }
  }
  cache.listing = { at: now, uris: Array.from(new Set(uris)), errors };
  return cache.listing;
}

async function refreshSource(uri: string, now: number) {
  const existing = cache.sources.get(uri);
  if (existing && now - existing.checkedAt < refreshMs) return;
  const state: SourceState = existing ?? {
    uri,
    etag: "",
    items: [],
    editsEtag: null,
    edits: {},
    checkedAt: 0,
    error: null,
  };
  try {
    const h = await head(uri);
    if (!h) throw new Error("object not found");
    if (h.etag !== state.etag) {
      state.items = await readItems(uri);
      state.etag = h.etag;
    }
    const { edits, etag } = await readEdits(uri);
    state.edits = edits.items;
    state.editsEtag = etag;
    state.error = null;
  } catch (e) {
    state.error = message(e);
    console.error(`stac-x: reading ${uri} failed:`, e);
  }
  state.checkedAt = now;
  cache.sources.set(uri, state);
}

/**
 * A collection's metadata comes from its collection.json when the items link
 * to one we can read, and is derived from the items otherwise. The derived
 * form is honest about being derived: fromDocument is false and the page
 * says so.
 */
async function describeCollection(id: string, items: CatalogItem[], now: number): Promise<Collection> {
  const doc = await collectionDoc(items, now);
  const bbox = unionBbox(items);
  const temporal = temporalExtent(items);
  const sources = Array.from(new Set(items.map((i) => i.source)));

  if (doc) {
    const ext = doc.extent as { spatial?: { bbox?: number[][] }; temporal?: { interval?: (string | null)[][] } } | undefined;
    const docBbox = ext?.spatial?.bbox?.[0];
    const docInterval = ext?.temporal?.interval?.[0];
    const {
      id: _id, title, description, license, keywords, providers, extent: _extent, links: _links,
      stac_version: _v, stac_extensions: _x, type: _t, assets: _assets, ...extra
    } = doc;
    void _id; void _extent; void _links; void _v; void _x; void _t; void _assets;
    return {
      id,
      title: typeof title === "string" && title ? title : id,
      description: typeof description === "string" ? description : null,
      license: typeof license === "string" ? license : null,
      keywords: Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === "string") : [],
      providers: Array.isArray(providers) ? (providers as Provider[]) : [],
      bbox: docBbox && docBbox.length >= 4 ? [docBbox[0], docBbox[1], docBbox[2], docBbox[3]] : bbox,
      temporal: docInterval ? [docInterval[0] ?? null, docInterval[1] ?? null] : temporal,
      itemCount: items.length,
      sources,
      fromDocument: true,
      extra,
      items,
    };
  }

  return {
    id,
    title: id,
    description: null,
    license: null,
    keywords: [],
    providers: [],
    bbox,
    temporal,
    itemCount: items.length,
    sources,
    fromDocument: false,
    extra: {},
    items,
  };
}

async function collectionDoc(items: CatalogItem[], now: number): Promise<CollectionDoc> {
  const href = items[0]?.links.find((l) => l.rel === "collection")?.href;
  if (!href) return null;
  if (isS3(href) && !awsLooksConfigured()) return null;
  const hit = cache.docs.get(href);
  if (hit && now - hit.at < refreshMs * 10) return hit.doc;
  let doc: CollectionDoc = null;
  try {
    const { value } = await readJson<Record<string, unknown>>(href);
    if (value && value.type === "Collection") doc = value;
  } catch {
    doc = null;
  }
  cache.docs.set(href, { at: now, doc });
  return doc;
}

export function unionBbox(items: { bbox: StacItem["bbox"] }[]): Collection["bbox"] {
  let out: [number, number, number, number] | null = null;
  for (const { bbox } of items) {
    if (!bbox) continue;
    if (!out) out = [...bbox];
    else {
      out[0] = Math.min(out[0], bbox[0]);
      out[1] = Math.min(out[1], bbox[1]);
      out[2] = Math.max(out[2], bbox[2]);
      out[3] = Math.max(out[3], bbox[3]);
    }
  }
  return out;
}

function temporalExtent(items: CatalogItem[]): [string | null, string | null] {
  let lo: string | null = null;
  let hi: string | null = null;
  for (const { properties: p } of items) {
    const start = str(p.start_datetime) ?? str(p.datetime);
    const end = str(p.end_datetime) ?? str(p.datetime);
    if (start && (!lo || start < lo)) lo = start;
    if (end && (!hi || end > hi)) hi = end;
  }
  return [lo, hi];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
