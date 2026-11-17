import "server-only";

import type { FeatureCollection } from "geojson";
import type { HomeArea, HomeData } from "@/components/home";
import type { ItemRow } from "@/components/items-list";
import type { EnvKey } from "./env";
import { getCatalog, peekCatalog, unionBbox, type Catalog } from "./catalog";
import { collectionParents, hierarchyOf } from "./collection-hierarchy";
import { footprintBytes, footprintOf, INLINE_MAX, unitOf, type Footprint } from "./footprint";
import { itemRowsOf } from "./item-rows";
import { areaOutside, areaShare, inArea, mapArea, mapFrame } from "./map-area";
import { isSimplified } from "./simplified";
import type { Collection } from "./stac";
import { collectionHref, collectionJsonHref } from "./utils";

/**
 * What the landing page shows of a catalog: every node as an area for the
 * rail, and the footprints the map draws.
 *
 * Every node in the catalog is an area here, so the rail can group and
 * search by catalog, but only collections are drawn, counted and framed. A
 * catalog has no extent of its own; the box the generator gives it is a
 * placeholder (lib/collection-hierarchy.ts). A collection links to its page,
 * its counts are real, and its footprint is drawn on the map when it's
 * selected (points for gages, the covered area for a model; see
 * lib/overview.ts), so a new parquet file in the bucket shows up here with
 * no code change. A collection whose extent covers most of the area (gages)
 * says "Whole area" in the rail.
 *
 * Working this out is the slow part of the page, not reading the catalog,
 * which is in memory: every collection's items are reduced to a footprint,
 * and with a hundred collections that was two seconds of the server doing
 * nothing else, on every visit. So it's kept at two levels. The whole
 * answer is kept for as long as the catalog is the same object, which is
 * until its next refresh (getCatalog). And each collection's footprint and
 * rows are kept for as long as its source files are the same (itemsStamp),
 * so a refresh that found nothing new costs little. The page asks without
 * waiting (homeData): an answer already here goes out with the page, and
 * one that isn't streams in behind the map.
 */

/** The most items a selected collection lists by name in its row. */
const MEMBERS_MAX = 24;

/** Share of the area a collection's extent has to cover to count as area-wide. */
const WIDE = 0.7;

/** How many times the area's box a collection's box has to be to count as reaching beyond the area. */
const LARGER = 3;

/** How much of a collection's box has to lie outside the area for it to be wider than the area even when it covers it. */
const OUTSIDE = 0.5;

/** How long, in ms, the work runs before it lets the server answer something else. */
const SLICE = 12;

type Bbox = [number, number, number, number];

/** What's kept per collection, and the stamp it was worked out under. */
type Kept = {
  stamp: string;
  /** The footprint as the page sends it: without its features when they're too heavy. */
  footprint: Footprint;
  lazy: boolean;
  failed: boolean;
  rows: Map<string, ItemRow> | null;
};

// Kept on globalThis so hot reload doesn't drop it, like the catalog.
const g = globalThis as unknown as {
  __stacxHome?: { byCatalog: WeakMap<Catalog, HomeData>; working: WeakMap<Catalog, Promise<HomeData>>; kept: Map<string, Kept> };
};
const store = (g.__stacxHome ??= { byCatalog: new WeakMap(), working: new WeakMap(), kept: new Map() });

/**
 * The landing page's data for an environment. `ready` is the answer when
 * it's already in memory, and null when it has to be worked out or the
 * catalog read first; `pending` is the answer either way.
 */
export function homeData(env: EnvKey): { ready: HomeData | null; pending: Promise<HomeData> } {
  const pending = load(env);
  const catalog = peekCatalog(env);
  return { ready: (catalog && store.byCatalog.get(catalog)) ?? null, pending };
}

async function load(env: EnvKey): Promise<HomeData> {
  const catalog = await getCatalog(env);
  const done = store.byCatalog.get(catalog);
  if (done) return done;
  // One visitor's request does the work and the rest wait on it.
  let working = store.working.get(catalog);
  if (!working) {
    working = compute(env, catalog).then((data) => {
      store.byCatalog.set(catalog, data);
      return data;
    });
    store.working.set(catalog, working);
    working.catch(() => store.working.delete(catalog));
  }
  return working;
}

/** Lets what's waiting on the server (the page's first bytes, another request) go ahead. */
const pause = () => new Promise<void>((resolve) => setImmediate(resolve));

