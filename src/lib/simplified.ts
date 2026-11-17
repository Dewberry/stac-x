/**
 * Whether an item's geometry is a simplified one. The pipeline thins a heavy
 * shape before it writes the item and says so on that item with
 *
 *   "geometry_simplified": true
 *
 * It's the item's own flag, not the collection's: one collection can hold
 * shapes that were thinned beside ones that weren't. The maps say it where
 * the item is named (components/map.tsx), so nobody reads a thinned outline
 * as the surveyed one. In a parquet file it's a boolean column of that name;
 * the text "true" counts too, for a file that wrote it as a string.
 */
export const SIMPLIFIED_PROPERTY = "geometry_simplified";

export function isSimplified(properties: Record<string, unknown> | null | undefined): boolean {
  const v = properties?.[SIMPLIFIED_PROPERTY];
  return v === true || v === "true";
}
