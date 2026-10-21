import type { Collection } from "./stac";
import { isParquetType } from "./format";

/**
 * The stac-geoparquet a collection's items live in: the file it was read
 * from where the catalog is GeoParquet, else the asset a STAC JSON
 * collection marks as its mirror (role "collection-mirror"). Not just any
 * parquet asset: a gage collection also carries data tables as parquet,
 * and those are the item's data, not the items. Null when it has neither,
 * and then there's no Data panel to show.
 */
export function dataFileOf(c: Pick<Collection, "sources" | "assets">): string | null {
  return (
    c.sources.find((s) => isParquetType(null, s)) ??
    Object.values(c.assets).find((a) => a.roles?.includes("collection-mirror") && isParquetType(a.type, a.href))?.href ??
    null
  );
}
