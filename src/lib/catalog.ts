import "server-only";

import { refreshMs, sources as configuredSources } from "./config";
import { ENVS, type EnvKey } from "./env";
import { readEdits } from "./edits";
import { collectionName } from "./format";
import { readItems } from "./parquet";
import { collectionsOf, readCollectionJson, resolveHref } from "./stac-json";
import { VERSION_RELS, type CatalogItem, type Collection, type Provider, type QcEdit, type QcEvent, type StacAsset, type StacItem, type StacLink } from "./stac";
import { awsLooksConfigured, CATALOG_JSON, head, isJsonSource, isS3, listSourceFiles, readJson } from "./storage";
import { groupVersions } from "./versions";

/**
 * The in-memory catalog.
 *
 * Every request wants the same thing: all items from all configured source
 * files, grouped by collection, with each collection's QC record merged in. Parsing a file is
 * milliseconds for hundreds of rows and under a second for a hundred
 * thousand, so the whole thing is held in memory and rebuilt when a file's
 * ETag changes. ETags are checked at most every STAC_REFRESH_SECONDS, so a
 * page view is normally zero calls to S3.
 *
 * Each environment has its own sources and its own cache. The caches hang
 * off globalThis so they survive dev-server hot reloads, which otherwise
 * re-parse every file on every edit to a component.
 */

type SourceState = {
  uri: string;
  etag: string;
  items: StacItem[];
  /** Collection objects embedded in the file's metadata, by id. */
  embedded: Record<string, Record<string, unknown>>;
  editsEtag: string | null;
  /** QC records and history from the sidecar, by collection id. */
  qc: Record<string, QcEdit>;
  history: Record<string, QcEvent[]>;
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
  sources: { uri: string; itemCount: number; collections: string[]; error: string | null }[];
  errors: string[];
  refreshedAt: string;
};

const g = globalThis as unknown as { __stacxEnvs?: Record<EnvKey, Cache> };
const caches: Record<EnvKey, Cache> = (g.__stacxEnvs ??= Object.fromEntries(
  ENVS.map((e) => [e.key, { sources: new Map(), listing: null, docs: new Map(), building: null }]),
) as Record<EnvKey, Cache>);

export async function getCatalog(env: EnvKey): Promise<Catalog> {
  const cache = caches[env];
  // Coalesce concurrent builds: the three server components of a page all
  // ask, and one build serves them.
  if (cache.building) return cache.building;
  cache.building = build(env, cache).finally(() => (cache.building = null));
  return cache.building;
}

export async function getCollection(env: EnvKey, id: string): Promise<Collection | null> {
  const c = await getCatalog(env);
  return c.collections.find((x) => x.id === id) ?? null;
}

export async function getItem(env: EnvKey, collection: string, id: string): Promise<CatalogItem | null> {
  const c = await getCollection(env, collection);
  return c?.items.find((x) => x.id === id) ?? null;
}

/**
 * Called after a write so the next read sees it without waiting for the ETag
 * check: one source after a QC save, or every source (and the listing) after
 * a collection was promoted into the environment.
 */
export function invalidate(env: EnvKey, sourceUri?: string) {
  const cache = caches[env];
  if (sourceUri) {
    const s = cache.sources.get(sourceUri);
    if (s) s.checkedAt = 0;
    return;
  }
  cache.listing = null;
  for (const s of cache.sources.values()) s.checkedAt = 0;
}

async function build(env: EnvKey, cache: Cache): Promise<Catalog> {
  const now = Date.now();
  const listing = await listSources(env, cache, now);
  const uris = listing.uris;
  // A copy: the listing is cached, and source errors are added below.
  const errors = [...listing.errors];

  await Promise.all(uris.map((uri) => refreshSource(cache, uri, now)));
  for (const key of Array.from(cache.sources.keys())) {
    if (!uris.includes(key)) cache.sources.delete(key);
  }

  const byCollection = new Map<string, CatalogItem[]>();
  const sourcesOut: Catalog["sources"] = [];
  for (const uri of uris) {
    const s = cache.sources.get(uri)!;
    sourcesOut.push({ uri, itemCount: s.items.length, collections: Array.from(new Set(s.items.map((i) => i.collection))), error: s.error });
    if (s.error) errors.push(`${uri}: ${s.error}`);
    for (const item of s.items) {
      const list = byCollection.get(item.collection) ?? [];
      list.push({ ...item, source: uri });
      byCollection.set(item.collection, list);
    }
  }

  const collections = await Promise.all(
    Array.from(byCollection.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, items]) => describeCollection(cache, id, items, now)),
  );
  const series = groupVersions(collections);
  for (const c of collections) c.series = series.get(c.id)!;

  return { collections, sources: sourcesOut, errors, refreshedAt: new Date(now).toISOString() };
}

async function listSources(env: EnvKey, cache: Cache, now: number) {
  if (cache.listing && now - cache.listing.at < refreshMs) return cache.listing;
  const uris: string[] = [];
  const errors: string[] = [];
  for (const entry of configuredSources(env)) {
    try {
      for (const uri of await listSourceFiles(entry)) {
        if (!CATALOG_JSON.test(uri)) {
          uris.push(uri);
          continue;
        }
        // A static catalog: each collection it links to is a source.
        const found = await collectionsOf(uri);
        uris.push(...found.collections);
        for (const m of found.missing) {
          errors.push(`${m.href}: ${m.error}`);
          console.error(`stac-x: ${uri} links to ${m.href}, which couldn't be read: ${m.error}`);
        }
      }
    } catch (e) {
      errors.push(`${entry}: ${message(e)}`);
      console.error(`stac-x: listing ${entry} failed:`, e);
    }
  }
  cache.listing = { at: now, uris: Array.from(new Set(uris)), errors };
  return cache.listing;
}

