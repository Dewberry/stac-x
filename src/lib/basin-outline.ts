import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import type { FeatureCollection, Position } from "geojson";
import { FOCUS_BASIN } from "./basins";

/**
 * The South Platte's outline as an SVG path, for the landing page while the
 * catalog loads. The map can't draw until the browser has it, and the
 * catalog can take seconds to read from S3, so the loading state shows the
 * basin itself, traced, where the map will be. Read once from the same
 * polygons the map draws, projected flat with longitude scaled by the
 * cosine of the middle latitude so the shape keeps its proportions.
 */

export type BasinOutline = { d: string; viewBox: string };

let cached: BasinOutline | null = null;

export function basinOutline(): BasinOutline {
  if (cached) return cached;
  const fc = JSON.parse(readFileSync(path.join(process.cwd(), "public/data/co-huc4.json"), "utf8")) as FeatureCollection;
  const f = fc.features.find((x) => String(x.properties?.huc4) === FOCUS_BASIN);
  const polys: Position[][][] =
    f?.geometry.type === "Polygon" ? [f.geometry.coordinates] : f?.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
  const pts = polys.flat(2);
  if (!pts.length) return (cached = { d: "", viewBox: "0 0 1 1" });
  const lats = pts.map((p) => p[1]);
  const lons = pts.map((p) => p[0]);
  const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
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
  return (cached = { d, viewBox: `${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}` });
}
