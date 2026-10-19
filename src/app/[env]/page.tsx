import { Suspense } from "react";
import type { FeatureCollection } from "geojson";
import { HomeConsole, type HomeArea } from "@/components/home";
import { HomeLoading } from "@/components/home-loading";
import { basinAt, basinCovered, basinShare } from "@/lib/basin-at";
import { FOCUS_BASIN } from "@/lib/basins";
import type { EnvKey } from "@/lib/env";
import { getCatalog, unionBbox } from "@/lib/catalog";
import { itemRowLabel } from "@/lib/item-kinds";
import { itemRowsOf } from "@/lib/item-rows";
import { guessKind } from "@/lib/kinds";
import { overview, polygonsOf } from "@/lib/overview";
import { pageEnv } from "@/lib/page-env";
import { QC_STATUSES, type Collection, type QcStatus } from "@/lib/stac";
import { collectionHref, collectionJsonHref } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The landing page: where in the South Platte there are collections, on one
 * map.
 *
 * Every collection in the catalog is an area here: it links to the
 * collection, its counts are real, and its footprint is drawn on the map
 * when it's selected (points for gages, the covered area for a model; see
 * lib/overview.ts), so a new parquet file in the bucket shows up here with
 * no code change. A collection whose extent covers most of the basin (gages,
 * a storm catalog) says "Whole basin" in the rail.
 */

/** The most items a selected collection lists by name in its row. */
const MEMBERS_MAX = 24;

/** Share of the basin a collection's extent has to cover to count as basin-wide. */
const WIDE = 0.7;

/** What the rail says when an environment has nothing in it yet. */
const EMPTY: Record<EnvKey, string> = {
  dev: "Collections show up here once they land in the Development catalog.",
  test: "Collections show up here once they're approved in Development.",
  prod: "Collections show up here once they're approved in Testing.",
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
  // A collection with several versions is one area, drawn and counted from
  // its latest version.
  const latest = catalog.collections.filter((c) => c.series.latest === c.id);
  const versionOf = (c: Collection) => ({
    version: c.series.versions.length > 1 || c.version ? (c.series.versions.at(-1)?.label ?? c.version) : null,
    earlier: c.series.versions.findIndex((v) => v.id === c.id),
  });

  // One footprint per collection, tagged with its series id so the map can
  // draw the selected one. Biggest first, so a small model inside a big
  // one draws on top of it.
  const extentArea = (b: [number, number, number, number] | null) => (b ? (b[2] - b[0]) * (b[3] - b[1]) : 0);
  const footprints = await Promise.all(
    [...latest]
      .sort((x, y) => extentArea(y.bbox) - extentArea(x.bbox))
      .map(async (c) => {
        const o = overview(c.items, c.series.id, c.bbox);
        // Each dot is named the way the collection page names its item, for
        // the card a click on it opens.
        const byId = new Map(c.items.map((i) => [i.id, i]));
        for (const f of o.features) {
          const item = f.properties?.role === "point" ? byId.get(f.properties.id) : undefined;
          if (item) Object.assign(f.properties!, itemRowLabel(c, item));
        }
        // Shapes that contain the whole basin (a national inventory's extent
        // box) would tint the whole map, so such a collection is drawn as
        // the basin itself; the map lights the basin up for it.
        const polys =
          o.shape === "areas"
            ? polygonsOf(c.items)
            : o.shape === "extent"
              ? o.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : []))
              : [];
        if (polys.length && (await basinCovered(FOCUS_BASIN, polys))) return { slug: c.series.id, shape: "basin" as const, features: [] };
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
    return c.items.flatMap((i) => {
      const shape = shapeOf.get(i.id);
      return shape ? [{ id: i.id, key: shape.key, tint: shape.tint, ...itemRowLabel(c, i) }] : [];
    });
  };

  const areas: HomeArea[] = [];
  for (const c of latest) {
    const bbox = c.bbox ?? unionBbox(c.items) ?? [-109.06, 36.99, -102.04, 41.0];
    const huc4 = (await basinAt([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2])) ?? "";
    areas.push({
      slug: c.series.id,
      id: c.id,
      name: c.title,
      kind: guessKind(c),
      huc4,
      bbox,
      blurb: c.description ?? undefined,
      drawn: drawn.get(c.series.id)?.shape ?? null,
      steps: drawn.get(c.series.id)?.steps,
      members: membersOf(c),
      wide: (await basinShare(FOCUS_BASIN, bbox)) >= WIDE,
      href: collectionHref(env, c.id),
      jsonHref: collectionJsonHref(env, c.id),
      itemCount: c.itemCount,
      temporal: c.temporal,
      qc: c.qc,
      ...versionOf(c),
    });
  }
  areas.sort((a, b) => a.name.localeCompare(b.name));

  const byState = Object.fromEntries(QC_STATUSES.map((s) => [s.value, 0])) as Record<QcStatus, number>;
  for (const a of areas) byState[a.qc?.qc ?? "pending"]++;

  // The console opens on the first collection, so its items go with the
  // page; the others are fetched when they're picked.
  const first = latest.find((c) => c.series.id === areas[0]?.slug);
  const initialRows = first ? { slug: first.series.id, rows: itemRowsOf(first) } : null;

  return (
    <HomeConsole
      env={env}
      areas={areas}
      items={items}
      byState={byState}
      initialRows={initialRows}
      // Only shown when something is wrong. The details go to the server log.
      notice={catalog.errors.length > 0 ? "Some collections couldn't be loaded and may be missing. Try again in a minute." : null}
      emptyText={EMPTY[env]}
    />
  );
}
