import "server-only";

import type { Feature, Geometry, Position } from "geojson";
import type { StacItem } from "./stac";

/**
 * What a collection looks like on the landing page map, reduced from its items.
 *
 * Collections differ in what their items are. A gage collection is a few
 * hundred points, one per site, and drawing every one is the point. A model
 * collection is different: its items might be a few thousand simulated
 * events that all share the model's domain, or a hundred subbasins that tile
 * it, or a handful of 2D flow areas and 1D reaches. Drawing those one by one
 * says nothing at state scale, and a circle layer puts a dot on every vertex
 * of a polygon, which reads as fake items.
 *
 * So the map draws each collection by its shape, not its kind:
 *
 * - points: every point item, as a dot.
 * - areas: the distinct polygons, as a faint fill, with an outline that
 *   drops the edges polygons share. Subbasins that tile a model domain then
 *   draw as one domain instead of a mesh. Identical geometries (every event
 *   of one model) are drawn once.
 * - density: when there are many distinct polygons and they mostly sit on
 *   top of each other (a storm catalog's transposition areas), how many
 *   cover each spot, in three steps. Drawn one by one they'd be a solid
 *   blob. The polygons' own outlines come along for when the map is zoomed
 *   in far enough to tell them apart.
 * - extent: when the shapes are too heavy to send to the browser, the
 *   collection's box, dashed, the same as the collection page does.
 *
 * Coordinates are rounded to about 10 m first. That shrinks the payload and
 * makes shared edges match exactly.
 */

export type OverviewShape = "points" | "areas" | "density" | "extent";

export type Overview = {
  shape: OverviewShape | null;
  /**
   * Each feature's `role` says which layer draws it: point, fill, line,
   * extent, density (with a `step` of 1 to 3) or outline.
   */
  features: Feature[];
  /** For density: the count range each step covers, lowest first. */
  steps?: [number, number][];
};

/** Past this many vertices in one collection, draw its box instead. */
const MAX_VERTICES = 40_000;
/** More distinct polygons than this, overlapping heavily, draw as density. */
const DENSITY_MIN = 40;
/** Cells across the longer side of the density grid. About 2 km over the South Platte's storms. */
const DENSITY_CELLS = 160;
const PLACES = 4;

export function overview(items: StacItem[], slug: string, bbox: [number, number, number, number] | null): Overview {
  const points: Position[] = [];
  const polygons = new Map<string, Position[][]>();
  const lines = new Map<string, Position[]>();

  for (const { geometry: g } of items) {
    if (!g) continue;
    for (const part of parts(g)) {
      if (part.type === "Point") points.push(round(part.coordinates));
      else if (part.type === "LineString") {
        const line = clean(part.coordinates);
        lines.set(JSON.stringify(line), line);
      } else {
        const rings = part.coordinates.map(clean).filter((r) => r.length >= 4);
        if (rings.length) polygons.set(JSON.stringify(rings), rings);
      }
    }
  }

  const tag = (role: string, geometry: Geometry): Feature => ({ type: "Feature", properties: { slug, role }, geometry });

  if (!polygons.size && !lines.size) {
    if (!points.length) return { shape: null, features: [] };
    if (points.length <= MAX_VERTICES / 4) {
      return { shape: "points", features: [tag("point", { type: "MultiPoint", coordinates: points })] };
    }
  } else {
    const polys = Array.from(polygons.values());
    const vertices =
      polys.reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0) +
      Array.from(lines.values()).reduce((n, l) => n + l.length, 0);
    if (polys.length > DENSITY_MIN && !lines.size && !points.length) {
      const d = density(polys);
      if (d) {
        const features: Feature[] = d.cells.map((coordinates, i) => {
          const f = tag("density", { type: "MultiPolygon", coordinates });
          f.properties!.step = i + 1;
          return f;
        });
        if (vertices <= MAX_VERTICES) features.push(tag("outline", { type: "MultiLineString", coordinates: polys.map((rings) => rings[0]) }));
        return { shape: "density", features, steps: d.steps };
      }
    }
    if (vertices <= MAX_VERTICES) {
      const features: Feature[] = [];
      if (polys.length) {
        features.push(tag("fill", { type: "MultiPolygon", coordinates: polys }));
        features.push(tag("line", { type: "MultiLineString", coordinates: outline(polys) }));
      }
      if (lines.size) features.push(tag("line", { type: "MultiLineString", coordinates: Array.from(lines.values()) }));
      // A collection with both shapes (gages beside a model, say) keeps its dots.
      if (points.length) features.push(tag("point", { type: "MultiPoint", coordinates: points }));
      return { shape: "areas", features };
    }
  }

  if (!bbox) return { shape: null, features: [] };
  const [w, s, e, n] = bbox;
  return {
    shape: "extent",
    features: [tag("extent", { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] })],
  };
}

/**
 * How many polygons cover each cell of a grid over them, binned into three
 * steps at the terciles of the nonzero counts. Null when the polygons don't
 * overlap much (their union is more than a third of their summed area),
 * since then the plain fill reads fine. Each step comes back as a
 * MultiPolygon of row runs, so the payload is one rectangle per run rather
 * than one per cell.
 */
