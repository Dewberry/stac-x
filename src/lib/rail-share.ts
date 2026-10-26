/**
 * How much of the landing page's width the dataset list takes beside the
 * map, as a percent. A person drags the divider between them
 * (components/home-split.tsx) and the choice is kept in a cookie, so the
 * page, and its loading state, render at that width from the server
 * instead of jumping to it once the script runs.
 */

export const RAIL_COOKIE = "sx-rail";

/** Half and half until someone moves the divider. */
export const RAIL_DEFAULT = 50;
export const RAIL_MIN = 20;
export const RAIL_MAX = 70;

/** The share in a cookie value, or the default when it's missing or odd. */
export function railShare(value: string | undefined): number {
  const n = Number(value);
  return value && Number.isFinite(n) ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(n))) : RAIL_DEFAULT;
}
