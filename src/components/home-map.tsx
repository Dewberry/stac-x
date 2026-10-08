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
import { QC_STATUSES, type QcStatus } from "@/lib/stac";
import { QcMark, stateOf } from "./qc-mark";

/**
 * The landing page map: the South Platte basin, with every model area named
 * on it.
 *
 * Follows the Alaska Ground Watch home map. Each area is an HTML marker with
 * its name beside it, so it is focusable and named for assistive tech, and
 * pointing at one lights up its row in the rail (and the other way round).
 * Clicking a pin selects the area, which opens its row in the rail; the row
 * is the way into a collection. The mark carries the collection's review
 * state: filled green, amber or red, or a hollow ring when nobody has
 * reviewed it.
 *
 * A collection that covers most of the basin gets no pin: its middle is the
 * basin's middle, so every such pin would stack on the same spot. Names
 * that would overlap another pin, or run off the map, move to the other
 * side of their mark or hide, leaving the mark (placeLabels below).
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
 * faint fill and an outline for the area a model covers, three steps of
 * blue for how many shapes cover each spot when they overlap heavily, or a
 * dashed box when the shapes were too heavy to send (lib/overview.ts
 * decides which).
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
  density: "sx-live-density",
  densityLine: "sx-live-density-line",
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
  // Overlap density: three steps of river blue, palest for the fewest.
  map.addLayer({
    id: L.density, type: "fill", source: SRC_ITEMS, filter: footprintFilter("density", shown),
    paint: {
      "fill-color": ["match", ["get", "step"], 1, p.traceSoft, 2, p.trace, p.traceDeep],
      "fill-opacity": ["match", ["get", "step"], 1, 0.5, 2, 0.42, 0.62],
      "fill-antialias": false,
    },
  });
  // Each shape's own outline, once the map is close enough to tell them apart.
  map.addLayer({
    id: L.densityLine, type: "line", source: SRC_ITEMS, filter: footprintFilter("outline", shown), minzoom: 9,
    paint: { "line-color": p.trace, "line-width": 0.6, "line-opacity": 0.6 },
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
  [L.density, "density"],
  [L.densityLine, "outline"],
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

type Pin = { slug: string; lngLat: [number, number]; el: HTMLElement; btn: HTMLElement; width?: number };
type Rect = [number, number, number, number];

/** From the pin's left edge to the middle of its mark: padding plus half the mark. */
const MARK_INSET = 11;
const MARK_HALF = 6;

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Where each pin's name goes: to the right of its mark, to the left, or
 * nowhere, so no name covers another name or another mark and none runs off
 * the map or under its controls and legend. The active pin is placed first,
 * so its name always shows. While a collection is selected only its own pin
 * keeps a name: the map is zoomed in by then, and the other names would sit
 * on the basemap's town labels. The marks themselves never move or hide.
 */
function placeLabels(
  map: MapLibreMap,
  frame: HTMLElement,
  pins: Pin[],
  active: string | null,
  selected: string | null,
  marksOnly: boolean,
) {
  const box = map.getContainer().getBoundingClientRect();
  const blocked: Rect[] = [];
  for (const sel of [".ffx-map-ctl", ".sx-legend-box", ".sx-credit"]) {
    const r = frame.querySelector(sel)?.getBoundingClientRect();
    if (r && r.width) blocked.push([r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top]);
  }
  const at = new Map(pins.map((p) => [p.slug, map.project(p.lngLat)]));
  const marks: [string, Rect][] = pins.map((p) => {
    const { x, y } = at.get(p.slug)!;
    return [p.slug, [x - MARK_HALF, y - MARK_HALF, x + MARK_HALF, y + MARK_HALF]];
  });
  const order = [...pins].sort((a, b) => Number(b.slug === active) - Number(a.slug === active));
  for (const p of order) {
    if (marksOnly || (selected && p.slug !== selected)) {
      p.el.dataset.place = "none";
      continue;
    }
    if (p.width === undefined) {
      p.el.dataset.place = "right";
      p.width = p.btn.offsetWidth;
    }
    const h = p.btn.offsetHeight || 22;
    const { x, y } = at.get(p.slug)!;
    const sides: [string, Rect][] = [
      ["right", [x - MARK_INSET, y - h / 2, x - MARK_INSET + p.width, y + h / 2]],
      ["left", [x + MARK_INSET - p.width, y - h / 2, x + MARK_INSET, y + h / 2]],
    ];
    const fits = ([, r]: [string, Rect]) =>
      r[0] >= 0 && r[2] <= box.width && r[1] >= 0 && r[3] <= box.height &&
      !blocked.some((b) => overlaps(r, b)) &&
      !marks.some(([slug, m]) => slug !== p.slug && overlaps(r, m));
    const side = sides.find(fits);
    p.el.dataset.place = side ? side[0] : "none";
    if (side) blocked.push(side[1]);
  }
}

