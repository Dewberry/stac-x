/**
 * The USGS four-digit hydrologic units (HUC4) that touch Colorado.
 *
 * The polygons live in public/data/co-huc4.json, pulled once from the USGS
 * Watershed Boundary Dataset and simplified to about 0.006 degrees so the
 * whole state is 138 KB. Names here match that file's properties. Every
 * collection is placed in one of these basins (see app/[env]/page.tsx), and
 * the landing page groups the rail by them and tints the ones with work.
 */
export const BASINS: Record<string, string> = {
  "1018": "North Platte",
  "1019": "South Platte",
  "1025": "Republican",
  "1026": "Smoky Hill",
  "1102": "Upper Arkansas",
  "1103": "Middle Arkansas",
  "1104": "Upper Cimarron",
  "1108": "Upper Canadian",
  "1301": "Rio Grande Headwaters",
  "1302": "Rio Grande-Elephant Butte",
  "1401": "Colorado Headwaters",
  "1402": "Gunnison",
  "1403": "Upper Colorado-Dolores",
  "1404": "Great Divide-Upper Green",
  "1405": "White-Yampa",
  "1406": "Lower Green",
  "1408": "San Juan",
};

export const BASINS_URL = "/data/co-huc4.json";

/** An empty code is a collection outside every basin above. */
export function basinName(huc4: string): string {
  if (!huc4) return "Outside Colorado";
  return BASINS[huc4] ?? `HUC ${huc4}`;
}

/**
 * The basin the program is about. The landing page map outlines it and
 * opens on it; the rest of Colorado is context.
 */
export const FOCUS_BASIN = "1019";

/** The South Platte's extent from co-huc4.json. It runs into Wyoming and Nebraska. */
export const FOCUS_BBOX: [number, number, number, number] = [-106.21, 38.75, -100.68, 41.49];

/**
 * Where the map goes for a basin: the part of its collections' extent that's
 * in the South Platte. Some collections run well past the basin (a structure
 * inventory, a storm catalog), and fitting all of that shrinks the basin to a
 * corner of the map when the basin is the only place anyone's looking. An
 * extent with nothing in the basin is kept as it is.
 */
export function clipToFocus(b: [number, number, number, number]): [number, number, number, number] {
  const w = Math.max(b[0], FOCUS_BBOX[0]);
  const s = Math.max(b[1], FOCUS_BBOX[1]);
  const e = Math.min(b[2], FOCUS_BBOX[2]);
  const n = Math.min(b[3], FOCUS_BBOX[3]);
  return w < e && s < n ? [w, s, e, n] : b;
}
