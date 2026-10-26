import { Suspense } from "react";
import type { FeatureCollection } from "geojson";
import { HomeConsole, type HomeArea } from "@/components/home";
import type { ItemRow } from "@/components/items-list";
import { HomeLoading } from "@/components/home-loading";
import type { EnvKey } from "@/lib/env";
import { getCatalog, unionBbox } from "@/lib/catalog";
import { collectionParents, hierarchyOf } from "@/lib/collection-hierarchy";
import { footprintBytes, footprintOf, INLINE_MAX, unitOf, type Footprint } from "@/lib/footprint";
import { itemRowsOf } from "@/lib/item-rows";
import { areaShare, inArea, mapArea, mapFrame } from "@/lib/map-area";
import { pageEnv } from "@/lib/page-env";
import type { Collection } from "@/lib/stac";
import { collectionHref, collectionJsonHref } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The landing page: where the catalog's datasets are, on one map that
 * opens on the deployment's area (lib/map-area.ts) or, with none set, on
 * everything the datasets cover.
 *
 * Every node in the catalog is an area here, so the rail can group and
 * search by catalog, but only datasets are drawn, counted and framed. A
 * catalog has no extent of its own; the box the generator gives it is a
 * placeholder (lib/collection-hierarchy.ts). A dataset links to its page,
 * its counts are real, and its footprint is drawn on the map when it's
 * selected (points for gages, the covered area for a model; see
 * lib/overview.ts), so a new parquet file in the bucket shows up here with
 * no code change. A dataset whose extent covers most of the area (gages)
 * says "Whole area" in the rail.
 */

/** The most items a selected collection lists by name in its row. */
const MEMBERS_MAX = 24;

/** Share of the area a collection's extent has to cover to count as area-wide. */
const WIDE = 0.7;

/** How many times the area's box a dataset's box has to be to count as reaching beyond the area. */
const LARGER = 3;

/** What the rail says when an environment has nothing in it yet. */
const EMPTY: Record<EnvKey, string> = {
  sandbox: "Datasets show up here once they land in the Sandbox catalog.",
  dev: "Datasets show up here once they land in the Development catalog.",
  test: "Datasets show up here once they're approved in Development.",
  prod: "Datasets show up here once they're approved in Test.",
};

export default async function Home({ params }: { params: Promise<{ env: string }> }) {
  const env = await pageEnv(params);
  // The catalog can take seconds to read from S3. The loading state goes
  // out first and the console streams in over it.
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeData env={env} />
    </Suspense>
  );
}