async function refreshSource(cache: Cache, uri: string, now: number) {
  const existing = cache.sources.get(uri);
  if (existing && now - existing.checkedAt < refreshMs) return;
  const state: SourceState = existing ?? {
    uri,
    etag: "",
    items: [],
    embedded: {},
    editsEtag: null,
    qc: {},
    history: {},
    checkedAt: 0,
    error: null,
  };
  try {
    const h = await head(uri);
    if (!h) throw new Error("object not found");
    // No `embedded` means the state was cached before this code read it. A
    // collection's ETag says nothing about its items, so it's re-read on
    // every check; JSON catalogs are small.
    const json = isJsonSource(uri);
    if (json || h.etag !== state.etag || !state.embedded) {
      const read = json ? await readCollectionJson(uri) : await readItems(uri);
      state.items = read.items;
      state.embedded = read.collections;
      state.etag = h.etag;
    }
    const { edits, etag } = await readEdits(uri);
    state.qc = edits.collections;
    state.history = edits.history;
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
 * to one we can read, then from the copy embedded in the parquet file's
 * metadata, and is derived from the items otherwise. The derived form is
 * honest about being derived: fromDocument is false and the page says so.
 */
async function describeCollection(cache: Cache, id: string, items: CatalogItem[], now: number): Promise<Collection> {
  const docHref = items[0]?.links.find((l) => l.rel === "collection")?.href ?? null;
  const read = await collectionDoc(cache, docHref, now);
  const embeddedIn = read ? undefined : items.find((i) => cache.sources.get(i.source)?.embedded?.[id]);
  const doc = read ?? (embeddedIn ? cache.sources.get(embeddedIn.source)!.embedded[id] : null);
  // Relative asset hrefs are relative to the file the metadata came from.
  const docBase = read ? docHref : embeddedIn?.source ?? null;
  const bbox = unionBbox(items);
  const temporal = temporalExtent(items);
  const sources = Array.from(new Set(items.map((i) => i.source)));
  const qc = qcFor(cache, id, sources);
  const history = sources
    .flatMap((uri) => cache.sources.get(uri)?.history[id] ?? [])
    .sort((a, b) => b.at.localeCompare(a.at));

  if (doc) {
    const ext = doc.extent as { spatial?: { bbox?: number[][] }; temporal?: { interval?: (string | null)[][] } } | undefined;
    const docBbox = ext?.spatial?.bbox?.[0];
    const docInterval = ext?.temporal?.interval?.[0];
    const {
      id: _id, title, description, license, keywords, providers, extent: _extent, links,
      stac_version: _v, stac_extensions: _x, type: _t, assets,
      version, deprecated, experimental, ...extra
    } = doc;
    void _id; void _extent; void _v; void _x; void _t;
    return {
      id,
      title: collectionName(typeof title === "string" ? title : null, id),
      sourceTitle: typeof title === "string" && title ? title : null,
      description: typeof description === "string" ? description : null,
      license: typeof license === "string" ? license : null,
      keywords: Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === "string") : [],
      providers: Array.isArray(providers) ? (providers as Provider[]) : [],
      bbox: docBbox && docBbox.length >= 4 ? [docBbox[0], docBbox[1], docBbox[2], docBbox[3]] : bbox,
      temporal: docInterval ? [docInterval[0] ?? null, docInterval[1] ?? null] : temporal,
      itemCount: items.length,
      sources,
      fromDocument: true,
      assets: docAssets(assets, docBase),
      extra,
      version: typeof version === "string" || typeof version === "number" ? String(version) : null,
      deprecated: deprecated === true,
      experimental: experimental === true,
      docHref,
      versionLinks: Array.isArray(links)
        ? (links as StacLink[]).filter((l) => l && typeof l.href === "string" && VERSION_RELS.includes(l.rel))
        : [],
      series: lone(id),
      qc,
      history,
      items,
    };
  }

  return {
    id,
    title: collectionName(null, id),
    sourceTitle: null,
    description: null,
    license: null,
    keywords: [],
    providers: [],
    bbox,
    temporal,
    itemCount: items.length,
    sources,
    fromDocument: false,
    assets: {},
    extra: {},
    version: null,
    deprecated: false,
    experimental: false,
    docHref,
    versionLinks: [],
    series: lone(id),
    qc,
    history,
    items,
  };
}

/** A placeholder until build() groups the versions. */
function lone(id: string): Collection["series"] {
  return { id, latest: id, versions: [] };
}

/** The newest QC record for a collection across the sidecars of its files. */
function qcFor(cache: Cache, id: string, sources: string[]): QcEdit | null {
  let best: QcEdit | null = null;
  for (const uri of sources) {
    const r = cache.sources.get(uri)?.qc[id];
    if (r && (!best || r.updated_at > best.updated_at)) best = r;
  }
  return best;
}

/** A collection's own assets (overview plots, summary tables), with their hrefs made absolute. */
function docAssets(raw: unknown, base: string | null): Record<string, StacAsset> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, StacAsset>)
      .filter(([, a]) => a && typeof a.href === "string")
      .map(([k, a]) => [k, { ...a, href: base ? resolveHref(a.href, base) : a.href }]),
  );
}

async function collectionDoc(cache: Cache, href: string | null, now: number): Promise<CollectionDoc> {
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
