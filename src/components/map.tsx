"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  Popup,
} from "maplibre-gl";
import type { FeatureCollection, MultiPolygon, Position } from "geojson";
import type { Symbology } from "@/lib/symbology";
import { Icon, ICONS } from "./icons";
import { MapCard } from "./map-card";
import {
  applyBasemap,
  AREA_LINE,
  areaData,
  blankStyle,
  Controls,
  creditsOf,
  dressBasemap,
  ifColored,
  lineColor,
  lineWidth,
  MapCredits,
  outsideArea,
  palette,
  tintColor,
  tintOpacity,
  watchTheme,
  WORKER_URL,
  type Credit,
  type Palette,
} from "./map-core";

/**
 * The map on every page.
 *
 * It draws one GeoJSON feature collection and fits itself to it. Pointing at
 * a feature lights it up and names it beside the cursor; clicking one that
 * has a page opens a card (map-card.tsx, the same as the landing map's) with
 * a row per item under the click, each the way to its page. A terrain
 * collection is dozens of tiles that all look alike and overlap, and a
 * calibration collection stacks two models on one basin, so the tooltip names
 * everything under the cursor and the card lists the whole stack. On an item
 * page the only feature is the page's own, so a click there opens nothing.
 * Points and lines are river blue, the color for
 * data in this app, except a line item that asks for a color and weight of
 * its own (lib/symbology.ts); polygon outlines are drawn in ink, with an extent box
 * dashed so it never reads as data. Lines are thin and a little see-through
 * while zoomed out: a basin's stream network is thousands of them, and at
 * the width an outline gets they ran together into one dark shape.
 *
 * MapLibre because the program's collections will run to tens of thousands of
 * points, which rules out a DOM marker each, and because a GeoJSON source
 * today can become PMTiles from the bucket tomorrow with the layers unchanged.
 *
 * The basemap is OpenStreetMap through OpenFreeMap, one quiet style per
 * palette, no key and no cap, dressed in the app's colors the same way the
 * landing map is. If it can't be fetched the features still draw over a
 * plain ground and the readout says so.
 *
 * An item whose geometry was simplified (lib/simplified.ts) says so wherever
 * it's named: in the tooltip while it's pointed at, on its row in the card
 * once it's clicked, and in a note that stays on the map when it's the item
 * the page is about. It's said for each item, since one collection can hold
 * simplified shapes beside full ones.
 *
 * Given the deployment's area (lib/map-area.ts), the map draws it under the
 * data the way the landing map does: its outline in ink, everything outside
 * it under the sand wash. The map still opens on the data, which for a
 * national collection is far wider than the area, so a pill in the corner
 * goes to the area, and from there back to the data.
 */

export type MapProps = {
  data: FeatureCollection;
  /** Bounds to fit, when the features alone don't say (an empty collection with a known extent). */
  bbox?: [number, number, number, number] | null;
  /** Feature id to ring. */
  selected?: string | null;
  /** A feature pointed at elsewhere on the page (the items list), to light up here. */
  hovered?: string | null;
  /** Told which feature the cursor is on, so a list can light its row up. */
  onHover?: (id: string | null) => void;
  /** What the map is of, for assistive tech. */
  label: string;
  /** Readout text before anything is hovered. */
  hint?: string;
  /** How to use the features, said once, beside the first one pointed at. */
  tip?: string;
  /** The deployment's area, outlined under the data with a button that goes to it. */
  area?: { name: string; geometry: MultiPolygon; bbox: [number, number, number, number] } | null;
  /** What the pill calls the data when it goes back to it from the area. */
  dataName?: string;
};

export type MapFeatureProps = {
  id: string;
  href?: string;
  label?: string;
  /** What kind of item, when a collection mixes kinds that share names ("HEC-HMS"). */
  tag?: string;
  /** Which of the three blues to draw it in, when the collection has few enough shapes to color. */
  tint?: 1 | 2 | 3;
  /** "extent" draws a dashed box instead of a filled shape. */
  kind?: "extent" | "feature";
  /** Its geometry is a simplified one (lib/simplified.ts). */
  simplified?: boolean;
} & Symbology; // The color and weight its item asks for (lib/symbology.ts), on a line.

