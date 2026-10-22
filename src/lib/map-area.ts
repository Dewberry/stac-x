import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Position } from "geojson";

/**
 * The area a deployment is about, from STAC_MAP_AREA: a GeoJSON file of
 * polygons (a geometry, a Feature or a FeatureCollection, in WGS84), read
 * once. The landing page map opens on it, outlines it and dims everything
 * outside, and a collection that covers all of it says so. Several polygons
 * are one area. STAC_MAP_AREA_NAME is what the page calls it ("Fit to the
 * South Platte basin"), else the file's `name` property.
 *
 * Unset or unreadable, there's no area: the map opens on what the catalog
 * covers and draws no outline.
 */

export type Bbox = [number, number, number, number];

export type MapArea = {
  name: string;
  geometry: MultiPolygon;
  bbox: Bbox;
};

let cached: { area: MapArea | null } | null = null;

export function mapArea(): MapArea | null {
  cached ??= { area: load() };
  return cached.area;
}

function load(): MapArea | null {
  const file = process.env.STAC_MAP_AREA?.trim();
  if (!file) return null;
  let doc: Geometry | Feature | FeatureCollection;
  try {
    doc = JSON.parse(readFileSync(/*turbopackIgnore: true*/ path.resolve(file), "utf8"));
  } catch (e) {
    console.error(`STAC_MAP_AREA: couldn't read ${file}`, e);
    return null;
  }
  const features: Feature[] =
    doc.type === "FeatureCollection" ? doc.features : doc.type === "Feature" ? [doc] : [{ type: "Feature", properties: {}, geometry: doc }];
  const polys = features.flatMap((f): Position[][][] =>
    f.geometry?.type === "Polygon" ? [f.geometry.coordinates] : f.geometry?.type === "MultiPolygon" ? f.geometry.coordinates : [],
  );
  if (!polys.length) {
    console.error(`STAC_MAP_AREA: ${file} has no polygons`);
    return null;
  }
  const named = features.map((f) => f.properties?.name).find((n): n is string => typeof n === "string" && !!n.trim());
  return {
    name: process.env.STAC_MAP_AREA_NAME?.trim() || named || "the mapped area",
    geometry: { type: "MultiPolygon", coordinates: polys },
    bbox: bboxOf(polys.flat(2)),
  };
}

