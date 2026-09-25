"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import {
  applyBasemap,
  blankStyle,
  COLORADO,
  Controls,
  CreditLine,
  creditsOf,
  palette,
  watchTheme,
  WORKER_URL,
  type Credit,
  type Palette,
} from "./map-core";
import type { HomeArea } from "./home";

/**
 * The landing page map: Colorado, with every model area named on it.
 *
 * Follows the Alaska Ground Watch home map. Each area is an HTML marker with
 * its name beside it, so it is focusable and named for assistive tech, and
 * pointing at one lights up its row in the rail (and the other way round).
 * A live area, one whose collection exists in the catalog, is a link: click
 * it and the collection opens. A planned area is drawn quieter and does
 * nothing when clicked but show its outline.
 *
 * Under the markers, GeoJSON layers draw the state as a dashed box, each
 * area's extent when it is highlighted, and the real items of every live
 * collection as small dots, so the map shows actual coverage where it exists
 * and a promise where it doesn't.
 */

const SRC_STATE = "sx-state";
const SRC_AREAS = "sx-areas";
const SRC_ITEMS = "sx-items";
const L = {
  stateLine: "sx-state-line",
  areaFill: "sx-area-fill",
  areaLine: "sx-area-line",
  items: "sx-live-items",
};

/** Even room around the state, a little more at the bottom for the legend. */
function fitPadding() {
  return { padding: { top: 28, right: 28, bottom: 56, left: 28 } };
}

function box(b: [number, number, number, number]) {
  const [w, s, e, n] = b;
  return {
    type: "Polygon" as const,
    coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
  };
}

function areasFc(areas: HomeArea[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: areas.map((a) => ({
      type: "Feature",
      id: a.slug,
      properties: { slug: a.slug, live: a.live },
      geometry: box(a.bbox),
    })),
  };
}

function addLayers(map: MapLibreMap, p: Palette, areas: HomeArea[], items: FeatureCollection, highlight: string | null) {
  map.addSource(SRC_STATE, { type: "geojson", data: { type: "Feature", properties: {}, geometry: box(COLORADO) } });
  map.addSource(SRC_AREAS, { type: "geojson", data: areasFc(areas), promoteId: "slug" });
  map.addSource(SRC_ITEMS, { type: "geojson", data: items });

  map.addLayer({
    id: L.stateLine, type: "line", source: SRC_STATE,
    paint: { "line-color": p.inkDim, "line-width": 1.25, "line-dasharray": [3, 2], "line-opacity": 0.8 },
  });
  const isHi: ExpressionSpecification = ["==", ["get", "slug"], highlight ?? ""];
  map.addLayer({
    id: L.areaFill, type: "fill", source: SRC_AREAS, filter: isHi,
    paint: { "fill-color": p.trace, "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: L.areaLine, type: "line", source: SRC_AREAS, filter: isHi,
    paint: { "line-color": p.trace, "line-width": 1.5, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: L.items, type: "circle", source: SRC_ITEMS,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.5, 9, 4.5],
      "circle-color": p.trace,
      "circle-opacity": 0.85,
      "circle-stroke-color": p.surface,
      "circle-stroke-width": 0.8,
    },
  });
}

