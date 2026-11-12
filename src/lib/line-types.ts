/**
 * What a line item is, for the color the maps draw it in. A stream network,
 * a road network and a levee line are all lines, and in one color they
 * can't be told apart, so an item can say which it is with the
 * `stac-x:line` property:
 *
 * - `stream`: river blue, the color for data. Also what a line with no
 *   type, or one this list doesn't have, is drawn as.
 * - `road`: ink.
 * - `levee`: red.
 *
 * The types are named, not colors, so each has a shade for the light and
 * the dark palette (--ffx-line-road and --ffx-line-levee in
 * styles/tokens.css) and means the same on every map. It's read from the
 * item, since one collection can hold more than one kind of line.
 */
export const LINE_PROPERTY = "stac-x:line";

export const LINE_TYPES = ["stream", "road", "levee"] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** The line type an item's properties name, or undefined for none or one that isn't known. */
export function lineTypeOf(properties: Record<string, unknown> | null | undefined): LineType | undefined {
  const v = properties?.[LINE_PROPERTY];
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  return (LINE_TYPES as readonly string[]).includes(t) ? (t as LineType) : undefined;
}
