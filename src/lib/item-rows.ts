import "server-only";

import type { ItemRow } from "@/components/items-list";
import { itemRowLabel } from "@/lib/item-kinds";
import { shapeGroups, tintOf } from "@/lib/overview";
import type { Collection } from "@/lib/stac";

/**
 * A collection's items as the compact rows the items list shows: one per
 * item, named the way its own page names it, with the swatch of its shape
 * when the collection draws as a few shapes. Built here for the collection
 * page and for the home page's rows route, so both lists agree.
 */
export function itemRowsOf(c: Collection): ItemRow[] {
  // An item without a title is named for what it is ("Storm event 1",
  // "Terrain tile"), the same as on its own page, never its bare id. In a
  // calibration collection the HMS and RAS models share the basin's name,
  // so each row also says which it is.
  // A few distinct shapes each get their own blue, the same as on the
  // landing page, and the row carries the swatch.
  const groups = shapeGroups(c.items);
  const tintOfItem = new Map(groups.flatMap((ids, i) => ids.map((id) => [id, tintOf(i, groups.length)] as const)));
  return c.items.map((i) => ({
    id: i.id,
    ...itemRowLabel(c, i),
    tint: tintOfItem.get(i.id),
    start: str(i.properties.start_datetime) ?? str(i.properties.datetime),
    end: str(i.properties.end_datetime) ?? null,
  }));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