const SRC = "sx-data";
/** The stretch of line under the cursor, drawn over the data while hovering. */
const SRC_HOVER = "sx-hover";
const SRC_AREA = "sx-area";
const SRC_MASK = "sx-mask";
const L = {
  mask: "sx-outside-mask",
  areaLine: "sx-area-line",
  extentFill: "sx-extent-fill",
  extentLine: "sx-extent-line",
  fill: "sx-fill",
  line: "sx-line",
  lineData: "sx-line-data",
  hiFill: "sx-hi-fill",
  hiLine: "sx-hi-line",
  hiLineData: "sx-hi-line-data",
  hoverLine: "sx-hover-line",
  points: "sx-points",
  selected: "sx-selected",
};
const INTERACTIVE = [L.points, L.lineData, L.line, L.fill, L.extentFill];
const FIT = { padding: 36, maxZoom: 12, duration: 0 };
/** How far around the cursor, in pixels, counts as pointing at a feature. */
const HIT = 4;
/**
 * How long, in milliseconds, the cursor can be on nothing before the hover
 * lets go. Thin lines leave gaps of a pixel or two between them, and
 * letting go at once made the highlight strobe as the cursor crossed them.
 */
const LET_GO_MS = 150;
/** The most names the tooltip lists before "and N more". */
const TIP_ROWS = 6;

/** Everything under the cursor, top first. */
type Hover = { hits: MapFeatureProps[]; x: number; y: number; flip: boolean };
/** What a click landed on: every feature under the point that has a page. */
type Pin = { hits: (MapFeatureProps & { href: string })[]; at: [number, number] };

function boundsOf(data: FeatureCollection, bbox?: MapProps["bbox"]): LngLatBoundsLike | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const take = (x: number, y: number) => {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  };
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number") take(c[0], c[1]);
    else c.forEach(walk);
  };
  for (const f of data.features) {
    if (f.bbox) { take(f.bbox[0], f.bbox[1]); take(f.bbox[2], f.bbox[3]); continue; }
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "GeometryCollection") g.geometries.forEach((x) => walk((x as { coordinates: unknown }).coordinates));
    else walk(g.coordinates);
  }
  if (bbox) { take(bbox[0], bbox[1]); take(bbox[2], bbox[3]); }
  if (!isFinite(w)) return null;
  if (e - w < 0.01 && n - s < 0.01) return [[w - 0.03, s - 0.02], [e + 0.03, n + 0.02]];
  return [[w, s], [e, n]];
}

const poly: ExpressionSpecification = ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]];
const line: ExpressionSpecification = ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "MultiLineString"]];
const point: ExpressionSpecification = ["any", ["==", ["geometry-type"], "Point"], ["==", ["geometry-type"], "MultiPoint"]];
/** A lit line's width over a line of this base width: its own for a plain line, 1.75px more for one with a color. */
function lit(base: number): ExpressionSpecification {
  return ["+", lineWidth(base), ifColored(1.75, 0)];
}
/** The hover line's width: `width`, or a pixel more than the line under it when that's heavier. */
function over(width: number, base: number): ExpressionSpecification {
  return ["max", width, ["+", lineWidth(base), 1]];
}
const isExtent: ExpressionSpecification = ["==", ["get", "kind"], "extent"];
const notExtent: ExpressionSpecification = ["!=", ["get", "kind"], "extent"];

/** Matches the features with one of these ids; the blanks are dropped. */
function idsIn(ids: (string | null | undefined)[]): ExpressionSpecification {
  return ["in", ["get", "id"], ["literal", ids.filter((x): x is string => !!x)]];
}