export function HomeMap({
  areas,
  items,
  highlight,
  shown,
  filter,
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
  /** The review state the rail is filtered to; pins in other states dim. */
  filter: QcStatus | null;
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
  const markersRef = useRef<Map<string, { marker: Marker; pin: Pin }>>(new Map());
  const [credits, setCredits] = useState<Credit[]>([]);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const current = areas.find((a) => a.slug === shown) ?? null;
  const dense = current?.drawn === "density" ? current : null;
  const [basemapDown, setBasemapDown] = useState(false);
  // Latest props for the one-time setup below. Written in an effect, never
  // during render.
  const areasRef = useRef(areas);
  const itemsRef = useRef(items);
  const shownRef = useRef(shown);
  const highlightRef = useRef(highlight);
  const denseRef = useRef(!!dense);
  const placeRef = useRef<() => void>(() => {});
  const basinHighlightRef = useRef(basinHighlight);
  const basinRef = useRef<Feature<Shape> | null>(null);
  const onHoverRef = useRef(onHover);
  const onSelectRef = useRef(onSelect);
  const onBasinSelectRef = useRef(onBasinSelect);
  useEffect(() => {
    areasRef.current = areas;
    itemsRef.current = items;
    shownRef.current = shown;
    highlightRef.current = highlight;
    denseRef.current = !!dense;
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

      // Markers: one per local collection, name beside the mark. Built once.
      // A basin-wide collection has none (see above).
      for (const a of areasRef.current) {
        if (a.wide) continue;
        const el = document.createElement("div");
        el.className = "sx-pin";
        el.dataset.place = "right";
        const btn = document.createElement("button");
        btn.className = "sx-pin-btn";
        btn.type = "button";
        const state = stateOf(a);
        const label = QC_STATUSES.find((x) => x.value === state)?.label.toLowerCase() ?? "";
        btn.setAttribute("aria-label", `${a.name}, ${label}`);
        const mark = document.createElement("span");
        mark.className = "sx-qc-mark";
        mark.dataset.qc = state;
        mark.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.className = "sx-pin-label";
        name.textContent = a.name;
        btn.append(mark, name);
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
        const lngLat: [number, number] = [(w + e) / 2, (s + n) / 2];
        const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(lngLat).addTo(m);
        markersRef.current.set(a.slug, { marker, pin: { slug: a.slug, lngLat, el, btn } });
      }

      // Labels are re-placed once per frame while the map moves.
      let frameReq = 0;
      placeRef.current = () => {
        cancelAnimationFrame(frameReq);
        frameReq = requestAnimationFrame(() => {
          if (disposed) return;
          const pins = Array.from(markersRef.current.values(), (x) => x.pin);
          // On a phone the pins are marks only (see globals.css).
          const marksOnly = denseRef.current || !matchMedia("(min-width: 64rem)").matches;
          placeLabels(m, frame, pins, highlightRef.current, shownRef.current, marksOnly);
        });
      };
      m.on("move", () => placeRef.current());
      m.on("resize", () => placeRef.current());
      void document.fonts?.ready.then(() => {
        markersRef.current.forEach(({ pin }) => (pin.width = undefined));
        placeRef.current();
      });

      m.on("load", () => {
        draw();
        basemap();
        placeRef.current();
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
    markersRef.current.forEach(({ pin }, slug) => {
      const a = areas.find((x) => x.slug === slug);
      pin.el.dataset.active = String(slug === highlight);
      // While something is selected or filtered, everything else steps back.
      pin.el.dataset.dim = String(!!a && slug !== highlight && ((!!shown && slug !== shown) || (!!filter && stateOf(a) !== filter)));
    });
    placeRef.current();
  }, [areas, highlight, shown, filter, dense]);

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
    // On a phone the sheet covers the bottom of the map.
    const wide = matchMedia("(min-width: 64rem)").matches;
    m.fitBounds([[w, s], [e, n]], { padding: { top: 40, bottom: wide ? 60 : 220, left: 40, right: 56 }, maxZoom: 9, duration: 500 });
  }, [focus]);

  return (
    <figure ref={frameRef} className="ffx-map sx-home-map" aria-label="Collections in the South Platte basin">
      <div ref={canvasRef} className="ffx-map-canvas sx-home-canvas" />
      {basemapDown && <div className="ffx-map-note">Basemap unavailable, showing data only.</div>}
      <figcaption className="ffx-map-readout">
        {credits.length > 0 && (
          <span className="sx-credit" data-open={creditsOpen}>
            <button
              type="button"
              className="sx-credit-btn"
              aria-expanded={creditsOpen}
              aria-label={creditsOpen ? "Hide map credits" : "Map credits"}
              onClick={() => setCreditsOpen((v) => !v)}
            >
              i
            </button>
            {creditsOpen && <CreditLine credits={credits} />}
          </span>
        )}
        {areas.length > 0 && (
          <span className="sx-legend-box">
            {dense?.steps && (
              <span className="sx-legend sx-legend-density">
                <span>{dense.kind === "storms" ? "Storms" : "Items"} covering each spot</span>
                {dense.steps.map(([lo, hi], i) => (
                  <span key={i} className="sx-legend">
                    <i className="sx-legend-step" data-step={i + 1} aria-hidden="true" />
                    <span className="ffx-num">{i === 2 ? `${lo}+` : lo === hi ? lo : `${lo}–${hi}`}</span>
                  </span>
                ))}
              </span>
            )}
            <span className="sx-legend sx-legend-states">
              {(["approved", "needs_revision", "rejected", "pending"] as const).map((s) => (
                <span key={s} className="sx-legend">
                  <QcMark state={s} />
                  <span className="sx-legend-l">{QC_STATUSES.find((x) => x.value === s)!.label}</span>
                </span>
              ))}
              <span className="sx-legend-short">Review state</span>
            </span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
