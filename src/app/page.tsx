import type { FeatureCollection } from "geojson";
import { HomeConsole, type HomeArea } from "@/components/home";
import { getCatalog, unionBbox } from "@/lib/catalog";
import { catalogDescription } from "@/lib/config";
import { MODEL_AREAS } from "@/lib/fixtures/areas";
import { baseName } from "@/lib/storage";
import { collectionHref } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The landing page: where in Colorado there are models, on one map.
 *
 * The area list is the mock in fixtures/areas.ts joined to the catalog. An
 * area whose collection the catalog holds is live: it links to the
 * collection, its counts are real, and its items are drawn on the map. A
 * collection in the catalog that no mock area names is added as its own live
 * area, so a new parquet file in the bucket shows up here with no code
 * change. Everything else is planned.
 */
export default async function Home() {
  const catalog = await getCatalog();
  const byId = new Map(catalog.collections.map((c) => [c.id, c]));
  const reviewedOf = (c: (typeof catalog.collections)[number]) =>
    c.items.filter((i) => i.edit && i.edit.qc !== "pending").length;

  const areas: HomeArea[] = MODEL_AREAS.map((a) => {
    const c = a.collection ? byId.get(a.collection) : undefined;
    if (!c) return { ...a, live: false, href: null, itemCount: null, temporal: null, reviewed: null };
    return {
      ...a,
      blurb: c.description ?? a.blurb,
      bbox: c.bbox ?? a.bbox,
      live: true,
      href: collectionHref(c.id),
      itemCount: c.itemCount,
      temporal: c.temporal,
      reviewed: reviewedOf(c),
    };
  });
  const named = new Set(MODEL_AREAS.map((a) => a.collection));
  for (const c of catalog.collections) {
    if (named.has(c.id)) continue;
    areas.push({
      slug: c.id,
      name: c.title,
      kind: "gages",
      basin: "Colorado",
      huc4: "1019",
      bbox: c.bbox ?? unionBbox(c.items) ?? [-109.06, 36.99, -102.04, 41.0],
      live: true,
      href: collectionHref(c.id),
      itemCount: c.itemCount,
      temporal: c.temporal,
      reviewed: reviewedOf(c),
    });
  }
  areas.sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name));

  const items: FeatureCollection = {
    type: "FeatureCollection",
    features: catalog.collections.flatMap((c) =>
      c.items
        .filter((i) => i.geometry)
        .map((i) => ({ type: "Feature" as const, properties: { id: i.id, collection: c.id }, geometry: i.geometry! })),
    ),
  };

  const totals = {
    live: areas.filter((a) => a.live).length,
    items: catalog.collections.reduce((n, c) => n + c.itemCount, 0),
    reviewed: catalog.collections.reduce((n, c) => n + reviewedOf(c), 0),
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
      <div className="sx-band">
        <span>
          {catalog.sources.length === 0
            ? "No geoparquet sources found."
            : `Reading ${catalog.sources.length} ${catalog.sources.length === 1 ? "file" : "files"}: ${catalog.sources
                .map((s) => baseName(s.uri))
                .join(", ")}.`}
        </span>
        {catalog.errors.length > 0 && (
          <span className="text-bad-text">
            {catalog.errors.length} source {catalog.errors.length === 1 ? "error" : "errors"}: {catalog.errors.join("; ")}
          </span>
        )}
      </div>
    </>
  );
}