async function HomeData({ env }: { env: EnvKey }) {
  const catalog = await getCatalog(env);
  const area = mapArea();
  // A collection with several versions is one area, drawn and counted from
  // its latest version.
  const latest = catalog.collections.filter((c) => c.series.latest === c.id);
  // The compact rows the rail lists, built once per collection: the dots
  // and the members take their names and dates from them.
  const rowsCache = new Map<string, Map<string, ItemRow>>();
  const rowsOf = (c: Collection) => {
    let m = rowsCache.get(c.id);
    if (!m) rowsCache.set(c.id, (m = new Map(itemRowsOf(c).map((r) => [r.id, r]))));
    return m;
  };
  const versionOf = (c: Collection) => ({
    version: c.series.versions.length > 1 || c.version ? (c.series.versions.at(-1)?.label ?? c.version) : null,
    earlier: c.series.versions.findIndex((v) => v.id === c.id),
  });

  // One footprint per collection (lib/footprint.ts). Biggest first, so a
  // small model inside a big one draws on top of it.
  const extentArea = (b: [number, number, number, number] | null) => (b ? (b[2] - b[0]) * (b[3] - b[1]) : 0);
  // A collection whose items this page can't reduce to a footprint or a
  // row (geometry of a kind the reader let through) is left off the page,
  // and the notice says so, rather than the whole page going.
  const failed = new Set<string>();
  // The heavy ones keep their shape here but their features stay on the
  // server, fetched when the collection is picked.
  const lazy = new Set<string>();
  const footprints: Footprint[] = latest
    .filter((c) => c.kind === "dataset")
    .sort((x, y) => extentArea(y.bbox) - extentArea(x.bbox))
    .map((c) => {
      try {
        const f = footprintOf(c, area);
        if (footprintBytes(f) <= INLINE_MAX) return f;
        lazy.add(c.id);
        return { ...f, features: [] };
      } catch (e) {
        failed.add(c.id);
        console.error(`stac-x: ${c.id} couldn't be drawn on the home page:`, e);
        return { slug: c.series.id, shape: null, features: [] };
      }
    });
  const drawn = new Map(footprints.map((f) => [f.slug, f]));
  const items: FeatureCollection = { type: "FeatureCollection", features: footprints.flatMap((f) => f.features) };

  // The items behind each of a few drawn shapes, named as the collection
  // page names them, in the collection's own order.
  const membersOf = (c: Collection): HomeArea["members"] => {
    const shapes = drawn.get(c.series.id)?.members;
    // A few shapes can still be thousands of items (every event of one
    // model); a list that long belongs on the collection page.
    if (!shapes || c.items.length > MEMBERS_MAX) return undefined;
    const shapeOf = new Map(shapes.flatMap((m) => m.ids.map((id) => [id, m] as const)));
    const rowOf = rowsOf(c);
    return c.items.flatMap((i) => {
      const shape = shapeOf.get(i.id);
      const row = rowOf.get(i.id);
      return shape && row
        ? [{ id: i.id, key: shape.key, tint: shape.tint, label: row.label ?? i.id, hideId: !!row.hideId, kind: row.kind ?? null, start: row.start, end: row.end }]
        : [];
    });
  };

  // The one place a collection's footprint is, when it has one: the name
  // its shapes share ("Big Thompson"), for the rail's row.
  const placeOf = (c: Collection): string | null => {
    const names = new Set(membersOf(c)?.map((m) => m.label) ?? []);
    return names.size === 1 ? (names.values().next().value ?? null) : null;
  };

  // Where a dataset's extent sits against the area. A box several times
  // the area's (a five-state storm domain, a national inventory) reaches
  // beyond it, even though it covers all of it, and so does one that
  // misses the area altogether. A box small enough to fall between the
  // area's sample points is in it when its middle is.
  const coverageOf = (bbox: [number, number, number, number] | null): HomeArea["coverage"] => {
    if (!area || !bbox) return null;
    if (extentArea(bbox) >= LARGER * extentArea(area.bbox)) return "beyond";
    const share = areaShare(area, bbox);
    if (share >= WIDE) return "whole";
    return share > 0 || inArea(area, [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]) ? "part" : "beyond";
  };

  const areas: HomeArea[] = [];
  for (const c of latest) {
    if (failed.has(c.id)) continue;
    // A collection whose geometry couldn't be read has no place on the map,
    // not even an extent; its row says so. A catalog has none to begin with.
    const broken = c.geometryErrors > 0;
    const bbox = broken || c.kind === "catalog" ? null : c.bbox ?? unionBbox(c.items);
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
      members: membersOf(c),
      place: placeOf(c),
      wide: !!area && !!bbox && areaShare(area, bbox) >= WIDE,
      href: collectionHref(env, c.id),
      jsonHref: collectionJsonHref(env, c.id),
      itemCount: c.itemCount,
      parentSlugs: [],
      frame: null,
      datasetsBelow: 0,
      emptyInside: 0,
      unit: broken ? "items" : unitOf(c),
      geometryError: broken || undefined,
      lazy: lazy.has(c.id) || undefined,
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
  }
  areas.sort((a, b) => a.name.localeCompare(b.name));

  // Every level is sent, for grouping and search. A failed parent leaves
  // its children at the top level.
  const parents = collectionParents(catalog.collections, new Set(areas.map((a) => a.id)));
  for (const a of areas) a.parentSlugs = parents.get(a.slug) ?? [];
  const tree = hierarchyOf(areas);
  for (const a of areas) {
    a.datasetsBelow = tree.datasetsBelow(a.slug);
    if (a.kind === "dataset") a.emptyInside = tree.childrenOf(a.slug).filter((c) => tree.isEmpty(c.slug)).length;
  }
  // Where the map goes when a catalog is opened in the rail: its datasets'
  // boxes, leaving out the ones that reach beyond the area (a storm domain,
  // a national inventory), so a catalog of basin-wide data opens on the
  // basin and one of a single watershed opens on that watershed. When some
  // were left out the area stays in the frame, so a catalog of mostly
  // area-wide data doesn't open on its one small dataset.
  const bySlug = new Map(areas.map((a) => [a.slug, a]));
  for (const a of areas) {
    if (a.kind !== "catalog" || !a.datasetsBelow) continue;
    const below = [...tree.descendants([a.slug])].map((s) => bySlug.get(s)!).filter((d) => d.kind === "dataset" && d.bbox);
    const near = area ? below.filter((d) => d.coverage !== "beyond") : below;
    const boxes = near.map((d) => d.bbox);
    if (area && near.length < below.length) boxes.push(area.bbox);
    a.frame = boxes.length ? mapFrame(null, boxes) : area?.bbox ?? null;
  }

  return (
    <HomeConsole
      env={env}
      areas={areas}
      area={area && { name: area.name, geometry: area.geometry }}
      frame={mapFrame(area, areas.filter((a) => a.kind === "dataset").map((a) => a.bbox))}
      items={items}
      // Only shown when something is wrong. The details go to the server log.
      notice={
        catalog.errors.length > 0 || failed.size > 0
          ? "Some datasets or catalogs couldn't be loaded and may be missing. Try again in a minute."
          : null
      }
      emptyText={EMPTY[env]}
    />
  );
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
