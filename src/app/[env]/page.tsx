import { Suspense } from "react";
import type { FeatureCollection } from "geojson";
import { HomeConsole, type HomeArea } from "@/components/home";
import type { ItemRow } from "@/components/items-list";
import { HomeLoading } from "@/components/home-loading";
import type { EnvKey } from "@/lib/env";
import { getCatalog, unionBbox } from "@/lib/catalog";
import { itemRowsOf } from "@/lib/item-rows";
import { areaCovered, areaShare, inArea, mapArea, mapFrame } from "@/lib/map-area";
import { overview, polygonsOf } from "@/lib/overview";
import { pageEnv } from "@/lib/page-env";
import { QC_STATUSES, type Collection, type QcStatus } from "@/lib/stac";
import { collectionHref, collectionJsonHref } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The landing page: where the catalog's collections are, on one map that
 * opens on the deployment's area (lib/map-area.ts) or, with none set, on
 * everything the catalog covers.
 *
 * Every collection in the catalog is an area here: it links to the
 * collection, its counts are real, and its footprint is drawn on the map
 * when it's selected (points for gages, the covered area for a model; see
 * lib/overview.ts), so a new parquet file in the bucket shows up here with
 * no code change. A collection whose extent covers most of the area (gages,
 * a storm catalog) says "Whole area" in the rail.
 */

/** The most items a selected collection lists by name in its row. */
const MEMBERS_MAX = 24;

/** Share of the area a collection's extent has to cover to count as area-wide. */
const WIDE = 0.7;

/** How many times the area's box a collection's box has to be to count as larger than the area. */
const LARGER = 3;

/** What the rail says when an environment has nothing in it yet. */
const EMPTY: Record<EnvKey, string> = {
  sandbox: "Collections show up here once they land in the Sandbox catalog.",
  dev: "Collections show up here once they land in the Development catalog.",
  test: "Collections show up here once they're approved in Development.",
  prod: "Collections show up here once they're approved in Test.",
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

  // One footprint per collection, tagged with its series id so the map can
  // draw the selected one. Biggest first, so a small model inside a big
  // one draws on top of it.
  const extentArea = (b: [number, number, number, number] | null) => (b ? (b[2] - b[0]) * (b[3] - b[1]) : 0);
  // A collection whose items this page can't reduce to a footprint or a
  // row (geometry of a kind the reader let through) is left off the page,
  // and the notice says so, rather than the whole page going.
  const failed = new Set<string>();
  const footprints = await Promise.all(
    [...latest]
      .sort((x, y) => extentArea(y.bbox) - extentArea(x.bbox))
      .map(async (c) => {
        let o: ReturnType<typeof overview>;
        try {
          o = overview(c.items, c.series.id, c.bbox);
          rowsOf(c);
        } catch (e) {
          failed.add(c.id);
          console.error(`stac-x: ${c.id} couldn't be drawn on the home page:`, e);
          return { slug: c.series.id, shape: null, features: [] };
        }
        // Each dot is named and dated the way the collection page names its
        // item, for the tooltip and the card a click on it opens.
        const rowOf = rowsOf(c);
        for (const f of o.features) {
          const row = f.properties?.role === "point" ? rowOf.get(f.properties.id) : undefined;
          if (row) Object.assign(f.properties!, { label: row.label, hideId: row.hideId, kind: row.kind, start: row.start, end: row.end });
        }
        // Shapes that contain the whole area (a national inventory's extent
        // box) would tint the whole map, so such a collection is drawn as
        // the area itself; the map lights the area up for it.
        const polys =
          o.shape === "areas"
            ? polygonsOf(c.items)
            : o.shape === "extent"
              ? o.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : []))
              : [];
        if (area && areaCovered(area, polys)) return { slug: c.series.id, shape: "area" as const, features: [] };
        return { slug: c.series.id, ...o };
      }),
  );
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

  // Where a collection's extent sits against the area. A box several times
  // the area's (a five-state storm domain, a national inventory) is larger
  // than it, even though it covers all of it.
  const coverageOf = (bbox: [number, number, number, number] | null): HomeArea["coverage"] => {
    if (!area || !bbox) return null;
    if (extentArea(bbox) >= LARGER * extentArea(area.bbox)) return "larger";
    return areaShare(area, bbox) >= WIDE ? "whole" : "part";
  };

  const areas: HomeArea[] = [];
  for (const c of latest) {
    if (failed.has(c.id)) continue;
    const bbox = c.bbox ?? unionBbox(c.items);
    areas.push({
      slug: c.series.id,
      id: c.id,
      name: c.title,
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
      unit: unitOf(c),
      coverage: coverageOf(bbox),
      years: yearsOf(c.temporal),
      license: c.license,
      providers: c.providers.map((p) => p.name),
      keywords: c.keywords,
      assetCount: Object.keys(c.assets).length,
      temporal: c.temporal,
      qc: c.qc,
      ...versionOf(c),
    });
  }
  areas.sort((a, b) => a.name.localeCompare(b.name));

  const byState = Object.fromEntries(QC_STATUSES.map((s) => [s.value, 0])) as Record<QcStatus, number>;
  for (const a of areas) byState[a.qc?.qc ?? "pending"]++;

  return (
    <HomeConsole
      env={env}
      areas={areas}
      area={area && { name: area.name, geometry: area.geometry }}
      frame={mapFrame(area, areas.map((a) => a.bbox))}
      items={items}
      byState={byState}
      // Only shown when something is wrong. The details go to the server log.
      notice={
        catalog.errors.length > 0 || failed.size > 0
          ? "Some collections couldn't be loaded and may be missing. Try again in a minute."
          : null
      }
      emptyText={EMPTY[env]}
    />
  );
}

/**
 * What a collection's items are on the map, from their geometry: "points"
 * when every item is a point, "shapes" when any is a line or polygon, and
 * "items" when none has a geometry.
 */
function unitOf(c: Collection): HomeArea["unit"] {
  const types = c.items.flatMap((i) => (i.geometry ? [i.geometry.type] : []));
  if (!types.length) return "items";
  return types.every((t) => t === "Point" || t === "MultiPoint") ? "points" : "shapes";
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
