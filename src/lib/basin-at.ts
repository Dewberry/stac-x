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
