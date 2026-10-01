import type { FeatureCollection } from "geojson";
import { HomeConsole, type HomeArea } from "@/components/home";
import { basinAt } from "@/lib/basin-at";
import { getCatalog, unionBbox } from "@/lib/catalog";
import { catalogDescription } from "@/lib/config";
import { guessKind } from "@/lib/kinds";
import { overview } from "@/lib/overview";
import { pageEnv } from "@/lib/page-env";
import type { Collection } from "@/lib/stac";
import { collectionHref, collectionJsonHref } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The landing page: where in the South Platte there are collections, on one
 * map.
 *
 * Every collection in the catalog is an area here: it links to the
 * collection, its counts are real, and its footprint is drawn on the map
 * when it's selected (points for gages, the covered area for a model; see
 * lib/overview.ts). It's
 * placed in the basin under the middle of its extent, so a new parquet file
 * in the bucket shows up here with no code change.
 */
export default async function Home({ params }: { params: Promise<{ env: string }> }) {
  const env = await pageEnv(params);
  const catalog = await getCatalog(env);
  // A collection with several versions is one area, drawn and counted from
  // its latest version.
  const latest = catalog.collections.filter((c) => c.series.latest === c.id);
  const versionOf = (c: Collection) => ({
    version: c.series.versions.length > 1 || c.version ? (c.series.versions.at(-1)?.label ?? c.version) : null,
    earlier: c.series.versions.findIndex((v) => v.id === c.id),
  });

  // One footprint per collection, tagged with its series id so the map can
  // light it up with its pin. Biggest first, so a small model inside a big
  // one draws on top of it.
  const extentArea = (b: [number, number, number, number] | null) => (b ? (b[2] - b[0]) * (b[3] - b[1]) : 0);
  const footprints = [...latest]
    .sort((x, y) => extentArea(y.bbox) - extentArea(x.bbox))
    .map((c) => ({ slug: c.series.id, ...overview(c.items, c.series.id, c.bbox) }));
  const drawn = new Map(footprints.map((f) => [f.slug, f.shape]));
  const items: FeatureCollection = { type: "FeatureCollection", features: footprints.flatMap((f) => f.features) };

  const areas: HomeArea[] = [];
  for (const c of latest) {
    const bbox = c.bbox ?? unionBbox(c.items) ?? [-109.06, 36.99, -102.04, 41.0];
    const huc4 = (await basinAt([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2])) ?? "";
    areas.push({
      slug: c.series.id,
      name: c.title,
      kind: guessKind(c),
      huc4,
      bbox,
      blurb: c.description ?? undefined,
      drawn: drawn.get(c.series.id) ?? null,
      href: collectionHref(env, c.id),
      jsonHref: collectionJsonHref(env, c.id),
      itemCount: c.itemCount,
      temporal: c.temporal,
      qc: c.qc,
      ...versionOf(c),
    });
  }
  areas.sort((a, b) => a.name.localeCompare(b.name));

  const totals = {
    published: areas.length,
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