function density(polys: Position[][][]): { cells: Position[][][][]; steps: [number, number][] } | null {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polys) for (const [x, y] of rings[0]) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  const size = Math.max(e - w, n - s) / DENSITY_CELLS;
  if (!(size > 0)) return null;
  const cols = Math.ceil((e - w) / size);
  const rows = Math.ceil((n - s) / size);
  const count = new Uint16Array(cols * rows);
  for (const rings of polys) {
    const outer = rings[0];
    const xs = outer.map((p) => p[0]);
    const ys = outer.map((p) => p[1]);
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - w) / size));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(...xs) - w) / size));
    const r0 = Math.max(0, Math.floor((Math.min(...ys) - s) / size));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(...ys) - s) / size));
    for (let r = r0; r <= r1; r++) {
      const y = s + (r + 0.5) * size;
      for (let c = c0; c <= c1; c++) {
        const x = w + (c + 0.5) * size;
        if (inside(outer, x, y) && !rings.slice(1).some((h) => inside(h, x, y))) count[r * cols + c]++;
      }
    }
  }
  let union = 0;
  let sum = 0;
  const nonzero: number[] = [];
  for (const v of count) {
    if (!v) continue;
    union++;
    sum += v;
    nonzero.push(v);
  }
  if (!union || union > sum / 3) return null;

  nonzero.sort((a, b) => a - b);
  const max = nonzero[nonzero.length - 1];
  const t1 = Math.max(1, nonzero[Math.floor(nonzero.length / 3)]);
  const t2 = Math.max(t1 + 1, nonzero[Math.floor((nonzero.length * 2) / 3)]);
  const steps: [number, number][] = [[1, t1], [t1 + 1, t2], [t2 + 1, Math.max(t2 + 1, max)]];
  const stepOf = (v: number) => (v <= t1 ? 0 : v <= t2 ? 1 : 2);

  const cells: Position[][][][] = [[], [], []];
  const k = 10 ** PLACES;
  const at = (v: number) => Math.round(v * k) / k;
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const v = count[r * cols + c];
      if (!v) {
        c++;
        continue;
      }
      const step = stepOf(v);
      let end = c + 1;
      while (end < cols && count[r * cols + end] && stepOf(count[r * cols + end]) === step) end++;
      const [x0, x1, y0, y1] = [at(w + c * size), at(w + end * size), at(s + r * size), at(s + (r + 1) * size)];
      cells[step].push([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]);
      c = end;
    }
  }
  return { cells, steps };
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

type Part =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };

function parts(g: Geometry): Part[] {
  switch (g.type) {
    case "Point":
    case "LineString":
    case "Polygon":
      return [g as Part];
    case "MultiPoint":
      return g.coordinates.map((c) => ({ type: "Point", coordinates: c }));
    case "MultiLineString":
      return g.coordinates.map((c) => ({ type: "LineString", coordinates: c }));
    case "MultiPolygon":
      return g.coordinates.map((c) => ({ type: "Polygon", coordinates: c }));
    case "GeometryCollection":
      return g.geometries.flatMap(parts);
  }
}

function round(p: Position): Position {
  const k = 10 ** PLACES;
  return [Math.round(p[0] * k) / k, Math.round(p[1] * k) / k];
}

/** Rounded, with the repeats that rounding makes dropped. */
function clean(ring: Position[]): Position[] {
  const out: Position[] = [];
  for (const p of ring) {
    const r = round(p);
    const last = out[out.length - 1];
    if (!last || last[0] !== r[0] || last[1] !== r[1]) out.push(r);
  }
  return out;
}

/**
 * The outer edges of a set of polygons: every edge that only one polygon
 * has. Where polygons tile an area and share vertices, the inside edges
 * cancel and what's left is the boundary. Where they don't share vertices
 * exactly, the inside edges stay, which is a busier drawing but not a wrong
 * one.
 */
function outline(polys: Position[][][]): Position[][] {
  const edges = new Map<string, { a: Position; b: Position; n: number }>();
  for (const rings of polys) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        const ka = `${a[0]},${a[1]}`;
        const kb = `${b[0]},${b[1]}`;
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const e = edges.get(key);
        if (e) e.n++;
        else edges.set(key, { a, b, n: 1 });
      }
    }
  }
  // Chain the surviving edges back into lines so the payload isn't one
  // two-point segment per edge.
  const kept = Array.from(edges.values()).filter((e) => e.n === 1);
  const from = new Map<string, number[]>();
  kept.forEach((e, i) => {
    for (const p of [e.a, e.b]) {
      const k = `${p[0]},${p[1]}`;
      (from.get(k) ?? from.set(k, []).get(k)!).push(i);
    }
  });
  const used = new Uint8Array(kept.length);
  const out: Position[][] = [];
  for (let i = 0; i < kept.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [kept[i].a, kept[i].b];
    for (;;) {
      const end = line[line.length - 1];
      const next = from.get(`${end[0]},${end[1]}`)?.find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      const e = kept[next];
      line.push(e.a[0] === end[0] && e.a[1] === end[1] ? e.b : e.a);
    }
    out.push(line);
  }
  return out;
}
