import type { FeatureCollection } from "geojson";
import { HomeConsole, type HomeArea } from "@/components/home";
import { basinAt } from "@/lib/basin-at";
import { getCatalog, unionBbox } from "@/lib/catalog";
import { basinName } from "@/lib/basins";
import { catalogDescription } from "@/lib/config";
import { MODEL_AREAS } from "@/lib/fixtures/areas";
import { guessKind } from "@/lib/kinds";
import { overview } from "@/lib/overview";
import { pageEnv } from "@/lib/page-env";
import type { Collection } from "@/lib/stac";
import { collectionHref, collectionJsonHref } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The landing page: where in Colorado there are models, on one map.
 *
 * The area list is the mock in fixtures/areas.ts joined to the catalog. An
 * area whose collection the catalog holds is live: it links to the
 * collection, its counts are real, and its footprint is drawn on the map
 * (points for gages, the covered area for a model; see lib/overview.ts). A
 * collection in the catalog that no mock area names is added as its own live
 * area, placed in the basin under the middle of its extent, so a new parquet
 * file in the bucket shows up here with no code change. Everything else is
 * planned.
 */
export default async function Home({ params }: { params: Promise<{ env: string }> }) {
  const env = await pageEnv(params);
  const catalog = await getCatalog(env);
  // A collection with several versions is one area, drawn and counted from
  // its latest version. A mock area can name the series ("gages") or any
  // version of it.
  const latest = catalog.collections.filter((c) => c.series.latest === c.id);
  const namesOf = (c: Collection) => [c.series.id, ...c.series.versions.map((v) => v.id), c.id];
  const byId = new Map(latest.flatMap((c) => namesOf(c).map((n) => [n, c] as const)));
  const versionOf = (c: Collection) => ({
    version: c.series.versions.length > 1 || c.version ? (c.series.versions.at(-1)?.label ?? c.version) : null,
    earlier: c.series.versions.findIndex((v) => v.id === c.id),
  });

  // One footprint per collection, tagged with its area's slug (the series
  // id when no mock area names it) so the map can light it up with its pin.
  // Biggest first, so a small model inside a big one draws on top of it.
  const slugOf = new Map(MODEL_AREAS.map((a) => [a.collection, a.slug]));
  const slugFor = (c: Collection) => namesOf(c).map((n) => slugOf.get(n)).find((s) => s) ?? c.series.id;
  const extentArea = (b: [number, number, number, number] | null) => (b ? (b[2] - b[0]) * (b[3] - b[1]) : 0);
  const footprints = latest
    .map((c) => ({ c, slug: slugFor(c) }))
    .sort((x, y) => extentArea(y.c.bbox) - extentArea(x.c.bbox))
    .map(({ c, slug }) => ({ slug, ...overview(c.items, slug, c.bbox) }));
  const drawn = new Map(footprints.map((f) => [f.slug, f.shape]));
  const items: FeatureCollection = { type: "FeatureCollection", features: footprints.flatMap((f) => f.features) };

  const areas: HomeArea[] = MODEL_AREAS.map((a) => {
    const c = a.collection ? byId.get(a.collection) : undefined;
    if (!c) return { ...a, live: false, drawn: null, href: null, jsonHref: null, itemCount: null, temporal: null, qc: null };
    return {
      ...a,
      blurb: c.description ?? a.blurb,
      bbox: c.bbox ?? a.bbox,
      live: true,
      drawn: drawn.get(a.slug) ?? null,
      href: collectionHref(env, c.id),
      jsonHref: collectionJsonHref(env, c.id),
      itemCount: c.itemCount,
      temporal: c.temporal,
      qc: c.qc,
      ...versionOf(c),
    };
  });
  const named = new Set(MODEL_AREAS.map((a) => a.collection));
  for (const c of latest) {
    if (namesOf(c).some((n) => named.has(n))) continue;
    const bbox = c.bbox ?? unionBbox(c.items) ?? [-109.06, 36.99, -102.04, 41.0];
    const huc4 = (await basinAt([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2])) ?? "";
    areas.push({
      slug: c.series.id,
      name: c.title,
      kind: guessKind(c),
      basin: basinName(huc4),
      huc4,
      bbox,
      live: true,
      drawn: drawn.get(c.series.id) ?? null,
      href: collectionHref(env, c.id),
      jsonHref: collectionJsonHref(env, c.id),
      itemCount: c.itemCount,
      temporal: c.temporal,
      qc: c.qc,
      ...versionOf(c),
    });
  }
  areas.sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name));

  const totals = {
    live: areas.filter((a) => a.live).length,
    items: latest.reduce((n, c) => n + c.itemCount, 0),
    approved: latest.filter((c) => c.qc?.qc === "approved").length,
  };

  return (
    <>
      <HomeConsole
        areas={areas}
        items={items}
        title="What's in the catalog, and where?"
        lead={catalogDescription}
        totals={totals}
      />
      {/* Only shown when something is wrong. The details go to the server log. */}
      {catalog.errors.length > 0 && (
        <div className="sx-band">
          <span className="text-bad-text">
            Some collections couldn&apos;t be loaded and may be missing. Try again in a minute.
          </span>
        </div>
      )}
    </>
  );
}
