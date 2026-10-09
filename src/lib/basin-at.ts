import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FeatureCollection, Position } from "geojson";

/**
 * Which HUC4 basin a point falls in, for placing a collection the fixtures
 * don't name. Reads the same polygons the landing page map draws. Null when
 * the point is outside every basin that touches Colorado.
 */

let basins: Promise<{ huc4: string; polys: Position[][][] }[]> | null = null;

function load() {
  basins ??= readFile(path.join(process.cwd(), "public/data/co-huc4.json"), "utf8")
    .then((text) => (JSON.parse(text) as FeatureCollection).features)
    .then((features) =>
      features.map((f) => ({
        huc4: String(f.properties?.huc4),
        polys:
          f.geometry.type === "Polygon"
            ? [f.geometry.coordinates]
            : f.geometry.type === "MultiPolygon"
              ? f.geometry.coordinates
              : [],
      })),
    )
    .catch(() => []);
  return basins;
}

export async function basinAt([x, y]: [number, number]): Promise<string | null> {
  for (const b of await load()) {
    if (b.polys.some((rings) => inside(rings[0], x, y) && !rings.slice(1).some((hole) => inside(hole, x, y)))) {
      return b.huc4;
    }
  }
  return null;
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

/**
 * How much of a basin a box covers, from 0 to 1. The landing page uses it to
 * tell a basin-wide collection (gages, a storm catalog) from a local one: a
 * pin at the middle of a basin-wide collection says nothing, and they all
 * land on the same spot. Measured against the basin's own area rather than
 * its bounding box, since the South Platte's box is mostly the plains tail
 * in Nebraska. Estimated from a grid of points inside the basin.
 */
let samples: Map<string, Promise<[number, number][]>> | null = null;

function samplesOf(huc4: string) {
  samples ??= new Map();
  let s = samples.get(huc4);
  if (!s) {
    s = load().then((all) => {
      const b = all.find((x) => x.huc4 === huc4);
      if (!b) return [];
      const outer = b.polys.map((rings) => rings[0]);
      const xs = outer.flat().map((p) => p[0]);
      const ys = outer.flat().map((p) => p[1]);
      const [w, e, s0, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const step = Math.max(e - w, n - s0) / 120;
      const out: [number, number][] = [];
      for (let x = w + step / 2; x < e; x += step) {
        for (let y = s0 + step / 2; y < n; y += step) {
          if (b.polys.some((rings) => inside(rings[0], x, y) && !rings.slice(1).some((h) => inside(h, x, y)))) out.push([x, y]);
        }
      }
      return out;
    });
    samples.set(huc4, s);
  }
  return s;
}

export async function basinShare(huc4: string, [w, s, e, n]: [number, number, number, number]): Promise<number> {
  const pts = await samplesOf(huc4);
  if (!pts.length) return 0;
  return pts.filter(([x, y]) => x >= w && x <= e && y >= s && y <= n).length / pts.length;
}

/**
 * Whether polygons contain the whole basin: at least 98% of the basin's
 * sample points fall inside some polygon's outer ring and outside its
 * holes. The slack is for edge cells on a coarse grid. The landing page
 * draws such a collection as the basin itself instead of its own shape,
 * which would fill the map.
 */
export async function basinCovered(huc4: string, polys: Position[][][]): Promise<boolean> {
  if (!polys.length) return false;
  const pts = await samplesOf(huc4);
  if (!pts.length) return false;
  const covered = (x: number, y: number) =>
    polys.some((rings) => inside(rings[0], x, y) && !rings.slice(1).some((h) => inside(h, x, y)));
  return pts.filter(([x, y]) => covered(x, y)).length / pts.length >= 0.98;
}
