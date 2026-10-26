import "server-only";

import { refreshMs, sources as configuredSources } from "./config";
import { ENVS, type EnvKey } from "./env";
import { readEdits } from "./edits";
import { kindOf } from "./collection-hierarchy";
import { collectionName } from "./format";
import { NotStac, readItems } from "./parquet";
import { collectionsOf, jsonItemsChanged, readCollectionJson, resolveHref, type JsonStac } from "./stac-json";
import { VERSION_RELS, type CatalogItem, type Collection, type Provider, type QcEdit, type QcEvent, type StacAsset, type StacItem, type StacLink } from "./stac";
import { awsAvailable, head, isJsonSource, isS3, listSourceFiles, readJson } from "./storage";
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
 * Once an environment has been read, a page never waits on S3: it gets the
 * catalog as it stood and the check runs behind it, so the next page gets
 * whatever changed. Only the first read after the server starts waits, and
 * the first after this app writes something, so a QC save shows at once.
 * instrumentation.ts starts that first read when the server boots.
 *
 * Each environment has its own sources and its own cache. The caches hang
 * off globalThis so they survive dev-server hot reloads, which otherwise
 * re-parse every file on every edit to a component.
 */

type SourceState = {
  uri: string;
  /** For a catalog's collection.json, its ETag and its parquet file's, joined. */
  etag: string;
  /** The parquet file a collection.json's items come from. */
  parquet: string | null;
  /** JSON item files and pages, absent on caches from before JSON item support. */
  dependencies?: JsonStac["dependencies"];
  items: StacItem[];
  /** Collection objects embedded in the file's metadata, by id. */
  embedded: Record<string, Record<string, unknown>>;
  editsEtag: string | null;
  /** QC records and history from the sidecar, by collection id. */
  qc: Record<string, QcEdit>;
  history: Record<string, QcEvent[]>;
  checkedAt: number;
  error: string | null;
  /** A parquet file under a listed prefix that turned out not to be stac-geoparquet, left out of the catalog. */
  skipped?: boolean;
};

type CollectionDoc = Record<string, unknown> | null;

type Cache = {
  sources: Map<string, SourceState>;
  /** The source files, and for each one reached through a collection's child link, that collection's file. */
  listing: { at: number; uris: string[]; parents: Record<string, string>; errors: string[] } | null;
  docs: Map<string, { at: number; doc: CollectionDoc }>;
  building: Promise<Catalog> | null;
  /** The last catalog built, served while the next one is checked. Null until the first build and after a write. */
  last?: Catalog | null;
  /** Bumped by every write, so a build that started before it can't be served after it. */
  generation?: number;
};

export type Catalog = {
  collections: Collection[];
  sources: { uri: string; itemCount: number; collections: string[]; error: string | null }[];
  errors: string[];
  refreshedAt: string;
};

// Kept on globalThis so hot reload doesn't drop it. An environment added
// while the server runs gets its entry here, since the object outlives the code.
const g = globalThis as unknown as { __stacxEnvs?: Partial<Record<EnvKey, Cache>> };
const kept = (g.__stacxEnvs ??= {});
for (const e of ENVS) kept[e.key] ??= { sources: new Map(), listing: null, docs: new Map(), building: null };
const caches = kept as Record<EnvKey, Cache>;

