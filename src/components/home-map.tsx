"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  applyBasemap,
  blankStyle,
  Controls,
  CreditLine,
  creditsOf,
  dressBasemap,
  LAYER_RELIEF,
  palette,
  SRC_TERRAIN,
  watchTheme,
  WORKER_URL,
  type Credit,
  type Palette,
} from "./map-core";
import type { HomeArea } from "./home";
import { BASINS_URL, FOCUS_BASIN, FOCUS_BBOX } from "@/lib/basins";

/**
 * The landing page map: the South Platte basin, with every model area named
 * on it.
 *
 * Follows the Alaska Ground Watch home map. Each area is an HTML marker with
 * its name beside it, so it is focusable and named for assistive tech, and
 * pointing at one lights up its row in the rail (and the other way round).
 * Clicking a pin selects the area, which opens the preview card; the card is
 * the way into a collection.
 *
 * The South Platte is the only basin the program cares about, so the map
 * opens on it and its outline is the only boundary drawn. Inside the line
 * the basemap is at full strength: paper-white land, shaded relief, rivers
 * in blue. Everything beyond it sits under a darker, sand-colored wash, so
 * the basin reads as the lit shape on the card.
 *
 * Until something is selected the map holds only the pins, so it stays
 * readable however many collections there are. Selecting a collection draws
 * its footprint under the markers: small dots for point items like gages, a
 * faint fill and an outline for the area a model covers, or a dashed box
 * when the shapes were too heavy to send (lib/overview.ts decides which).
 * The pin says where a collection is; the footprint says how much ground it
 * covers. Clicking the basin selects it, which zooms the map and
 * scrolls the rail to its group.
 */

const SRC_ITEMS = "sx-items";
const SRC_BASINS = "sx-basins";
const SRC_MASK = "sx-mask";
const L = {
  mask: "sx-outside-mask",
  basinFill: "sx-basin-fill",
  basinLine: "sx-basin-line",
  itemFill: "sx-live-fill",
  itemExtent: "sx-live-extent",
  itemLine: "sx-live-line",
  items: "sx-live-items",
};

/** Even room around the basin, a little more at the bottom for the legend. */
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

type Shape = Polygon | MultiPolygon;

/**
 * Everything but the South Platte: the world as an outer ring with the basin
 * cut out as a hole. Painted as a translucent wash so the country around
 * it stays readable (gages and collections run past the edge) but the basin
 * is the subject. Until the basin's polygon arrives, its extent is cut out
 * instead.
 */
function outside(shape: Shape | null): Polygon {
  const holes = !shape
    ? box(FOCUS_BBOX).coordinates
    : shape.type === "Polygon"
      ? [shape.coordinates[0]]
      : shape.coordinates.map((poly) => poly[0]);
  return {
    type: "Polygon",
    coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes],
  };
}

/** The South Platte out of the file of every basin that touches Colorado. */
function focusBasin(fc: FeatureCollection): Feature<Shape> | null {
  const f = fc.features.find((x) => String(x.properties?.huc4) === FOCUS_BASIN);
  if (!f || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) return null;
  return f as Feature<Shape>;
}

function addLayers(
  map: MapLibreMap,
  p: Palette,
  items: FeatureCollection,
  basin: Feature<Shape> | null,
  shown: string | null,
  basinHighlight: string | null,
) {
  dressBasemap(map, p);
  map.addSource(SRC_MASK, { type: "geojson", data: { type: "Feature", properties: {}, geometry: outside(basin?.geometry ?? null) } });
  map.addSource(SRC_ITEMS, { type: "geojson", data: items });
  map.addSource(SRC_BASINS, { type: "geojson", data: basinData(basin) });

  map.addLayer({
    id: L.mask, type: "fill", source: SRC_MASK,
    paint: { "fill-color": p.mapSurround, "fill-opacity": 0.6 },
  });
  // The fill can't be seen; it's the click target. A selected basin is
  // marked by its outline alone, so the land stays paper white.
  map.addLayer({
    id: L.basinFill, type: "fill", source: SRC_BASINS,
    paint: { "fill-color": p.mapLand, "fill-opacity": 0.01 },
  });
  map.addLayer({
    id: L.basinLine, type: "line", source: SRC_BASINS,
    layout: { "line-join": "round" },
    paint: { "line-color": p.ink, "line-width": basinLineWidth(basinHighlight), "line-opacity": 0.85 },
  });

  map.addLayer({
    id: L.itemFill, type: "fill", source: SRC_ITEMS, filter: footprintFilter("fill", shown),
    // Antialiasing draws a seam wherever two subbasins meet; the outline
    // layer already gives the edge.
    paint: { "fill-color": p.trace, "fill-opacity": 0.16, "fill-antialias": false },
  });
  map.addLayer({
    id: L.itemExtent, type: "line", source: SRC_ITEMS, filter: footprintFilter("extent", shown),
    paint: { "line-color": p.trace, "line-width": 1.75, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: L.itemLine, type: "line", source: SRC_ITEMS, filter: footprintFilter("line", shown),
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": p.trace, "line-width": 1.75, "line-opacity": 0.9 },
  });
  map.addLayer({
    id: L.items, type: "circle", source: SRC_ITEMS, filter: footprintFilter("point", shown),
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.5, 9, 4.5],
      "circle-color": p.trace,
      "circle-opacity": 0.85,
      "circle-stroke-color": p.surface,
      "circle-stroke-width": 0.8,
    },
  });
}

