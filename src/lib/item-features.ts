import "server-only";

import type { Feature } from "geojson";
import type { ItemRow } from "@/components/items-list";
import type { EnvKey } from "./env";
import { INLINE_MAX } from "./footprint";
import type { Collection } from "./stac";
import { itemHref } from "./utils";

/**
 * A collection's items as its own page's map draws them: one feature for
 * each item that has a geometry, carrying the item's name, kind and swatch
 * from its row (lib/item-rows.ts) and the link to its page. This isn't the
 * home map's footprint (lib/footprint.ts), which reduces a collection to
 * its shape. Here every item stays its own feature, so pointing at one
 * lights its row up and a click opens its page.
 *
 * The page sends them along with itself while they're small. A few hundred
 * model boundaries are megabytes of coordinates, though, and they went into
 * the page's payload on every visit. So the page keeps to the budget the
 * home page keeps (INLINE_MAX): past it the page goes out with none, and
 * the map fetches them from the footprint route (`?items=1`) once it's up.
 */
export function itemFeaturesOf(env: EnvKey, c: Collection, rows: ItemRow[]): Feature[] {
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  return c.items.flatMap((i): Feature[] => {
    if (!i.geometry) return [];
    const row = rowOf.get(i.id);
    return [
      {
        type: "Feature",
        id: i.id,
        properties: { id: i.id, href: itemHref(env, c.id, i.id), label: row?.label, tag: row?.kind ?? undefined, tint: row?.tint },
        geometry: i.geometry,
      },
    ];
  });
}

/** Whether features fit in the page, counted only as far as it takes to know. */
export function fitsInline(features: Feature[]): boolean {
  let bytes = 0;
  for (const f of features) {
    bytes += JSON.stringify(f).length;
    if (bytes > INLINE_MAX) return false;
  }
  return true;
}
