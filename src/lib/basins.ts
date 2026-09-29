/**
 * The USGS four-digit hydrologic units (HUC4) that touch Colorado.
 *
 * The polygons live in public/data/co-huc4.json, pulled once from the USGS
 * Watershed Boundary Dataset and simplified to about 0.006 degrees so the
 * whole state is 138 KB. Names here match that file's properties. Every
 * collection is placed in one of these basins (see fixtures/areas.ts), and
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
