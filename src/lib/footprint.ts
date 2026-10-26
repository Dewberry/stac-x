import "server-only";

import { itemRowsOf } from "./item-rows";
import { areaCovered, type MapArea } from "./map-area";
import { overview, polygonsOf, type Overview } from "./overview";
import type { Collection } from "./stac";

/**
 * A collection's footprint on the landing page map: its overview
 * (lib/overview.ts) with each dot named and dated the way the collection
 * page names the item, tagged with the series id so the map can draw the
 * one that's picked.
 *
 * The page sends the small ones along with itself. A heavy one (a few
 * hundred model boundaries can be a megabyte of coordinates, and the page
 * took tens of seconds to serialize) is left out and fetched from the
 * footprint route the first time its collection is picked or pointed at.
 */
export type Footprint = Overview & { slug: string };

/** Past this many bytes of GeoJSON, a footprint is fetched on demand rather than sent with the page. */
export const INLINE_MAX = 150_000;

export function footprintOf(c: Collection, area: MapArea | null): Footprint {
  const slug = c.series.id;
  // Geometry the reader couldn't read means none of it is drawn.
  if (c.geometryErrors > 0) return { slug, shape: null, features: [] };
  const o = overview(c.items, slug, c.bbox);
  if (o.shape === "points" || o.features.some((f) => f.properties?.role === "point")) {
    const rowOf = new Map(itemRowsOf(c).map((r) => [r.id, r]));
    for (const f of o.features) {
      const row = f.properties?.role === "point" ? rowOf.get(f.properties.id) : undefined;
      if (row) Object.assign(f.properties!, { label: row.label, hideId: row.hideId, kind: row.kind, start: row.start, end: row.end });
    }
  }
  // Shapes that contain the whole area (a national inventory's extent box)
  // would tint the whole map, so such a collection is drawn as the area
  // itself; the map lights the area up for it.
  const polys =
    o.shape === "areas"
      ? polygonsOf(c.items)
      : o.shape === "extent"
        ? o.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : []))
        : [];
  if (area && areaCovered(area, polys)) return { slug, shape: "area", features: [] };
  return { slug, ...o };
}

export function footprintBytes(f: Footprint): number {
  return JSON.stringify(f.features).length;
}

/** What a collection's items are on the map, for the figure beside its count: "450 points". */
export type ItemUnit = "points" | "shapes" | "items";

/**
 * What a collection's items are on the map, from their geometry: "points"
 * when every item is a point, "shapes" when any is a line or polygon, and
 * "items" when none has a geometry.
 */
export function unitOf(c: Collection): ItemUnit {
  const types = c.items.flatMap((i) => (i.geometry ? [i.geometry.type] : []));
  if (!types.length) return "items";
  return types.every((t) => t === "Point" || t === "MultiPoint") ? "points" : "shapes";
}