async function compute(env: EnvKey, catalog: Catalog): Promise<HomeData> {
  // The page that asked goes out before any of this starts.
  await pause();
  let sliceStart = performance.now();
  const breathe = async () => {
    if (performance.now() - sliceStart < SLICE) return;
    await pause();
    sliceStart = performance.now();
  };

  const area = mapArea();
  // A collection with several versions is one area, drawn and counted from
  // its latest version.
  const latest = catalog.collections.filter((c) => c.series.latest === c.id);
  const extentArea = (b: Bbox | null) => (b ? (b[2] - b[0]) * (b[3] - b[1]) : 0);

  // One footprint per collection (lib/footprint.ts), and the compact rows
  // the rail lists: the dots and the members take their names and dates
  // from them. Both come from the collection's items, so both are kept
  // until its files change.
  const keptOf = new Map<string, Kept>();
  for (const c of latest) {
    const key = `${env}|${c.id}`;
    const stamp = `${c.itemsStamp ?? ""}|${c.series.id}|${c.kind}|${c.geometryErrors}|${JSON.stringify(c.bbox)}`;
    let k = c.itemsStamp ? store.kept.get(key) : undefined;
    if (!k || k.stamp !== stamp) {
      k = { stamp, ...reduce(c, area) };
      store.kept.set(key, k);
      await breathe();
    }
    keptOf.set(c.id, k);
  }
  // A collection that's gone from the catalog, or isn't the latest version any more, has nothing to keep.
  const here = new Set(latest.map((c) => `${env}|${c.id}`));
  for (const key of store.kept.keys()) if (key.startsWith(`${env}|`) && !here.has(key)) store.kept.delete(key);

  // Biggest first, so a small model inside a big one draws on top of it.
  const footprints = latest
    .filter((c) => c.kind === "collection")
    .sort((x, y) => extentArea(y.bbox) - extentArea(x.bbox))
    .map((c) => keptOf.get(c.id)!.footprint);
  const drawn = new Map(footprints.map((f) => [f.slug, f]));
  const items: FeatureCollection = { type: "FeatureCollection", features: footprints.flatMap((f) => f.features) };
  const failed = new Set(latest.filter((c) => keptOf.get(c.id)!.failed).map((c) => c.id));

  const versionOf = (c: Collection) => ({
    version: c.series.versions.length > 1 || c.version ? (c.series.versions.at(-1)?.label ?? c.version) : null,
    earlier: c.series.versions.findIndex((v) => v.id === c.id),
  });

  // The items behind each of a few drawn shapes, named as the collection
  // page names them, in the collection's own order.
  const membersOf = (c: Collection): HomeArea["members"] => {
    const shapes = drawn.get(c.series.id)?.members;
    const rowOf = keptOf.get(c.id)!.rows;
    // A few shapes can still be thousands of items (every event of one
    // model); a list that long belongs on the collection page.
    if (!shapes || !rowOf || c.items.length > MEMBERS_MAX) return undefined;
    const shapeOf = new Map(shapes.flatMap((m) => m.ids.map((id) => [id, m] as const)));
    return c.items.flatMap((i) => {
      const shape = shapeOf.get(i.id);
      const row = rowOf.get(i.id);
      return shape && row
        ? [{ id: i.id, key: shape.key, tint: shape.tint, label: row.label ?? i.id, hideId: !!row.hideId, kind: row.kind ?? null, start: row.start, end: row.end, simplified: isSimplified(i.properties) || undefined }]
        : [];
    });
  };

  // Where a collection's extent sits against the area. A box several times
  // the area's (a five-state storm domain, a national inventory) reaches
  // beyond it, even though it covers all of it; so does one that covers it
  // but lies mostly outside it (a survey that runs on down the Platte); and
  // so does one that misses the area altogether. A box small enough to fall
  // between the area's sample points is in it when its middle is.
  const coverageOf = (bbox: Bbox | null): HomeArea["coverage"] => {
    if (!area || !bbox) return null;
    if (extentArea(bbox) >= LARGER * extentArea(area.bbox)) return "beyond";
    const share = areaShare(area, bbox);
    if (share >= WIDE) return areaOutside(area, bbox) >= OUTSIDE ? "beyond" : "whole";
    return share > 0 || inArea(area, [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]) ? "part" : "beyond";
  };

  const areas: HomeArea[] = [];
  for (const c of latest) {
    if (failed.has(c.id)) continue;
    // A collection whose geometry couldn't be read has no place on the map,
    // not even an extent; its row says so. A catalog has none to begin with.
    const broken = c.geometryErrors > 0;
    const bbox = broken || c.kind === "catalog" ? null : c.bbox ?? unionBbox(c.items);
    const members = membersOf(c);
    // The one place a collection's footprint is, when it has one: the name
    // its shapes share ("Big Thompson"), for the rail's row.
    const names = new Set(members?.map((m) => m.label) ?? []);
    areas.push({
      slug: c.series.id,
      id: c.id,
      name: c.title,
      kind: c.kind,
      inArea: !!area && !!bbox && inArea(area, [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]),
      bbox,
      blurb: c.description ?? undefined,
      drawn: drawn.get(c.series.id)?.shape ?? null,
      steps: drawn.get(c.series.id)?.steps,
      members,
      place: names.size === 1 ? (names.values().next().value ?? null) : null,
      wide: !!area && !!bbox && areaShare(area, bbox) >= WIDE,
      href: collectionHref(env, c.id),
      jsonHref: collectionJsonHref(env, c.id),
      itemCount: c.itemCount,
      parentSlugs: [],
      frame: null,
      collectionsBelow: 0,
      emptyInside: 0,
      unit: broken ? "items" : unitOf(c),
      geometryError: broken || undefined,
      itemsError: !!c.itemsError || undefined,
      parentMissing: c.parentMissing || undefined,
      lazy: keptOf.get(c.id)!.lazy || undefined,
      coverage: coverageOf(bbox),
      years: c.kind === "catalog" ? null : yearsOf(c.temporal),
      license: c.license,
      providers: c.providers.map((p) => p.name),
      keywords: c.keywords,
      assetCount: Object.keys(c.assets).length,
      temporal: c.kind === "catalog" ? null : c.temporal,
      // Catalogs have no review state; a proposed status on one means nothing.
      qc: c.kind === "catalog" ? null : c.qc,
      ...versionOf(c),
    });
    await breathe();
  }
  areas.sort((a, b) => a.name.localeCompare(b.name));

  // Every level is sent, for grouping and search. A failed parent leaves
  // its children at the top level.
  const parents = collectionParents(catalog.collections, new Set(areas.map((a) => a.id)));
  for (const a of areas) a.parentSlugs = parents.get(a.slug) ?? [];
  const tree = hierarchyOf(areas);
  for (const a of areas) {
    a.collectionsBelow = tree.collectionsBelow(a.slug);
    if (a.kind === "collection") a.emptyInside = tree.childrenOf(a.slug).filter((c) => tree.isEmpty(c.slug)).length;
  }
  // Where the map goes when a catalog is opened in the rail: its collections'
  // boxes, leaving out the ones that reach beyond the area (a storm domain,
  // a national inventory), so a catalog of basin-wide data opens on the
  // basin and one of a single watershed opens on that watershed. When some
  // were left out the area stays in the frame, so a catalog of mostly
  // area-wide data doesn't open on its one small collection.
  const bySlug = new Map(areas.map((a) => [a.slug, a]));
  for (const a of areas) {
    if (a.kind !== "catalog" || !a.collectionsBelow) continue;
    const below = [...tree.descendants([a.slug])].map((s) => bySlug.get(s)!).filter((d) => d.kind === "collection" && d.bbox);
    const near = area ? below.filter((d) => d.coverage !== "beyond") : below;
    const boxes = near.map((d) => d.bbox);
    if (area && near.length < below.length) boxes.push(area.bbox);
    a.frame = boxes.length ? mapFrame(null, boxes) : area?.bbox ?? null;
  }

  return {
    env,
    areas,
    frame: mapFrame(area, areas.filter((a) => a.kind === "collection").map((a) => a.bbox)),
    items,
    // Only shown when something is wrong. The details go to the server log.
    notice:
      catalog.errors.length > 0 || failed.size > 0
        ? "Some collections or catalogs couldn't be loaded and may be missing. Try again in a minute."
        : null,
  };
}

