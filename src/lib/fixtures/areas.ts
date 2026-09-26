/**
 * The model areas on the landing page.
 *
 * MOCK. The program will have a STAC collection per model or dataset for the
 * Colorado pilot, and the landing page shows every one of them on a map of the
 * state. Today exactly one collection exists as a geoparquet file (the South
 * Platte gages), so the rest of the map is populated from this list, which is
 * a plausible set of basins and model domains for the pilot and nothing more.
 * An entry here with a `collection` that the catalog actually holds becomes
 * live: it is clickable, it draws its real items on the map, and its counts
 * come from the data. Everything else is drawn as planned and cannot be
 * opened. Delete this file's entries as real collections land.
 *
 * Boxes are rough lon/lat extents of the named basin, good enough to place a
 * label and a dashed outline on a state-wide map. A real collection's extent
 * comes from its items and replaces the box.
 */

export type AreaKind = "gages" | "hms" | "ras" | "ressim" | "storms";

export const AREA_KIND_LABEL: Record<AreaKind, string> = {
  gages: "USGS gages",
  hms: "HEC-HMS model",
  ras: "HEC-RAS model",
  ressim: "HEC-ResSim model",
  storms: "Storm catalog",
};

export type ModelArea = {
  slug: string;
  name: string;
  kind: AreaKind;
  /** The basin the model belongs to, for the second line of the row. */
  basin: string;
  /** The USGS four-digit hydrologic unit the area sits in. See lib/basins.ts. */
  huc4: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** STAC collection id, when this area is (or will be) a collection in the catalog. */
  collection?: string;
  blurb?: string;
  /**
   * Where the pin sits and which side its name hangs off, when the middle of
   * the box and a name to the right would land on a neighbor. Denver has five
   * models inside one degree.
   */
  pin?: [number, number];
  anchor?: "left" | "right" | "top" | "bottom";
};

export const MODEL_AREAS: ModelArea[] = [
  {
    slug: "south-platte-gages",
    name: "South Platte gages",
    kind: "gages",
    basin: "South Platte",
    huc4: "1019",
    bbox: [-106.2, 38.95, -102.9, 41.0],
    collection: "gages",
    blurb: "Every USGS streamgage in the South Platte study area, with its annual maxima series, flow statistics and plots.",
    pin: [-104.55, 40.55],
    anchor: "left",
  },
  {
    slug: "south-platte-hms",
    name: "South Platte HMS",
    kind: "hms",
    basin: "South Platte",
    huc4: "1019",
    bbox: [-106.2, 38.95, -104.4, 40.35],
    collection: "south-platte-hms",
    pin: [-105.6, 39.15],
    anchor: "right",
  },
  {
    slug: "denver-metro-ras",
    name: "Denver metro 2D",
    kind: "ras",
    basin: "South Platte",
    huc4: "1019",
    bbox: [-105.2, 39.5, -104.7, 39.98],
    collection: "denver-metro-ras",
    pin: [-104.85, 39.74],
    anchor: "left",
  },
  {
    slug: "clear-creek-ras",
    name: "Clear Creek",
    kind: "ras",
    basin: "South Platte",
    huc4: "1019",
    bbox: [-105.9, 39.58, -105.02, 39.86],
    collection: "clear-creek-ras",
    pin: [-105.5, 39.72],
    anchor: "right",
  },
  {
    slug: "cache-la-poudre-hms",
    name: "Cache la Poudre",
    kind: "hms",
    basin: "South Platte",
    huc4: "1019",
    bbox: [-105.95, 40.4, -104.85, 40.95],
    collection: "cache-la-poudre-hms",
    pin: [-105.4, 40.75],
    anchor: "bottom",
  },
  {
    slug: "big-thompson-ras",
    name: "Big Thompson",
    kind: "ras",
    basin: "South Platte",
    huc4: "1019",
    bbox: [-105.78, 40.22, -104.95, 40.52],
    collection: "big-thompson-ras",
    pin: [-105.3, 40.37],
    anchor: "left",
  },
  {
    slug: "chatfield-ressim",
    name: "Chatfield and Cherry Creek",
    kind: "ressim",
    basin: "South Platte",
    huc4: "1019",
    bbox: [-105.15, 39.35, -104.55, 39.75],
    collection: "chatfield-ressim",
    pin: [-104.85, 39.5],
    anchor: "left",
  },
  {
    slug: "south-platte-storms",
    name: "South Platte storm catalog",
    kind: "storms",
    basin: "South Platte",
    huc4: "1019",
    bbox: [-106.4, 38.6, -102.4, 41.0],
    collection: "south-platte-storms",
    pin: [-103.6, 40.1],
    anchor: "left",
  },
  {
    slug: "fountain-creek-hms",
    name: "Fountain Creek",
    kind: "hms",
    basin: "Arkansas",
    huc4: "1102",
    bbox: [-105.1, 38.25, -104.45, 39.0],
    collection: "fountain-creek-hms",
    pin: [-104.75, 38.6],
    anchor: "left",
  },
  {
    slug: "upper-arkansas-hms",
    name: "Upper Arkansas",
    kind: "hms",
    basin: "Arkansas",
    huc4: "1102",
    bbox: [-106.5, 38.05, -104.2, 39.25],
    collection: "upper-arkansas-hms",
    pin: [-105.9, 38.55],
    anchor: "left",
  },
  {
    slug: "gunnison-hms",
    name: "Gunnison",
    kind: "hms",
    basin: "Colorado",
    huc4: "1402",
    bbox: [-108.6, 37.9, -106.35, 39.15],
    collection: "gunnison-hms",
  },
  {
    slug: "colorado-headwaters-hms",
    name: "Colorado headwaters",
    kind: "hms",
    basin: "Colorado",
    huc4: "1401",
    bbox: [-107.6, 39.3, -105.55, 40.55],
    collection: "colorado-headwaters-hms",
  },
  {
    slug: "yampa-hms",
    name: "Yampa and White",
    kind: "hms",
    basin: "Colorado",
    huc4: "1405",
    bbox: [-108.9, 39.85, -106.4, 41.0],
    collection: "yampa-hms",
  },
  {
    slug: "rio-grande-hms",
    name: "Rio Grande headwaters",
    kind: "hms",
    basin: "Rio Grande",
    huc4: "1301",
    bbox: [-107.3, 36.99, -105.4, 38.15],
    collection: "rio-grande-hms",
  },
  {
    slug: "animas-ras",
    name: "Animas at Durango",
    kind: "ras",
    basin: "San Juan",
    huc4: "1408",
    bbox: [-108.1, 36.99, -107.4, 37.95],
    collection: "animas-ras",
  },
  {
    slug: "republican-hms",
    name: "Republican",
    kind: "hms",
    basin: "Republican",
    huc4: "1025",
    bbox: [-103.7, 39.2, -102.04, 40.45],
    collection: "republican-hms",
    pin: [-102.9, 39.8],
    anchor: "left",
  },
];