/**
 * The ring around a selected, hovered or pinned feature, for points only: a
 * circle layer over a polygon draws a ring at every vertex, which turned a
 * watershed's outline into a chain of circles. Shapes get the highlight
 * layers instead.
 */
function selectedFilter(ids: (string | null | undefined)[]): ExpressionSpecification {
  return ["all", point, idsIn(ids)];
}

/** Every feature within a few pixels of the point, once each, top first. */
/**
 * The lines within a few pixels of the point, each part of a MultiLineString
 * on its own. A line item can be a whole basin's streams, so lighting up
 * the item would light up the basin; the reach under the cursor is what
 * someone pointing at the map means.
 */
function linesNear(m: MapLibreMap, at: { x: number; y: number }): NearLine[] {
  const out: NearLine[] = [];
  const box: [[number, number], [number, number]] = [[at.x - HIT, at.y - HIT], [at.x + HIT, at.y + HIT]];
  for (const f of m.queryRenderedFeatures(box, { layers: [L.lineData] })) {
    const g = f.geometry;
    const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    for (const part of parts) {
      let prev: { x: number; y: number } | null = null;
      for (const c of part) {
        const q = m.project(c as [number, number]);
        if (prev && distToSegment(at, prev, q) <= HIT) {
          const { color, colorDark, size } = f.properties as MapFeatureProps;
          out.push({ part, style: { color, colorDark, size } });
          break;
        }
        prev = q;
      }
    }
  }
  return out;
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A reach under the cursor and the symbology of the item it's from. */
type NearLine = { part: Position[]; style: Symbology };

function hoverData(near: NearLine[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    // JSON drops the ones that aren't set, so `has` in the paint still tells them apart.
    features: near.map(({ part, style }) => ({ type: "Feature", properties: JSON.parse(JSON.stringify(style)), geometry: { type: "LineString", coordinates: part } })),
  };
}

function hitsAt(m: MapLibreMap, at: { x: number; y: number }): MapFeatureProps[] {
  const layers = INTERACTIVE.filter((l) => m.getLayer(l));
  const seen = new Set<string>();
  const hits: MapFeatureProps[] = [];
  for (const h of m.queryRenderedFeatures([[at.x - HIT, at.y - HIT], [at.x + HIT, at.y + HIT]], { layers })) {
    const props = h.properties as MapFeatureProps;
    if (!seen.has(props.id)) {
      seen.add(props.id);
      hits.push(props);
    }
  }
  return hits;
}

function addLayers(
  map: MapLibreMap,
  p: Palette,
  data: FeatureCollection,
  hi: (string | null | undefined)[],
  lineHi: (string | null | undefined)[],
  selected: string | null,
  area: MultiPolygon | null,
) {
  map.addSource(SRC, { type: "geojson", data, promoteId: "id" });

  // The area first, so the data draws over its wash and its outline.
  if (area) {
    map.addSource(SRC_MASK, { type: "geojson", data: outsideArea(area) });
    map.addSource(SRC_AREA, { type: "geojson", data: areaData(area) });
    map.addLayer({
      id: L.mask, type: "fill", source: SRC_MASK,
      paint: { "fill-color": p.mapSurround, "fill-opacity": 1 },
    });
    map.addLayer({
      id: L.areaLine, type: "line", source: SRC_AREA,
      layout: { "line-join": "round" },
      paint: { "line-color": p.ink, "line-width": AREA_LINE.width, "line-opacity": AREA_LINE.opacity },
    });
  }

  map.addLayer({
    id: L.extentFill, type: "fill", source: SRC, filter: ["all", isExtent, poly],
    paint: { "fill-color": p.trace, "fill-opacity": 0.08 },
  });
  map.addLayer({
    id: L.extentLine, type: "line", source: SRC, filter: ["all", isExtent, poly],
    paint: { "line-color": p.inkMut, "line-width": 1.25, "line-dasharray": [2, 2] },
  });
  // A few stacked shapes each get one of the three blues; see tintColor.
  map.addLayer({
    id: L.fill, type: "fill", source: SRC, filter: ["all", notExtent, poly],
    paint: { "fill-color": tintColor(p), "fill-opacity": tintOpacity(0.18) },
  });
  map.addLayer({
    id: L.line, type: "line", source: SRC, filter: ["all", notExtent, poly],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": p.inkSec, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 14, 2.5] },
  });
  // Line data (streams, connectors) on its own: hairlines while zoomed out
  // so a dense network reads as a network, and slightly see-through so
  // where lines crowd together shows darker.
  map.addLayer({
    id: L.lineData, type: "line", source: SRC, filter: ["all", notExtent, line],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": lineColor(p, p.trace),
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, lineWidth(0.4), 9, lineWidth(0.8), 14, lineWidth(1.75)],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 12, 0.9],
    },
  });
  // The hovered and pinned shapes, drawn again on top so their outline isn't
  // lost under the neighbors they overlap.
  map.addLayer({
    id: L.hiFill, type: "fill", source: SRC, filter: ["all", notExtent, poly, idsIn(hi)],
    paint: { "fill-color": tintColor(p), "fill-opacity": 0.3 },
  });
  map.addLayer({
    id: L.hiLine, type: "line", source: SRC, filter: ["all", notExtent, poly, idsIn(hi)],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": p.ink, "line-width": 2 },
  });
  // A line item pointed at in the list or clicked deepens a step, at its
  // own width, rather than going to 2px ink: one item can be a whole stream
  // network, and redrawing all of it that heavy turned the basin black.
  // Hovering the map doesn't use this; it lights the reach under the cursor.
  map.addLayer({
    id: L.hiLineData, type: "line", source: SRC, filter: ["all", notExtent, line, idsIn(lineHi)],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      // A line with a color of its own keeps it and thickens, since a deeper
      // blue over it wouldn't read as the same line.
      "line-color": lineColor(p, p.traceDeep),
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, lit(0.4), 9, lit(0.8), 14, lit(1.75)],
      "line-opacity": ifColored(1, 0.5),
    },
  });
  map.addSource(SRC_HOVER, { type: "geojson", data: hoverData([]) });
  map.addLayer({
    id: L.hoverLine, type: "line", source: SRC_HOVER,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": lineColor(p, p.traceDeep),
      // Heavier than the line under it, however heavy its item asked for.
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, over(2, 0.4), 9, over(2.5, 0.8), 14, over(3.5, 1.75)],
    },
  });
  map.addLayer({
    id: L.points, type: "circle", source: SRC, filter: ["all", notExtent, point],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 12, 7],
      "circle-color": p.trace,
      "circle-stroke-color": p.surface,
      "circle-stroke-width": 1.25,
      "circle-opacity": 0.95,
    },
  });
  map.addLayer({
    id: L.selected, type: "circle", source: SRC, filter: selectedFilter([selected, ...hi]),
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 12, 13],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": p.ink,
      "circle-stroke-width": 1.5,
    },
  });
}