/**
 * One collection's items reduced to what the page needs of them. A
 * collection whose items can't be reduced (geometry of a kind the reader
 * let through) is left off the page, and the notice says so, rather than
 * the whole page going. A heavy footprint keeps its shape here but its
 * features stay on the server, fetched when the collection is picked.
 */
function reduce(c: Collection, area: ReturnType<typeof mapArea>): Omit<Kept, "stamp"> {
  const slug = c.series.id;
  if (c.kind !== "collection") return { footprint: { slug, shape: null, features: [] }, lazy: false, failed: false, rows: null };
  try {
    const f = footprintOf(c, area);
    const lazy = footprintBytes(f) > INLINE_MAX;
    // The rows are only read for a collection drawn as a few shapes.
    const rows = f.members && c.items.length <= MEMBERS_MAX ? new Map(itemRowsOf(c).map((r) => [r.id, r])) : null;
    return { footprint: lazy ? { ...f, features: [] } : f, lazy, failed: false, rows };
  } catch (e) {
    console.error(`stac-x: ${c.id} couldn't be drawn on the home page:`, e);
    return { footprint: { slug, shape: null, features: [] }, lazy: false, failed: true, rows: null };
  }
}

/**
 * The years a collection covers, "1980–2025", when its extent runs across
 * more than one calendar year. A shorter extent is usually when the data
 * was processed, not what it covers (the gages' is seven minutes), so the
 * rail leaves it out.
 */
function yearsOf([start, end]: [string | null, string | null]): string | null {
  const a = start?.slice(0, 4);
  const b = end?.slice(0, 4);
  return a && b && a !== b ? `${a}–${b}` : null;
}
