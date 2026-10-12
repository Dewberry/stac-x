"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  Popup,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { CopyButton } from "./copy-button";
import { Icon, ICONS } from "./icons";
import {
  applyBasemap,
  blankStyle,
  Controls,
  creditsOf,
  dressBasemap,
  MapCredits,
  palette,
  watchTheme,
  WORKER_URL,
  type Credit,
  type Palette,
} from "./map-core";

/**
 * The map on every page.
 *
 * It draws one GeoJSON feature collection and fits itself to it. Pointing at
 * a feature lights it up and shows its id beside the cursor; clicking pins a
 * small card with the id, a copy button and a link to the item's page. A
 * terrain collection is dozens of tiles that all look alike and overlap, so
 * the pin is also how you tell them apart: clicking the same spot again moves
 * it to the next tile stacked there. Points are river blue, the color for
 * data in this app; lines and polygons are drawn in ink, with an extent box
 * dashed so it never reads as data.
 *
 * MapLibre because the program's collections will run to tens of thousands of
 * points, which rules out a DOM marker each, and because a GeoJSON source
 * today can become PMTiles from the bucket tomorrow with the layers unchanged.
 *
 * The basemap is OpenStreetMap through OpenFreeMap, one quiet style per
 * palette, no key and no cap, dressed in the app's colors the same way the
 * landing map is. If it can't be fetched the features still draw over a
 * plain ground and the readout says so.
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
  /** How to use the features, said once, beside the first one pointed at. */
  tip?: string;
};

export type MapFeatureProps = {
  id: string;
  href?: string;
  label?: string;
  /** "extent" draws a dashed box instead of a filled shape. */
  kind?: "extent" | "feature";
};

const SRC = "sx-data";
const L = {
  extentFill: "sx-extent-fill",
  extentLine: "sx-extent-line",
  fill: "sx-fill",
  line: "sx-line",
  hiFill: "sx-hi-fill",
  hiLine: "sx-hi-line",
  points: "sx-points",
  selected: "sx-selected",
};
const INTERACTIVE = [L.points, L.line, L.fill, L.extentFill];
const FIT = { padding: 36, maxZoom: 12, duration: 0 };

type Hover = { id: string; label?: string; x: number; y: number; flip: boolean };
/** What a click landed on: every feature under the point, and which one the pin is on. */
type Pin = { hits: MapFeatureProps[]; k: number; at: [number, number] };

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

