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
 * - extent: when the shapes are too heavy to send to the browser, the
 *   collection's box, dashed, the same as the collection page does.
 *
 * Coordinates are rounded to about 10 m first. That shrinks the payload and
 * makes shared edges match exactly.
 */

export type OverviewShape = "points" | "areas" | "extent";

export type Overview = {
  shape: OverviewShape | null;
  /** Each feature's `role` says which layer draws it: point, fill, line or extent. */
  features: Feature[];
};

/** Past this many vertices in one collection, draw its box instead. */
const MAX_VERTICES = 40_000;
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
