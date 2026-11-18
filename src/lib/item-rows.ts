import "server-only";

import type { Geometry } from "geojson";
import type { ItemRow } from "@/components/items-list";
import { itemRowLabel } from "@/lib/item-kinds";
import { shapeGroups, tintOf } from "@/lib/overview";
import type { Collection, StacItem } from "@/lib/stac";

/**
 * A collection's items as the compact rows the items list shows: one per
 * item, named the way its own page names it, with what its geometry is (a
 * point, a line, an area, a mix of those, or none) and the swatch of its shape when the
 * collection draws as a few shapes. Built here for the collection
 * page and for the home page's rows route, so both lists agree. Those two
 * use listItemRows, below; the home page's footprints call this one inside
 * a guard of their own.
 */
export function itemRowsOf(c: Collection): ItemRow[] {
  return rowsOf(c, shapeGroups(c.items));
}

/**
 * The rows for a page that has to stay up whatever the file holds. The
 * swatches come from the items' geometry, and geometry of a kind the
 * reader let through (coordinates nested the wrong way) can't be sorted
 * into shapes: shapeGroups throws on it. The items are still listed then,
 * without swatches, and `shapesFailed` tells the caller the geometry isn't
 * fit to draw either.
 */
export function listItemRows(c: Collection): { rows: ItemRow[]; shapesFailed: boolean } {
  try {
    return { rows: itemRowsOf(c), shapesFailed: false };
  } catch (e) {
    console.error(`stac-x: ${c.id}'s items couldn't be sorted into shapes, so they're listed without swatches and not drawn:`, e);
    return { rows: rowsOf(c, []), shapesFailed: true };
  }
}

function rowsOf(c: Collection, groups: string[][]): ItemRow[] {
  // An item without a title is named for what it is ("Storm event 1",
  // "Terrain tile"), the same as on its own page, never its bare id. In a
  // calibration collection the HMS and RAS models share the basin's name,
  // so each row also says which it is.
  // A few distinct shapes each get their own blue, the same as on the
  // landing page, and the row carries the swatch.
  const tintOfItem = new Map(groups.flatMap((ids, i) => ids.map((id) => [id, tintOf(i, groups.length)] as const)));
  return c.items.map((i) => ({
    id: i.id,
    ...itemRowLabel(c, i),
    geom: geomOf(i),
    tint: tintOfItem.get(i.id),
    start: str(i.properties.start_datetime) ?? str(i.properties.datetime),
    end: str(i.properties.end_datetime) ?? null,
  }));
}

/**
 * What an item's geometry is, for the mark on its row. Null is an item that
 * has none. One whose geometry couldn't be read is left unsaid: it may well
 * have some, and the page already says the file's geometry is broken.
 */
function geomOf(i: StacItem): ItemRow["geom"] {
  if (!i.geometry) return i.geometryError ? undefined : null;
  return kindOf(i.geometry);
}

/**
 * A GeometryCollection is what its parts are: a point if they're all
 * points, and "mixed" when they differ (a gage and its reach), so the row
 * never calls a point and a line a polygon. An empty one has nothing to
 * draw, the same as no geometry.
 */
function kindOf(g: Geometry): NonNullable<ItemRow["geom"]> | null {
  switch (g.type) {
    case "Point":
    case "MultiPoint":
      return "point";
    case "LineString":
    case "MultiLineString":
      return "line";
    case "Polygon":
    case "MultiPolygon":
      return "area";
    case "GeometryCollection": {
      const kinds = new Set(g.geometries.map(kindOf).filter((k) => k !== null));
      if (kinds.size === 0) return null;
      return kinds.size === 1 ? [...kinds][0] : "mixed";
    }
    default:
      // The readers only let these seven types through. If one is ever added, say it's mixed, not a polygon.
      return "mixed";
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