function bboxOf(pts: Position[]): Bbox {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The lower 48, for a map with no area and nothing in the catalog to frame, or nothing it can trust. */
export const LOWER_48: Bbox = [-124.8, 24.5, -66.9, 49.4];

/** How many times the median collection's box one can be before it's left out of the frame. */
const OUTSIZED = 50;
/** Square degrees a box has to pass to be left out: about 20 by 20, more than any state in the lower 48. */
const OUTSIZED_MIN = 400;
/** The smallest frame, in degrees, so a catalog of one gage doesn't open at street level. */
const MIN_SPAN = 0.2;

/**
 * Where the landing page map opens: the area, else every collection's box
 * together, else the lower 48. A box that's both continent-sized and more
 * than 50 times the median one is left out: a national inventory's box, or
 * the [-180, -90, 180, 90] catalogs use when they don't know, would
 * otherwise open the map on the whole country or the globe with the rest of
 * the catalog a speck in it. A box that crosses the 180th meridian (west
 * greater than east) counts as world-wide, since a frame can't wrap.
 */
export function mapFrame(area: MapArea | null, boxes: (Bbox | null)[]): Bbox {
  if (area) return area.bbox;
  const all = boxes.filter((b): b is Bbox => !!b).map((b): Bbox => (b[0] > b[2] ? [-180, b[1], 180, b[3]] : b));
  if (!all.length) return LOWER_48;
  const size = (b: Bbox) => (b[2] - b[0]) * (b[3] - b[1]);
  const sizes = all.map(size).sort((a, b) => a - b);
  const median = sizes[Math.floor((sizes.length - 1) / 2)];
  const known = all.filter((b) => size(b) <= Math.max(median * OUTSIZED, OUTSIZED_MIN));
  let [w, s, e, n]: Bbox = [
    Math.min(...known.map((b) => b[0])),
    Math.max(-85, Math.min(...known.map((b) => b[1]))),
    Math.max(...known.map((b) => b[2])),
    Math.min(85, Math.max(...known.map((b) => b[3]))),
  ];
  if (e - w < MIN_SPAN) [w, e] = [(w + e) / 2 - MIN_SPAN / 2, (w + e) / 2 + MIN_SPAN / 2];
  if (n - s < MIN_SPAN) [s, n] = [(s + n) / 2 - MIN_SPAN / 2, (s + n) / 2 + MIN_SPAN / 2];
  return [w, s, e, n];
}

/** Ray casting. */
function inside(ring: Position[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function inPolys(polys: Position[][][], x: number, y: number): boolean {
  return polys.some((rings) => inside(rings[0], x, y) && !rings.slice(1).some((hole) => inside(hole, x, y)));
}

/** Whether a point is in the area, for lighting up its outline when a collection there is picked. */
export function inArea(area: MapArea, [x, y]: [number, number]): boolean {
  return inPolys(area.geometry.coordinates, x, y);
}

/**
 * A grid of points inside the area, for measuring how much of it something
 * covers against the area itself rather than its bounding box, which can be
 * mostly empty (the South Platte's is mostly its plains tail in Nebraska).
 */
const samples = new WeakMap<MapArea, [number, number][]>();

function samplesOf(area: MapArea): [number, number][] {
  let out = samples.get(area);
  if (out) return out;
  out = [];
  const [w, s, e, n] = area.bbox;
  const step = Math.max(e - w, n - s) / 120;
  for (let x = w + step / 2; x < e; x += step) {
    for (let y = s + step / 2; y < n; y += step) {
      if (inPolys(area.geometry.coordinates, x, y)) out.push([x, y]);
    }
  }
  samples.set(area, out);
  return out;
}

/**
 * How much of the area a box covers, from 0 to 1. The landing page uses it
 * to tell an area-wide collection (gages, a storm catalog) from a local one.
 */
export function areaShare(area: MapArea, [w, s, e, n]: Bbox): number {
  const pts = samplesOf(area);
  if (!pts.length) return 0;
  return pts.filter(([x, y]) => x >= w && x <= e && y >= s && y <= n).length / pts.length;
}

/**
 * Whether polygons contain the whole area: at least 98% of its sample points
 * fall inside them. The slack is for edge cells on a coarse grid. The
 * landing page draws such a collection as the area itself instead of its own
 * shape, which would fill the map.
 */
export function areaCovered(area: MapArea, polys: Position[][][]): boolean {
  if (!polys.length) return false;
  const pts = samplesOf(area);
  if (!pts.length) return false;
  return pts.filter(([x, y]) => inPolys(polys, x, y)).length / pts.length >= 0.98;
}

export type AreaOutline = { d: string; viewBox: string };

/**
 * The area's outline as an SVG path, for the landing page while the catalog
 * loads. The catalog can take seconds to read from S3, so the loading state
 * traces the area where the map will be. Projected flat with longitude
 * scaled by the cosine of the middle latitude so the shape keeps its
 * proportions.
 */
export function areaOutline(area: MapArea): AreaOutline {
  const polys = area.geometry.coordinates;
  const [w, s, e, n] = area.bbox;
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const x = (lon: number) => ((lon - w) * k * 100).toFixed(1);
  const y = (lat: number) => ((n - lat) * 100).toFixed(1);
  const d = polys
    .flatMap((rings) => rings.map((ring) => "M" + ring.map((p) => `${x(p[0])} ${y(p[1])}`).join("L") + "Z"))
    .join("");
  // Some room around the shape, like the map's fit padding.
  const width = (e - w) * k * 100;
  const height = (n - s) * 100;
  const pad = Math.max(width, height) * 0.06;
  return { d, viewBox: `${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}` };
}