function addLayers(map: MapLibreMap, p: Palette, data: FeatureCollection, hi: (string | null | undefined)[], selected: string | null) {
  map.addSource(SRC, { type: "geojson", data, promoteId: "id" });

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
  // The hovered and pinned shapes, drawn again on top so their outline isn't
  // lost under the neighbors they overlap.
  map.addLayer({
    id: L.hiFill, type: "fill", source: SRC, filter: ["all", notExtent, poly, idsIn(hi)],
    paint: { "fill-color": p.trace, "fill-opacity": 0.3 },
  });
  map.addLayer({
    id: L.hiLine, type: "line", source: SRC, filter: ["all", notExtent, ["any", poly, line], idsIn(hi)],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": p.ink, "line-width": 2 },
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

export function DataMap({ data, bbox, selected = null, label, hint, tip }: MapProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  // Where the pin card renders: a div the popup owns, portaled into from React.
  const [pinHost, setPinHost] = useState<HTMLDivElement | null>(null);
  // The tip shows with the first feature hovered, then gets out of the way.
  const [tipped, setTipped] = useState(false);
  const tipRef = useRef(tip);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [basemapDown, setBasemapDown] = useState(false);
  const pinned = pin ? pin.hits[pin.k] : null;
  // Latest props, readable from the one-time map setup below without
  // rebuilding the map. Written in an effect, never during render.
  const dataRef = useRef(data);
  const selectedRef = useRef(selected);
  const hiRef = useRef<(string | null | undefined)[]>([]);
  useEffect(() => {
    dataRef.current = data;
    selectedRef.current = selected;
    hiRef.current = [hover?.id, pinned?.id];
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
        className: "ffx-map-pin",
      }).setDOMContent(pinDiv);
      setPinHost(pinDiv);

      const fit = () => {
        const b = boundsOf(dataRef.current, bbox);
        if (b) m.fitBounds(b, FIT);
      };
      m.addControl(new Controls(m, frame, fit), "top-right");
      m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

      const draw = () => {
        if (m.getSource(SRC)) return;
        const p = palette(frame);
        dressBasemap(m, p);
        addLayers(m, p, dataRef.current, hiRef.current, selectedRef.current);
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
          if (tipRef.current) setTipped(true);
        });
        m.on("mousemove", layer, (e) => {
          const f = e.features?.[0] as MapGeoJSONFeature | undefined;
          const props = f?.properties as MapFeatureProps | undefined;
          // The tooltip sits to the right of the cursor unless that would run it off the map.
          const flip = e.point.x > canvas.clientWidth - 260;
          setHover(props ? { id: props.id, label: props.label, x: e.point.x, y: e.point.y, flip } : null);
        });
      }
      m.on("click", (e) => {
        const layers = INTERACTIVE.filter((l) => m.getLayer(l));
        const seen = new Set<string>();
        const hits: MapFeatureProps[] = [];
        for (const h of m.queryRenderedFeatures(e.point, { layers })) {
          const props = h.properties as MapFeatureProps;
          if (!seen.has(props.id)) {
            seen.add(props.id);
            hits.push(props);
          }
        }
        const at = e.lngLat.toArray() as [number, number];
        setPin((prev) => {
          if (hits.length === 0) return null;
          // The same stack as last time means the same spot was clicked
          // again: step to the next feature in it.
          if (prev && prev.hits.length === hits.length && prev.hits.every((h, i) => h.id === hits[i].id)) {
            return { hits, k: (prev.k + 1) % hits.length, at };
          }
          return { hits, k: 0, at };
        });
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
      frame.removeEventListener("keydown", onKey);
      unwatch?.();
      popupRef.current?.remove();
      popupRef.current = null;
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

  const hoverId = hover?.id ?? null;
  const pinnedId = pinned?.id ?? null;
  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.hiLine)) return;
    m.setFilter(L.hiFill, ["all", notExtent, poly, idsIn([hoverId, pinnedId])]);
    m.setFilter(L.hiLine, ["all", notExtent, ["any", poly, line], idsIn([hoverId, pinnedId])]);
    m.setFilter(L.selected, selectedFilter([selected, hoverId, pinnedId]));
  }, [selected, hoverId, pinnedId]);

  useEffect(() => {
    const m = mapRef.current;
    const popup = popupRef.current;
    if (!m || !popup) return;
    if (pin) popup.setLngLat(pin.at).addTo(m);
    else popup.remove();
  }, [pin]);

  const name = (f: { id: string; label?: string } | null) => (f ? (f.label ? `${f.label} (${f.id})` : f.id) : null);
  const readout = hover
    ? tip && !tipped
      ? `${name(hover)}. ${tip}`
      : name(hover)
    : (name(pinned) ?? hint ?? "");

  return (
    <figure ref={frameRef} className="ffx-map" aria-label={label}>
      <div ref={canvasRef} className="ffx-map-canvas" />
      {hover && hover.id !== pinnedId && (
        <div className="ffx-map-tip" style={{ left: hover.x, top: hover.y }} data-flip={hover.flip || undefined} aria-hidden="true">
          {hover.label && <span className="ffx-map-tip-label">{hover.label}</span>}
          <span className="ffx-id">{hover.id}</span>
        </div>
      )}
      {basemapDown && <div className="ffx-map-note">Basemap unavailable, showing data only.</div>}
      {pinHost && pin && pinned && createPortal(<PinCard f={pinned} n={pin.hits.length} k={pin.k} />, pinHost)}
      <figcaption className="ffx-map-readout">
        <span>{readout}</span>
        <MapCredits credits={credits} />
      </figcaption>
    </figure>
  );
}

/** The card on a pinned feature: its name, its id to copy, and the way to its page. */
function PinCard({ f, n, k }: { f: MapFeatureProps; n: number; k: number }) {
  return (
    <div className="ffx-map-pin-card">
      {f.label && <div className="ffx-map-pin-label">{f.label}</div>}
      <div className="ffx-id ffx-map-pin-id">{f.id}</div>
      <div className="ffx-map-pin-actions">
        <CopyButton text={f.id} label="Copy id" />
        {f.href && (
          <Link href={f.href} className="ffx-btn ffx-btn-sm">
            Open <Icon d={ICONS.chevronRight} size={12} />
          </Link>
        )}
      </div>
      {n > 1 && (
        <div className="ffx-map-pin-more">
          <span className="ffx-num">{k + 1} of {n}</span> stacked here. Click again for the next.
        </div>
      )}
    </div>
  );
}