export async function getCatalog(env: EnvKey): Promise<Catalog> {
  const cache = caches[env];
  // Coalesce concurrent builds: the three server components of a page all
  // ask, and one build serves them.
  if (!cache.building) {
    const generation = cache.generation ?? 0;
    const pending: Promise<Catalog> = build(env, cache)
      .then((catalog) => {
        if ((cache.generation ?? 0) === generation) cache.last = catalog;
        return catalog;
      })
      .finally(() => {
        if (cache.building === pending) cache.building = null;
      });
    cache.building = pending;
  }
  if (!cache.last) return cache.building;
  // Served from memory; a failed check is already logged per source.
  cache.building.catch(() => {});
  return cache.last;
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
 * Whether some environment's catalog has an asset with exactly this href.
 * The asset and preview routes sign and read with the server's credentials,
 * so they only take hrefs the catalog hands out, never one a caller made up.
 */
export async function isCatalogAsset(href: string): Promise<boolean> {
  const has = (assets: Record<string, StacAsset>) => Object.values(assets).some((a) => a.href === href);
  for (const e of ENVS) {
    const { collections } = await getCatalog(e.key);
    if (collections.some((c) => has(c.assets) || c.items.some((i) => has(i.assets)))) return true;
  }
  return false;
}

/**
 * Called after a write so the next read sees it without waiting for the ETag
 * check: one source after a QC save, or every source (and the listing) after
 * a collection was promoted into the environment.
 */
export function invalidate(env: EnvKey, sourceUri?: string) {
  const cache = caches[env];
  // The next read waits for a build that sees the write, rather than one
  // already under way that might not.
  cache.generation = (cache.generation ?? 0) + 1;
  cache.last = null;
  cache.building = null;
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
  const collectionSources = new Map<string, string[]>();
  const sourcesOut: Catalog["sources"] = [];
  for (const uri of uris) {
    const s = cache.sources.get(uri)!;
    if (s.skipped) continue;
    // Documents name real collections even when there are no item rows.
    const ids = new Set([
      ...s.items.map((i) => i.collection),
      ...Object.entries(s.embedded).filter(([id, doc]) => (doc.type === "Collection" || doc.type === "Catalog") && doc.id === id).map(([id]) => id),
    ]);
    sourcesOut.push({ uri, itemCount: s.items.length, collections: Array.from(ids), error: s.error });
    for (const id of ids) {
      if (!byCollection.has(id)) byCollection.set(id, []);
      const sources = collectionSources.get(id) ?? [];
      sources.push(uri);
      collectionSources.set(id, sources);
    }
    if (s.error) errors.push(`${uri}: ${s.error}`);
    for (const item of s.items) {
      const list = byCollection.get(item.collection) ?? [];
      list.push({ ...item, source: uri });
      byCollection.set(item.collection, list);
    }
  }

  // One collection with metadata the code can't make sense of (a link
  // that isn't an object, an href that won't decode) is left out, not the
  // whole catalog. It falls back to being described from its items, and
  // is dropped only when even that fails.
  const collections: Collection[] = [];
  for (const [id, items] of Array.from(byCollection.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const sources = collectionSources.get(id)!;
    try {
      collections.push(await describeCollection(cache, id, items, sources, now));
    } catch (e) {
      console.error(`stac-x: describing collection ${id} failed, so it's shown from its items:`, e);
      try {
        collections.push(derivedCollection(cache, id, items, sources));
      } catch (e2) {
        errors.push(`${id}: ${message(e2)}`);
        console.error(`stac-x: collection ${id} couldn't be read at all, so it's left out:`, e2);
      }
    }
  }
  // Count the same loaded children the collection page can link to, and
  // note a node whose parent document was listed but never became a node,
  // so it sits at the top of the tree for now.
  const loadedHrefs = new Set(collections.map((c) => c.docHref).filter((h): h is string => !!h));
  for (const c of collections) {
    c.childCollectionCount = childCollectionsOf(c, collections).length;
    c.kind = kindOf(c);
    const parent = c.docHref ? listing.parents[c.docHref] : undefined;
    c.parentMissing = !!parent && !loadedHrefs.has(parent);
  }
  try {
    const series = groupVersions(collections);
    for (const c of collections) c.series = series.get(c.id)!;
  } catch (e) {
    // Every collection stands alone rather than none showing.
    errors.push(`grouping versions: ${message(e)}`);
    console.error("stac-x: grouping collection versions failed, so each is shown on its own:", e);
    for (const c of collections) c.series = lone(c.id);
  }

  return { collections, sources: sourcesOut, errors, refreshedAt: new Date(now).toISOString() };
}

async function listSources(env: EnvKey, cache: Cache, now: number) {
  if (cache.listing && now - cache.listing.at < refreshMs) return cache.listing;
  const uris: string[] = [];
  const parents: Record<string, string> = {};
  const errors: string[] = [];
  for (const entry of configuredSources(env)) {
    try {
      for (const uri of await listSourceFiles(entry)) {
        if (!isJsonSource(uri)) {
          uris.push(uri);
          continue;
        }
        // Start at either a catalog or a directly configured collection.
        // Each collection reached through child links is its own source.
        const found = await collectionsOf(uri);
        uris.push(...found.collections);
        Object.assign(parents, found.parents);
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
  cache.listing = { at: now, uris: Array.from(new Set(uris)), parents, errors };
  return cache.listing;
}

async function refreshSource(cache: Cache, uri: string, now: number) {
  const existing = cache.sources.get(uri);
  if (existing && now - existing.checkedAt < refreshMs) return;
  const state: SourceState = existing ?? {
    uri,
    etag: "",
    parquet: null,
    items: [],
    embedded: {},
    editsEtag: null,
    qc: {},
    history: {},
    checkedAt: 0,
    error: null,
  };
  try {
    const [h, sidecar] = await Promise.all([head(uri), readEdits(uri)]);
    if (!h) throw new Error("object not found");
    // Re-read when the collection or any linked items file changes. JSON
    // dependencies include every ItemCollection page, not just the first.
    if (isJsonSource(uri)) {
      const rows = state.parquet ? await head(state.parquet) : null;
      if (`${h.etag}|${rows?.etag ?? ""}` !== state.etag || !state.embedded ||
          !state.dependencies || await jsonItemsChanged(state.dependencies)) {
        const read = await readCollectionJson(uri);
        state.items = read.items;
        state.embedded = read.collections;
        state.parquet = read.parquet?.uri ?? null;
        state.dependencies = read.dependencies;
        state.etag = `${h.etag}|${read.parquet?.etag ?? ""}`;
      }
    } else if (h.etag !== state.etag || !state.embedded) {
      try {
        const read = await readItems(uri);
        state.items = read.items;
        state.embedded = read.collections;
        state.skipped = false;
      } catch (e) {
        if (!(e instanceof NotStac)) throw e;
        // A data table beside the items, not an error. Its ETag is kept so
        // it's read again only when it changes.
        console.log(`stac-x: ${e.message}, so it's left out`);
        state.items = [];
        state.embedded = {};
        state.skipped = true;
      }
      state.etag = h.etag;
    }
    const { edits, etag } = sidecar;
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
async function describeCollection(cache: Cache, id: string, items: CatalogItem[], sources: string[], now: number): Promise<Collection> {
  const docHref = docHrefOf(items) ?? sources.find((uri) => isJsonSource(uri) && cache.sources.get(uri)?.embedded[id]) ?? null;
  // A catalog's collection.json is itself a source, already read.
  const read = (docHref && cache.sources.get(docHref)?.embedded?.[id]) || (await collectionDoc(cache, docHref, now));
  const embeddedIn = read ? undefined : sources.find((uri) => cache.sources.get(uri)?.embedded?.[id]);
  const doc = read ?? (embeddedIn ? cache.sources.get(embeddedIn)!.embedded[id] : null);
  // Relative asset hrefs are relative to the file the metadata came from.
  const docBase = read ? docHref : embeddedIn ?? null;
  if (!doc) return derivedCollection(cache, id, items, sources);
  const bbox = unionBbox(items);
  const temporal = temporalExtent(items);
  const { qc, history, geometryErrors } = recordsOf(cache, id, items, sources);
  {
    const ext = doc.extent as { spatial?: { bbox?: number[][] }; temporal?: { interval?: (string | null)[][] } } | undefined;
    const docBbox = ext?.spatial?.bbox?.[0];
    const docInterval = ext?.temporal?.interval?.[0];
    const {
      id: _id, title, description, license, keywords, providers, extent: _extent, links,
      stac_version: _v, stac_extensions: _x, type: _t, assets,
      version, deprecated, experimental, ...extra
    } = doc;
    void _id; void _extent; void _v; void _x;
    return {
      id,
      type: _t === "Catalog" ? "Catalog" : "Collection",
      // Classified in build().
      kind: "dataset",
      title: collectionName(typeof title === "string" ? title : null, id),
      sourceTitle: typeof title === "string" && title ? title : null,
      description: typeof description === "string" ? description : null,
      license: typeof license === "string" ? license : null,
      keywords: Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === "string") : [],
      providers: Array.isArray(providers) ? (providers as Provider[]) : [],
      bbox: docBbox && docBbox.length >= 4 ? [docBbox[0], docBbox[1], docBbox[2], docBbox[3]] : bbox,
      temporal: docInterval ? [docInterval[0] ?? null, docInterval[1] ?? null] : temporal,
      itemCount: items.length,
      // Classified in build(), from what the sources link to.
      itemsLinked: sources.some((uri) => {
        const s = cache.sources.get(uri);
        return !isJsonSource(uri) || !!s?.parquet || (s?.dependencies?.length ?? 0) > 0;
      }),
      parentMissing: false,
      childCollectionCount: 0,
      childCollectionHrefs: Array.isArray(links) && docBase
        ? (links as StacLink[]).filter((l) => l?.rel === "child" && typeof l.href === "string").map((l) => resolveHref(l.href, docBase))
        : [],
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
      geometryErrors,
      items,
    };
  }
}

/** A collection described from its items alone, when there's no document or the document can't be used. */
function derivedCollection(cache: Cache, id: string, items: CatalogItem[], sources: string[]): Collection {
  const { qc, history, geometryErrors } = recordsOf(cache, id, items, sources);
  return {
    id,
    type: "Collection",
    kind: "dataset",
    title: collectionName(null, id),
    sourceTitle: null,
    description: null,
    license: null,
    keywords: [],
    providers: [],
    bbox: unionBbox(items),
    temporal: temporalExtent(items),
    itemCount: items.length,
    // Its items are the rows of a file.
    itemsLinked: true,
    parentMissing: false,
    childCollectionCount: 0,
    childCollectionHrefs: [],
    sources,
    fromDocument: false,
    assets: {},
    extra: {},
    version: null,
    deprecated: false,
    experimental: false,
    docHref: docHrefOf(items),
    versionLinks: [],
    series: lone(id),
    qc,
    history,
    geometryErrors,
    items,
  };
}

/** Loaded direct children, not descendants, missing documents, or self-links. */
export function childCollectionsOf(parent: Collection, collections: Collection[]): Collection[] {
  // The fallback handles catalogs cached before this field existed during hot reload.
  const hrefs = new Set(parent.childCollectionHrefs ?? []);
  return collections
    .filter((c) => c.id !== parent.id && c.docHref !== null && hrefs.has(c.docHref))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The collection document the items link to, if any. */
function docHrefOf(items: CatalogItem[]): string | null {
  const l = items[0]?.links.find((l) => l?.rel === "collection");
  return typeof l?.href === "string" ? l.href : null;
}

/** QC and history from the collection's sources, including documents without items. */
function recordsOf(cache: Cache, id: string, items: CatalogItem[], sources: string[]) {
  const qc = qcFor(cache, id, sources);
  const history = sources
    .flatMap((uri) => cache.sources.get(uri)?.history[id] ?? [])
    .sort((a, b) => b.at.localeCompare(a.at));
  const geometryErrors = items.filter((i) => i.geometryError).length;
  if (geometryErrors) {
    console.error(`stac-x: ${id}: ${geometryErrors} of ${items.length} items have geometry that couldn't be read (${items.find((i) => i.geometryError)!.geometryError}), so none of it is drawn`);
  }
  return { sources, qc, history, geometryErrors };
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
  if (isS3(href) && !(await awsAvailable())) return null;
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