/** Which layer draws which part of a footprint. */
const FOOTPRINT_ROLES = [
  [L.itemFill, "fill"],
  [L.itemExtent, "extent"],
  [L.itemLine, "line"],
  [L.items, "point"],
] as const;

/** One part of the selected collection's footprint; nothing when none is selected. */
function footprintFilter(role: string, shown: string | null): ExpressionSpecification {
  return ["all", ["==", ["get", "role"], role], ["==", ["get", "slug"], shown ?? ""]];
}

function basinData(basin: Feature<Shape> | null): FeatureCollection {
  return { type: "FeatureCollection", features: basin ? [basin] : [] };
}

function basinLineWidth(basinHighlight: string | null) {
  return basinHighlight === FOCUS_BASIN ? 3.25 : 2.5;
}

export function HomeMap({
  areas,
  items,
  highlight,
  shown,
  basinHighlight,
  focus,
  onHover,
  onSelect,
  onBasinSelect,
}: {
  areas: HomeArea[];
  /** Every collection's footprint, from lib/overview.ts. */
  items: FeatureCollection;
  /** The pin to mark as active: the selected collection, or the one pointed at. */
  highlight: string | null;
  /** The collection whose footprint is drawn: the selected one. */
  shown: string | null;
  basinHighlight: string | null;
  /** A box to fit to; the key changes on every request so the same box can be refit. */
  focus: { bbox: [number, number, number, number]; key: number } | null;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
  onBasinSelect: (huc4: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, { marker: Marker; el: HTMLElement }>>(new Map());
  const [credits, setCredits] = useState<Credit[]>([]);
  // The legend lists only what the map has on it: the selected collection's footprint.
  const drawn = areas.find((a) => a.slug === shown)?.drawn ?? null;
  const [basemapDown, setBasemapDown] = useState(false);
  // Latest props for the one-time setup below. Written in an effect, never
  // during render.
  const areasRef = useRef(areas);
  const itemsRef = useRef(items);
  const shownRef = useRef(shown);
  const basinHighlightRef = useRef(basinHighlight);
  const basinRef = useRef<Feature<Shape> | null>(null);
  const onHoverRef = useRef(onHover);
  const onSelectRef = useRef(onSelect);
  const onBasinSelectRef = useRef(onBasinSelect);
  useEffect(() => {
    areasRef.current = areas;
    itemsRef.current = items;
    shownRef.current = shown;
    basinHighlightRef.current = basinHighlight;
    onHoverRef.current = onHover;
    onSelectRef.current = onSelect;
    onBasinSelectRef.current = onBasinSelect;
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
        bounds: [[FOCUS_BBOX[0], FOCUS_BBOX[1]], [FOCUS_BBOX[2], FOCUS_BBOX[3]]],
        fitBoundsOptions: fitPadding(),
        maxZoom: 14,
        minZoom: 4,
        cooperativeGestures: matchMedia("(pointer: coarse)").matches,
      });
      map = m;
      mapRef.current = m;
      // A handle for the console while developing: __sxMap.getStyle(), etc.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __sxMap?: unknown }).__sxMap = m;

      const fit = () => m.fitBounds([[FOCUS_BBOX[0], FOCUS_BBOX[1]], [FOCUS_BBOX[2], FOCUS_BBOX[3]]], { ...fitPadding(), duration: 300 });
      m.addControl(new Controls(m, frame, fit, "Fit to the South Platte"), "top-right");

      const draw = () => {
        if (m.getSource(SRC_ITEMS)) return;
        addLayers(m, palette(frame), itemsRef.current, basinRef.current, shownRef.current, basinHighlightRef.current);
        setCredits(creditsOf(m));
      };
      // The basin polygon comes from a static file; it arrives once and is
      // added to the sources whenever the layers are (re)drawn.
      void fetch(BASINS_URL)
        .then((r) => (r.ok ? r.json() : null))
        .then((fc: FeatureCollection | null) => {
          const basin = fc && focusBasin(fc);
          if (disposed || !basin) return;
          basinRef.current = basin;
          (m.getSource(SRC_BASINS) as GeoJSONSource | undefined)?.setData(basinData(basin));
          (m.getSource(SRC_MASK) as GeoJSONSource | undefined)?.setData({ type: "Feature", properties: {}, geometry: outside(basin.geometry) });
        })
        .catch(() => {});
      const basemap = () => applyBasemap(m, frame, draw, setBasemapDown, () => disposed);

      // Markers: one per area, name beside the mark. Built once.
      for (const a of areasRef.current) {
        const el = document.createElement("div");
        el.className = "sx-pin";
        const btn = document.createElement("button");
        btn.className = "sx-pin-btn";
        btn.type = "button";
        btn.setAttribute("aria-label", `${a.name}, published collection`);
        btn.innerHTML = `<span class="sx-pin-mark" aria-hidden="true"></span><span class="sx-pin-label">${a.name}</span>`;
        el.appendChild(btn);
        let downX = 0, downY = 0;
        btn.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
          onSelectRef.current(a.slug);
        });
        btn.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") onHoverRef.current(a.slug); });
        btn.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") onHoverRef.current(null); });
        btn.addEventListener("focus", () => onHoverRef.current(a.slug));
        btn.addEventListener("blur", () => onHoverRef.current(null));
        const [w, s, e, n] = a.bbox;
        el.dataset.anchor = "left";
        const marker = new maplibregl.Marker({ element: el, anchor: "left", offset: [-7, 0] })
          .setLngLat([(w + e) / 2, (s + n) / 2])
          .addTo(m);
        markersRef.current.set(a.slug, { marker, el });
      }

      m.on("load", () => {
        draw();
        basemap();
      });
      m.on("sourcedata", () => setCredits(creditsOf(m)));
      // A click on a basin selects it; a click on bare map clears the hover.
      m.on("click", (e) => {
        const hits = m.getLayer(L.basinFill) ? m.queryRenderedFeatures(e.point, { layers: [L.basinFill] }) : [];
        const huc = hits[0]?.properties?.huc4;
        if (huc) onBasinSelectRef.current(String(huc));
        else onHoverRef.current(null);
      });
      m.on("mousemove", L.basinFill, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", L.basinFill, () => (m.getCanvas().style.cursor = ""));

      unwatch = watchTheme(() => {
        for (const id of [...Object.values(L), LAYER_RELIEF]) if (m.getLayer(id)) m.removeLayer(id);
        for (const id of [SRC_MASK, SRC_ITEMS, SRC_BASINS, SRC_TERRAIN]) if (m.getSource(id)) m.removeSource(id);
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
     
  }, []);

  useEffect(() => {
    markersRef.current.forEach(({ el }, slug) => {
      el.dataset.active = String(slug === highlight);
    });
  }, [highlight]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.itemFill)) return;
    for (const [id, role] of FOOTPRINT_ROLES) m.setFilter(id, footprintFilter(role, shown));
  }, [shown]);

  useEffect(() => {
    const src = mapRef.current?.getSource(SRC_ITEMS) as GeoJSONSource | undefined;
    if (src) src.setData(items);
  }, [items]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.basinFill)) return;
    m.setPaintProperty(L.basinLine, "line-width", basinLineWidth(basinHighlight));
  }, [basinHighlight]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !focus) return;
    const [w, s, e, n] = focus.bbox;
    const wide = matchMedia("(min-width: 64rem)").matches;
    m.fitBounds([[w, s], [e, n]], { padding: { top: 40, bottom: 60, left: 40, right: wide ? 400 : 40 }, maxZoom: 9, duration: 500 });
  }, [focus]);

  return (
    <figure ref={frameRef} className="ffx-map sx-home-map" aria-label="Collections in the South Platte basin">
      <div ref={canvasRef} className="ffx-map-canvas sx-home-canvas" />
      {basemapDown && <div className="ffx-map-note">Basemap unavailable, showing data only.</div>}
      <figcaption className="ffx-map-readout">
        <span className="sx-legend-box">
          <span className="sx-legend">
            <span className="sx-pin-mark" aria-hidden="true" /> Published collection
          </span>
          {drawn === "points" && (
            <span className="sx-legend">
              <span className="sx-legend-dot" aria-hidden="true" /> Item location
            </span>
          )}
          {drawn === "areas" && (
            <span className="sx-legend">
              <span className="sx-legend-area" aria-hidden="true" /> Area covered
            </span>
          )}
          {drawn === "extent" && (
            <span className="sx-legend">
              <span className="sx-legend-area" data-extent="true" aria-hidden="true" /> Extent
            </span>
          )}
        </span>
        <CreditLine credits={credits} />
      </figcaption>
    </figure>
  );
}