export function DataMap({ data, bbox, selected = null, hovered = null, onHover, label, hint, tip, area = null, dataName = "the data" }: MapProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  // Where the card renders: a div the popup owns, portaled into from React.
  const [pinHost, setPinHost] = useState<HTMLDivElement | null>(null);
  // The tip shows with the first feature hovered, then gets out of the way.
  const [tipped, setTipped] = useState(false);
  const tipRef = useRef(tip);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [basemapDown, setBasemapDown] = useState(false);
  // Set when the map couldn't be built at all (no WebGL, the library didn't
  // load), and thrown below so MapBoundary shows in the map's place.
  const [failed, setFailed] = useState<unknown>(null);
  // Whether the map is framed to the area, so the pill offers the way back.
  const [onArea, setOnArea] = useState(false);
  // Set by a fit to the area and read when that move ends.
  const toAreaRef = useRef(false);
  const areaRef = useRef(area);
  // What to light up: everything under the cursor, everything in the card,
  // and the one pointed at in the list. As a string so the effect below can
  // watch it.
  const hiKey = JSON.stringify([...(hover?.hits.map((h) => h.id) ?? []), ...(pin?.hits.map((h) => h.id) ?? []), hovered]);
  // Line items light up whole only from the card and the list. Under the
  // cursor it's the reach being pointed at (linesNear), not the item, and
  // the list echoes the map's hover back as `hovered`, so that's left out
  // while it's the same item.
  const fromList = hovered && !hover?.hits.some((h) => h.id === hovered) ? hovered : null;
  const lineHiKey = JSON.stringify([...(pin?.hits.map((h) => h.id) ?? []), fromList]);
  // Latest props, readable from the one-time map setup below without
  // rebuilding the map. Written in an effect, never during render.
  const dataRef = useRef(data);
  const bboxRef = useRef(bbox);
  const selectedRef = useRef(selected);
  const hiRef = useRef<(string | null | undefined)[]>([]);
  const lineHiRef = useRef<(string | null | undefined)[]>([]);
  const onHoverRef = useRef(onHover);
  useEffect(() => {
    dataRef.current = data;
    bboxRef.current = bbox;
    selectedRef.current = selected;
    areaRef.current = area;
    hiRef.current = JSON.parse(hiKey);
    lineHiRef.current = JSON.parse(lineHiKey);
    onHoverRef.current = onHover;
    tipRef.current = tipped ? undefined : tip;
  });

  useEffect(() => {
    const frame = frameRef.current;
    const host = canvasRef.current;
    if (!frame || !host) return;
    let map: MapLibreMap | null = null;
    let disposed = false;
    let unwatch: (() => void) | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPin(null);
    };
    frame.addEventListener("keydown", onKey);

    void import("maplibre-gl").then((maplibregl) => {
      if (disposed) return;
      maplibregl.setWorkerUrl(WORKER_URL);
      const p = palette(frame);
      const m = new maplibregl.Map({
        container: host,
        style: blankStyle(p),
        attributionControl: false,
        center: [-105.5, 39.2],
        zoom: 6,
        maxZoom: 18,
        cooperativeGestures: matchMedia("(pointer: coarse)").matches,
      });
      map = m;
      mapRef.current = m;
      // A handle for the console while developing: __sxMap.getStyle(), etc.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __sxMap?: unknown }).__sxMap = m;

      const pinDiv = document.createElement("div");
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        maxWidth: "none",
        className: "ffx-map-pin sx-map-card",
      }).setDOMContent(pinDiv);
      setPinHost(pinDiv);

      const fit = () => {
        const b = boundsOf(dataRef.current, bboxRef.current);
        if (b) m.fitBounds(b, FIT);
      };
      // The pill says where the map is: on the area after a fit to it, and
      // not after any other move, by hand or by a button.
      m.on("moveend", () => {
        setOnArea(toAreaRef.current);
        toAreaRef.current = false;
      });
      m.addControl(new Controls(m, frame, fit), "top-right");
      m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

      const draw = () => {
        if (m.getSource(SRC)) return;
        const p = palette(frame);
        dressBasemap(m, p);
        addLayers(m, p, dataRef.current, hiRef.current, lineHiRef.current, selectedRef.current, areaRef.current?.geometry ?? null);
        setCredits(creditsOf(m));
      };
      const basemap = () => applyBasemap(m, frame, draw, setBasemapDown, () => disposed);

      m.on("load", () => {
        draw();
        fit();
        basemap();
      });
      m.on("sourcedata", () => setCredits(creditsOf(m)));

      // Hover goes by what's within HIT pixels of the cursor, not by the
      // layers' own enter and leave events, which only see the one pixel
      // under it: on a hairline stream that's a miss most of the time. And
      // it lets go a moment after the cursor lands on nothing (LET_GO_MS),
      // so crossing the gap between two lines doesn't drop it.
      const canvas = m.getCanvas();
      let hovering = false;
      let letGo: ReturnType<typeof setTimeout> | undefined;
      const showLines = (parts: NearLine[]) => (m.getSource(SRC_HOVER) as GeoJSONSource | undefined)?.setData(hoverData(parts));
      const release = () => {
        clearTimeout(letGo);
        if (!hovering || disposed) return;
        hovering = false;
        showLines([]);
        canvas.style.cursor = "";
        setHover(null);
        onHoverRef.current?.(null);
        if (tipRef.current) setTipped(true);
      };
      m.on("mousemove", (e) => {
        const hits = hitsAt(m, e.point);
        if (!hits.length) {
          if (hovering && letGo === undefined) letGo = setTimeout(() => { letGo = undefined; release(); }, LET_GO_MS);
          return;
        }
        clearTimeout(letGo);
        letGo = undefined;
        hovering = true;
        showLines(linesNear(m, e.point));
        // Pointer only where a click opens a card.
        canvas.style.cursor = hits.some((h) => h.href) ? "pointer" : "";
        // The tooltip sits to the right of the cursor unless that would run it off the map.
        const flip = e.point.x > canvas.clientWidth - 300;
        setHover({ hits, x: e.point.x, y: e.point.y, flip });
        onHoverRef.current?.(hits[0].id);
      });
      m.on("mouseout", release);
      m.on("click", (e) => {
        const hits = hitsAt(m, e.point).filter((h): h is Pin["hits"][number] => !!h.href);
        setPin(hits.length ? { hits, at: e.lngLat.toArray() as [number, number] } : null);
      });

      unwatch = watchTheme(() => {
        if (m.getSource(SRC)) {
          for (const id of Object.values(L)) if (m.getLayer(id)) m.removeLayer(id);
          for (const id of [SRC, SRC_HOVER, SRC_AREA, SRC_MASK]) if (m.getSource(id)) m.removeSource(id);
        }
        basemap();
      });
    }).catch((e: unknown) => {
      if (!disposed) setFailed(e ?? new Error("The map couldn't be built"));
    });

    return () => {
      disposed = true;
      frame.removeEventListener("keydown", onKey);
      unwatch?.();
      popupRef.current?.remove();
      popupRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // The map is built once; data and selection updates go through the effects below.
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    const src = m?.getSource(SRC) as GeoJSONSource | undefined;
    if (src) src.setData(data);
    // Child previews replace the collection without rebuilding the map. Frame
    // each collection, including the parent's items when the pointer leaves.
    if (m) {
      const bounds = boundsOf(data, bbox);
      if (bounds) m.fitBounds(bounds, { ...FIT, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 750 });
    }
  }, [data, bbox]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.hiLine)) return;
    const hi = JSON.parse(hiKey) as (string | null)[];
    m.setFilter(L.hiFill, ["all", notExtent, poly, idsIn(hi)]);
    m.setFilter(L.hiLine, ["all", notExtent, poly, idsIn(hi)]);
    m.setFilter(L.hiLineData, ["all", notExtent, line, idsIn(JSON.parse(lineHiKey) as (string | null)[])]);
    m.setFilter(L.selected, selectedFilter([selected, ...hi]));
  }, [selected, hiKey, lineHiKey]);

  useEffect(() => {
    const m = mapRef.current;
    const popup = popupRef.current;
    if (!m || !popup) return;
    if (pin) popup.setLngLat(pin.at).addTo(m);
    else popup.remove();
  }, [pin]);

  // Escape takes the tooltip away, wherever focus is, so it can be dismissed
  // without moving the pointer.
  const hovering = !!hover;
  useEffect(() => {
    if (!hovering) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHover(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hovering]);

  // The pill's two moves: to the area, and back to the data.
  const glide = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 750);
  const showArea = () => {
    const m = mapRef.current;
    if (!m || !area) return;
    const [w, s, e, n] = area.bbox;
    toAreaRef.current = true;
    // More room on top, so the pill doesn't sit on the outline.
    m.fitBounds([[w, s], [e, n]], { padding: { top: 56, right: FIT.padding, bottom: FIT.padding, left: FIT.padding }, duration: glide() });
  };
  const showData = () => {
    const m = mapRef.current;
    const b = boundsOf(data, bbox);
    if (m && b) m.fitBounds(b, { ...FIT, duration: glide() });
  };

  const short = (f: MapFeatureProps) => [f.label, f.tag].filter(Boolean).join(" · ") || f.id;
  // In a stack each simplified one is marked, since they needn't all be.
  const stacked = (f: MapFeatureProps) => (f.simplified ? `${short(f)} (simplified geometry)` : short(f));
  const name = (f: MapFeatureProps | null) => (f ? (f.label ? `${short(f)} (${f.id})` : f.id) : null);
  // A stack is named without ids, which the tooltip beside the cursor carries.
  const hoverText = !hover
    ? null
    : hover.hits.length === 1
      ? `${name(hover.hits[0])}${hover.hits[0].simplified ? ", simplified geometry" : ""}`
      : `${hover.hits.length} here: ${hover.hits.slice(0, 3).map(stacked).join(", ")}${hover.hits.length > 3 ? `, and ${hover.hits.length - 3} more` : ""}`;
  const readout = hoverText ? (tip && !tipped ? `${hoverText}. ${tip}` : hoverText) : (hint ?? "");
  // The tooltip steps aside while the card already lists the same stack.
  const showTip =
    hover && !(pin && hover.hits.length === pin.hits.length && hover.hits.every((h, i) => h.id === pin.hits[i].id));

  // The page's own item, when its shape is a simplified one: the note for it stays up.
  const selectedSimplified =
    !!selected && data.features.some((f) => f.properties?.id === selected && f.properties.simplified === true);

  if (failed) throw failed;
  return (
    <figure ref={frameRef} className="ffx-map" aria-label={label}>
      <div ref={canvasRef} className="ffx-map-canvas" />
      {area && (
        <button type="button" className="sx-map-pill sx-map-area-pill" onClick={onArea ? showData : showArea}>
          <Icon d={ICONS.fit} size={12} />
          {onArea ? `Show ${dataName}` : `Show ${area.name}`}
        </button>
      )}
      {showTip && (
        <div
          className="ffx-map-tip"
          data-stack={hover.hits.length > 1 || undefined}
          data-flip={hover.flip || undefined}
          style={{ left: hover.x, top: hover.y }}
          aria-hidden="true"
        >
          {hover.hits.slice(0, TIP_ROWS).map((h) => (
            <span key={h.id} className="ffx-map-tip-row">
              {h.tint && <i className="sx-swatch" data-step={h.tint} aria-hidden="true" />}
              {h.tag && <span className="ffx-map-tip-kind">{h.tag}</span>}
              {h.label && <span className="ffx-map-tip-label">{h.label}</span>}
              <span className="ffx-id">{h.id}</span>
              {h.simplified && <span className="sx-map-flag">Simplified geometry</span>}
            </span>
          ))}
          {hover.hits.length > TIP_ROWS && <span className="ffx-map-tip-more">and {hover.hits.length - TIP_ROWS} more</span>}
        </div>
      )}
      {basemapDown && <div className="ffx-map-note">Basemap unavailable, showing data only.</div>}
      {selectedSimplified && <div className="ffx-map-note sx-map-simplified">Simplified geometry</div>}
      {pinHost && pin && createPortal(
        <MapCard
          rows={pin.hits.map((h) => ({ id: h.id, label: h.label, kind: h.tag, tint: h.tint, simplified: h.simplified, href: h.href }))}
        />,
        pinHost,
      )}
      <figcaption className="ffx-map-readout">
        <span>{readout}</span>
        <MapCredits credits={credits} />
      </figcaption>
    </figure>
  );
}