export function HomeMap({
  areas,
  items,
  highlight,
  onHover,
}: {
  areas: HomeArea[];
  /** Real items from every live collection, as points. */
  items: FeatureCollection;
  highlight: string | null;
  onHover: (slug: string | null) => void;
}) {
  const router = useRouter();
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, { marker: Marker; el: HTMLElement }>>(new Map());
  const [credits, setCredits] = useState<Credit[]>([]);
  const [basemapDown, setBasemapDown] = useState(false);
  // Latest props for the one-time setup below. Written in an effect, never
  // during render.
  const areasRef = useRef(areas);
  const itemsRef = useRef(items);
  const highlightRef = useRef(highlight);
  const onHoverRef = useRef(onHover);
  useEffect(() => {
    areasRef.current = areas;
    itemsRef.current = items;
    highlightRef.current = highlight;
    onHoverRef.current = onHover;
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
        bounds: [[COLORADO[0], COLORADO[1]], [COLORADO[2], COLORADO[3]]],
        fitBoundsOptions: fitPadding(),
        maxZoom: 14,
        minZoom: 4,
        cooperativeGestures: matchMedia("(pointer: coarse)").matches,
      });
      map = m;
      mapRef.current = m;
      // A handle for the console while developing: __sxMap.getStyle(), etc.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __sxMap?: unknown }).__sxMap = m;

      const fit = () => m.fitBounds([[COLORADO[0], COLORADO[1]], [COLORADO[2], COLORADO[3]]], { ...fitPadding(), duration: 300 });
      m.addControl(new Controls(m, frame, fit, "Fit to Colorado"), "top-right");

      const draw = () => {
        if (m.getSource(SRC_AREAS)) return;
        addLayers(m, palette(frame), areasRef.current, itemsRef.current, highlightRef.current);
        setCredits(creditsOf(m));
      };
      const basemap = () => applyBasemap(m, frame, draw, setBasemapDown, () => disposed);

      // Markers: one per area, name beside the mark. Built once.
      for (const a of areasRef.current) {
        const el = document.createElement("div");
        el.className = "sx-pin";
        el.dataset.live = String(a.live);
        const btn: HTMLElement = document.createElement(a.live ? "a" : "button");
        btn.className = "sx-pin-btn";
        if (btn instanceof HTMLAnchorElement) btn.href = a.href ?? "#";
        else if (btn instanceof HTMLButtonElement) btn.type = "button";
        btn.setAttribute("aria-label", a.live ? `${a.name}, open collection` : `${a.name}, planned`);
        btn.innerHTML = `<span class="sx-pin-mark" aria-hidden="true"></span><span class="sx-pin-label">${a.name}</span>`;
        el.appendChild(btn);
        let downX = 0, downY = 0;
        btn.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
          if (a.live && a.href) router.push(a.href);
          else onHoverRef.current(a.slug);
        });
        btn.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") onHoverRef.current(a.slug); });
        btn.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") onHoverRef.current(null); });
        btn.addEventListener("focus", () => onHoverRef.current(a.slug));
        btn.addEventListener("blur", () => onHoverRef.current(null));
        const [w, s, e, n] = a.bbox;
        const anchor = a.anchor ?? "left";
        const offset: [number, number] =
          anchor === "left" ? [-7, 0] : anchor === "right" ? [7, 0] : anchor === "top" ? [0, -4] : [0, 4];
        el.dataset.anchor = anchor;
        const marker = new maplibregl.Marker({ element: el, anchor, offset })
          .setLngLat(a.pin ?? [(w + e) / 2, (s + n) / 2])
          .addTo(m);
        markersRef.current.set(a.slug, { marker, el });
      }

      // Sixteen names on a phone-width state are a pile. Below the zoom where
      // they fit, planned areas keep their mark and drop their name; the rail
      // has every name, and a tap on a mark brings its name back.
      const dense = () => {
        frame.dataset.dense = String(m.getZoom() < 5.8);
      };
      m.on("zoom", dense);
      m.on("load", () => {
        dense();
        draw();
        basemap();
      });
      m.on("sourcedata", () => setCredits(creditsOf(m)));
      m.on("click", () => onHoverRef.current(null));

      unwatch = watchTheme(() => {
        for (const id of Object.values(L)) if (m.getLayer(id)) m.removeLayer(id);
        for (const id of [SRC_STATE, SRC_AREAS, SRC_ITEMS]) if (m.getSource(id)) m.removeSource(id);
        basemap();
      });
    });

    const markers = markersRef.current;
    return () => {
      disposed = true;
      unwatch?.();
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      map?.remove();
      mapRef.current = null;
    };
    // Built once; highlight and data changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    const filter: ExpressionSpecification = ["==", ["get", "slug"], highlight ?? ""];
    if (m?.getLayer(L.areaFill)) {
      m.setFilter(L.areaFill, filter);
      m.setFilter(L.areaLine, filter);
    }
    markersRef.current.forEach(({ el }, slug) => {
      el.dataset.active = String(slug === highlight);
    });
  }, [highlight]);

  useEffect(() => {
    const src = mapRef.current?.getSource(SRC_ITEMS) as GeoJSONSource | undefined;
    if (src) src.setData(items);
  }, [items]);

  return (
    <figure ref={frameRef} className="ffx-map sx-home-map" aria-label="Model areas across Colorado">
      <div ref={canvasRef} className="ffx-map-canvas sx-home-canvas" />
      {basemapDown && <div className="ffx-map-note">Basemap unavailable, showing data only.</div>}
      <figcaption className="ffx-map-readout">
        <span className="sx-legend-box">
          <span className="sx-legend">
            <span className="sx-pin-mark" data-live="true" aria-hidden="true" /> Published collection
          </span>
          <span className="sx-legend">
            <span className="sx-pin-mark" data-live="false" aria-hidden="true" /> Planned
          </span>
          <span className="sx-legend">
            <span className="sx-legend-dot" aria-hidden="true" /> Item
          </span>
        </span>
        <CreditLine credits={credits} />
      </figcaption>
    </figure>
  );
}
