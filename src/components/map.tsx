"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  MapGeoJSONFeature,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import {
  applyBasemap,
  blankStyle,
  Controls,
  CreditLine,
  creditsOf,
  palette,
  watchTheme,
  WORKER_URL,
  type Credit,
  type Palette,
} from "./map-core";

/**
 * The map on every page.
 *
 * It draws one GeoJSON feature collection, fits itself to it, and treats a
 * feature with an href as a link: click it and the page navigates there, the
 * same as clicking its row in the list. Points are colored by QC status,
 * which is the one thing hue means in this app; lines and polygons are drawn
 * in ink, with an extent box dashed so it never reads as data.
 *
 * MapLibre because the pilot's collections will run to tens of thousands of
 * points, which rules out a DOM marker each, and because a GeoJSON source
 * today can become PMTiles from the bucket tomorrow with the layers unchanged.
 *
 * The basemap is OpenStreetMap through OpenFreeMap, one quiet style per
 * palette, no key and no cap. If it can't be fetched the features still draw
 * over a plain ground and the readout says so.
 */

export type MapProps = {
  data: FeatureCollection;
  /** Bounds to fit, when the features alone don't say (an empty collection with a known extent). */
  bbox?: [number, number, number, number] | null;
  /** Feature id to ring. */
  selected?: string | null;
  /** What the map is of, for assistive tech. */
  label: string;
  /** Readout text before anything is hovered. */
  hint?: string;
};

export type MapFeatureProps = {
  id: string;
  href?: string;
  label?: string;
  qc?: string;
  /** "extent" draws a dashed box instead of a filled shape. */
  kind?: "extent" | "feature";
};

const SRC = "sx-data";
const L = {
  extentFill: "sx-extent-fill",
  extentLine: "sx-extent-line",
  fill: "sx-fill",
  line: "sx-line",
  points: "sx-points",
  selected: "sx-selected",
};
const INTERACTIVE = [L.points, L.line, L.fill, L.extentFill];
const FIT = { padding: 36, maxZoom: 12, duration: 0 };

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

const qcColor = (p: Palette): ExpressionSpecification => [
  "match",
  ["get", "qc"],
  "approved", p.verified,
  "rejected", p.bad,
  "needs_revision", p.attn,
  p.neutral,
];

function addLayers(map: MapLibreMap, p: Palette, data: FeatureCollection, selected: string | null) {
  map.addSource(SRC, { type: "geojson", data, promoteId: "id" });
  const isExtent: ExpressionSpecification = ["==", ["get", "kind"], "extent"];
  const notExtent: ExpressionSpecification = ["!=", ["get", "kind"], "extent"];
  const poly: ExpressionSpecification = ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]];
  const line: ExpressionSpecification = ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "MultiLineString"]];
  const point: ExpressionSpecification = ["any", ["==", ["geometry-type"], "Point"], ["==", ["geometry-type"], "MultiPoint"]];

  map.addLayer({
    id: L.extentFill, type: "fill", source: SRC, filter: ["all", isExtent, poly],
    paint: { "fill-color": p.trace, "fill-opacity": 0.08 },
  });
  map.addLayer({
    id: L.extentLine, type: "line", source: SRC, filter: ["all", isExtent, poly],
    paint: { "line-color": p.inkMut, "line-width": 1.25, "line-dasharray": [2, 2] },
  });
  map.addLayer({
    id: L.fill, type: "fill", source: SRC, filter: ["all", notExtent, poly],
    paint: { "fill-color": p.trace, "fill-opacity": 0.18 },
  });
  map.addLayer({
    id: L.line, type: "line", source: SRC, filter: ["all", notExtent, ["any", poly, line]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": p.inkSec, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 14, 2.5] },
  });
  map.addLayer({
    id: L.points, type: "circle", source: SRC, filter: ["all", notExtent, point],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 12, 7],
      "circle-color": qcColor(p),
      "circle-stroke-color": p.surface,
      "circle-stroke-width": 1.25,
      "circle-opacity": 0.95,
    },
  });
  map.addLayer({
    id: L.selected, type: "circle", source: SRC, filter: ["==", ["get", "id"], selected ?? ""],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 12, 13],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": p.ink,
      "circle-stroke-width": 1.5,
    },
  });
}

export function DataMap({ data, bbox, selected = null, label, hint }: MapProps) {
  const router = useRouter();
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [basemapDown, setBasemapDown] = useState(false);
  // Latest props, readable from the one-time map setup below without
  // rebuilding the map. Written in an effect, never during render.
  const dataRef = useRef(data);
  const selectedRef = useRef(selected);
  useEffect(() => {
    dataRef.current = data;
    selectedRef.current = selected;
  });

  useEffect(() => {
    const frame = frameRef.current;
    const host = canvasRef.current;
    if (!frame || !host) return;
    let map: MapLibreMap | null = null;
    let disposed = false;
    let unwatch: (() => void) | null = null;

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

      const fit = () => {
        const b = boundsOf(dataRef.current, bbox);
        if (b) m.fitBounds(b, FIT);
      };
      m.addControl(new Controls(m, frame, fit), "top-right");
      m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

      const draw = () => {
        if (m.getSource(SRC)) return;
        addLayers(m, palette(frame), dataRef.current, selectedRef.current);
        setCredits(creditsOf(m));
      };
      const basemap = () => applyBasemap(m, frame, draw, setBasemapDown, () => disposed);

      m.on("load", () => {
        draw();
        fit();
        basemap();
      });
      m.on("sourcedata", () => setCredits(creditsOf(m)));

      const canvas = m.getCanvas();
      for (const layer of INTERACTIVE) {
        m.on("mouseenter", layer, () => (canvas.style.cursor = "pointer"));
        m.on("mouseleave", layer, () => {
          canvas.style.cursor = "";
          setHover(null);
        });
        m.on("mousemove", layer, (e) => {
          const f = e.features?.[0] as MapGeoJSONFeature | undefined;
          const props = f?.properties as MapFeatureProps | undefined;
          setHover(props ? (props.label ? `${props.label} (${props.id})` : props.id) : null);
        });
      }
      m.on("click", (e) => {
        const hits = m.queryRenderedFeatures(e.point, { layers: INTERACTIVE.filter((l) => m.getLayer(l)) });
        const f = hits.find((h) => (h.properties as MapFeatureProps).href);
        if (f) router.push((f.properties as MapFeatureProps).href!);
      });

      unwatch = watchTheme(() => {
        if (m.getSource(SRC)) {
          for (const id of Object.values(L)) if (m.getLayer(id)) m.removeLayer(id);
          m.removeSource(SRC);
        }
        basemap();
      });
    });

    return () => {
      disposed = true;
      unwatch?.();
      map?.remove();
      mapRef.current = null;
    };
    // The map is built once; data and selection updates go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    const src = m?.getSource(SRC) as GeoJSONSource | undefined;
    if (src) src.setData(data);
  }, [data]);

  useEffect(() => {
    const m = mapRef.current;
    if (m?.getLayer(L.selected)) m.setFilter(L.selected, ["==", ["get", "id"], selected ?? ""]);
  }, [selected]);

  return (
    <figure ref={frameRef} className="ffx-map" aria-label={label}>
      <div ref={canvasRef} className="ffx-map-canvas" />
      {basemapDown && <div className="ffx-map-note">Basemap unavailable, showing data only.</div>}
      <figcaption className="ffx-map-readout">
        <span>{hover ?? hint ?? ""}</span>
        <CreditLine credits={credits} />
      </figcaption>
    </figure>
  );
}
