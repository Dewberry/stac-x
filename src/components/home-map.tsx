"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExpressionSpecification, GeoJSONSource, LngLat, Map as MapLibreMap, Point, Popup } from "maplibre-gl";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  applyBasemap,
  blankStyle,
  Controls,
  creditsOf,
  MapCredits,
  dressBasemap,
  LAYER_RELIEF,
  palette,
  SRC_TERRAIN,
  tintColor,
  tintOpacity,
  watchTheme,
  WORKER_URL,
  type Credit,
  type Palette,
} from "./map-core";
import type { FocusArea, HomeArea, Member } from "./home";
import { fmtNum, fmtRange } from "@/lib/format";
import { Icon, ICONS } from "./icons";
import { MapCard } from "./map-card";

/**
 * The landing page map: the deployment's area, and the footprint of the
 * collection picked in the rail.
 *
 * There are no pins. Most collections cover the whole area, so a pin at
 * each one's middle would stack on the area's middle, and the one local
 * collection would be the only name on the map. The rail is the way in;
 * the map shows how much ground the collection covers.
 *
 * The area (STAC_MAP_AREA, lib/map-area.ts) is what the deployment is
 * about, so the map opens on it and its outline is the only boundary drawn.
 * Inside the line the basemap is at full strength: paper-white land, shaded
 * relief, rivers in blue. Everything beyond it sits under a darker,
 * sand-colored wash, so the area reads as the lit shape on the card. With
 * no area set there's no line and no wash, and the map opens on everything
 * the catalog covers.
 *
 * Until something is selected or pointed at, the map holds only the area, so
 * it stays readable however many collections there are. Selecting a
 * collection draws its footprint: small dots for point items like gages, a
 * faint fill and an outline for the area a model covers, three steps of
 * blue for how many shapes cover each spot when they overlap heavily, or a
 * dashed box when the shapes were too heavy to send (lib/overview.ts
 * decides which). The map then frames the footprint, unless the viewer has
 * moved the map by hand since the last pick; a pill in the corner says what
 * it's framed to and takes it back to the whole area. Resting the pointer
 * on another row in the rail draws that one's footprint over the selected
 * one until the pointer leaves.
 *
 * The map and the rail are one view. Pointing at an item here rings it and
 * names it, with its id and dates and a note that a click opens it, and
 * lights its row in the rail; pointing at a row in the rail rings its dot
 * or outlines its shape here. When the footprint is a few shapes (a
 * calibration collection's HMS and RAS models of one basin, stacked),
 * pointing at it names every shape under the cursor, since stacked fills
 * look like one. A search in the rail rings the items that match and dims
 * the rest.
 *
 * Clicking an item opens its page. Where several items are under the click
 * (stacked shapes) a card opens there instead: the collection as its
 * heading, with the way to it, and every item under the click, each row the
 * way to its page. Where the map can't tell the items apart (a dense
 * footprint, an extent box, the lit area, or one shape shared by many
 * items) the card is the collection alone. Clicking anywhere else closes
 * it; the map never moves on a click.
 *
 * A collection whose shapes contain the whole area has no footprint of its
 * own: the area lights up instead, since the shape would tint the whole map.
 */

const SRC_ITEMS = "sx-items";
const SRC_AREA = "sx-area";
const SRC_MASK = "sx-mask";
const L = {
  mask: "sx-outside-mask",
  areaCover: "sx-area-cover",
  areaLine: "sx-area-line",
  itemFill: "sx-live-fill",
  itemExtent: "sx-live-extent",
  itemLine: "sx-live-line",
  itemHi: "sx-live-hi",
  density: "sx-live-density",
  densityLine: "sx-live-density-line",
  itemRing: "sx-live-ring",
  items: "sx-live-items",
};

/** Even room around the area, a little more at the bottom for the legend. */
function fitPadding() {
  return { padding: { top: 28, right: 28, bottom: 56, left: 28 } };
}
/** How close the map goes when it frames one collection: a watershed, not a street. */
const FIT_MAX_ZOOM = 11;

/**
 * Everything but the area: the world as an outer ring with the area cut out
 * as a hole. Painted as a translucent wash so the country around it stays
 * readable (gages and collections run past the edge) but the area is the
 * subject. Nothing when there's no area.
 */
function outside(shape: MultiPolygon | null): FeatureCollection {
  if (!shape) return { type: "FeatureCollection", features: [] };
  const world: Polygon = {
    type: "Polygon",
    coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...shape.coordinates.map((poly) => poly[0])],
  };
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: world }] };
}

function areaData(area: FocusArea | null): FeatureCollection {
  return { type: "FeatureCollection", features: area ? [{ type: "Feature", properties: {}, geometry: area.geometry }] : [] };
}

function addLayers(
  map: MapLibreMap,
  p: Palette,
  items: FeatureCollection,
  area: FocusArea | null,
  drawn: string[],
  shown: string | null,
  hoverKeys: string[],
  ringIds: string[],
  areaHighlight: boolean,
  areaCovered: boolean,
) {
  dressBasemap(map, p);
  map.addSource(SRC_MASK, { type: "geojson", data: outside(area?.geometry ?? null) });
  map.addSource(SRC_ITEMS, { type: "geojson", data: items });
  map.addSource(SRC_AREA, { type: "geojson", data: areaData(area) });

  // The surround token carries its own alpha, so each palette picks how
  // much of the outside to dim.
  map.addLayer({
    id: L.mask, type: "fill", source: SRC_MASK,
    paint: { "fill-color": p.mapSurround, "fill-opacity": 1 },
  });
  // The area is marked by its outline alone, so the land stays paper white,
  // except while the selected collection covers the whole area: then the
  // area itself is its footprint, in the same blue the fills use.
  map.addLayer({
    id: L.areaCover, type: "fill", source: SRC_AREA,
    layout: { visibility: areaCovered ? "visible" : "none" },
    paint: { "fill-color": p.trace, "fill-opacity": 0.16, "fill-antialias": false },
  });
  map.addLayer({
    id: L.areaLine, type: "line", source: SRC_AREA,
    layout: { "line-join": "round" },
    paint: { "line-color": p.ink, "line-width": areaLineWidth(areaHighlight), "line-opacity": 0.85 },
  });

  map.addLayer({
    id: L.itemFill, type: "fill", source: SRC_ITEMS, filter: footprintFilter("fill", drawn),
    // Antialiasing draws a seam wherever two subbasins meet; the outline
    // layer already gives the edge. A few stacked shapes each get one of
    // the three blues (lib/overview.ts), the pale one stronger so it shows
    // on the white area.
    paint: { "fill-color": tintColor(p), "fill-opacity": tintOpacity(0.16), "fill-antialias": false },
  });
  // Overlap density: three steps of river blue, palest for the fewest.
  map.addLayer({
    id: L.density, type: "fill", source: SRC_ITEMS, filter: footprintFilter("density", drawn),
    paint: {
      "fill-color": ["match", ["get", "step"], 1, p.traceSoft, 2, p.trace, p.traceDeep],
      "fill-opacity": ["match", ["get", "step"], 1, 0.5, 2, 0.42, 0.62],
      "fill-antialias": false,
    },
  });
  // Each shape's own outline, once the map is close enough to tell them apart.
  map.addLayer({
    id: L.densityLine, type: "line", source: SRC_ITEMS, filter: footprintFilter("outline", drawn), minzoom: 9,
    paint: { "line-color": p.trace, "line-width": 0.6, "line-opacity": 0.6 },
  });
  map.addLayer({
    id: L.itemExtent, type: "line", source: SRC_ITEMS, filter: footprintFilter("extent", drawn),
    paint: { "line-color": p.trace, "line-width": 1.75, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: L.itemLine, type: "line", source: SRC_ITEMS, filter: footprintFilter("line", drawn),
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": p.trace, "line-width": 1.75, "line-opacity": 0.9 },
  });
  // The shapes pointed at, outlined in ink over their neighbors.
  map.addLayer({
    id: L.itemHi, type: "line", source: SRC_ITEMS, filter: hiFilter(shown, hoverKeys),
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": p.ink, "line-width": 2.25, "line-opacity": 0.95 },
  });
  // A ring around the dots pointed at or found by a search, under the dots.
  map.addLayer({
    id: L.itemRing, type: "circle", source: SRC_ITEMS, filter: ringFilter(shown, ringIds),
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 8, 9, 11],
      "circle-opacity": 0,
      "circle-stroke-color": p.trace,
      "circle-stroke-width": 2.5,
      "circle-stroke-opacity": 0.9,
    },
  });
  map.addLayer({
    id: L.items, type: "circle", source: SRC_ITEMS, filter: footprintFilter("point", drawn),
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

/** One part of the drawn collections' footprints; nothing when none is drawn. */
function footprintFilter(role: string, slugs: string[]): ExpressionSpecification {
  return ["all", ["==", ["get", "role"], role], ["in", ["get", "slug"], ["literal", slugs]]];
}

/** The selected collection's shapes with these keys. */
function hiFilter(shown: string | null, keys: string[]): ExpressionSpecification {
  return ["all", footprintFilter("fill", shown ? [shown] : []), ["in", ["get", "key"], ["literal", keys]]];
}

/** The selected collection's dots with these ids. */
function ringFilter(shown: string | null, ids: string[]): ExpressionSpecification {
  return ["all", footprintFilter("point", shown ? [shown] : []), ["in", ["get", "id"], ["literal", ids]]];
}

/** How far around the cursor, in pixels, counts as pointing at a shape. */
const HIT = 4;
/** The most names the tooltip lists before "and N more". */
const TIP_ROWS = 6;

function areaLineWidth(highlight: boolean) {
  return highlight ? 3.25 : 2.5;
}

/** An item the map can name: a dot, or one of a few keyed shapes. */
type Hit = Omit<Member, "key">;

/** What a click can land on: the shapes and dots of the selected collection, or the lit area. */
const PICK = [L.items, L.itemFill, L.itemLine, L.density, L.densityLine, L.areaCover];

/**
 * What of the shown collection is under a point: null when the point misses
 * it, else the items there the map can name (none when it can't tell them
 * apart) and the keys of the shapes, for the rail to light up.
 */
function pickAt(m: MapLibreMap, point: Point, lngLat: LngLat, area: HomeArea | undefined) {
  if (!area) return null;
  const { x, y } = point;
  const layers = PICK.filter((l) => m.getLayer(l));
  const found = layers.length ? m.queryRenderedFeatures([[x - HIT, y - HIT], [x + HIT, y + HIT]], { layers }) : [];
  // A dashed extent box is a line; anywhere inside it counts.
  const [w, s, e, n] = area.bbox ?? [0, 0, 0, 0];
  const inBox = area.drawn === "extent" && !!area.bbox && lngLat.lng >= w && lngLat.lng <= e && lngLat.lat >= s && lngLat.lat <= n;
  if (!found.length && !inBox) return null;
  const keys = new Set<string>();
  const seen = new Set<string>();
  const hits: Hit[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  for (const f of found) {
    const p = f.properties ?? {};
    if (typeof p.key === "string") keys.add(p.key);
    if (f.layer.id === L.items && typeof p.id === "string" && !seen.has(p.id)) {
      seen.add(p.id);
      hits.push({ id: p.id, label: str(p.label) ?? p.id, hideId: p.hideId === true, kind: str(p.kind), start: str(p.start), end: str(p.end) });
    }
  }
  for (const mm of area.members ?? []) {
    if (keys.has(mm.key) && !seen.has(mm.id)) {
      seen.add(mm.id);
      hits.push(mm);
    }
  }
  return { hits, keys: Array.from(keys) };
}

const sameIds = (a: Hit[], b: Hit[]) => a.length === b.length && a.every((h, i) => h.id === b[i].id);

/** A clicked spot on the map and what's under it. */
type Card = { slug: string; at: [number, number]; hits: Hit[] };

export function HomeMap({
  areas,
  items,
  area,
  frame,
  frameName,
  shown,
  preview,
  areaHighlight,
  areaCovered,
  hoverKeys,
  onHoverKeys,
  ringIds,
  onHoverItem,
  onOpenItem,
}: {
  areas: HomeArea[];
  /** Every collection's footprint, from lib/overview.ts. */
  items: FeatureCollection;
  /** The deployment's area, outlined with everything outside it dimmed; null for none. */
  area: FocusArea | null;
  /** Where the map opens and what the fit button goes back to: west, south, east, north. */
  frame: [number, number, number, number];
  /** What the frame is when it isn't the area: the catalog opened in the rail. */
  frameName?: string | null;
  /** The selected collection. */
  shown: string | null;
  /** The collection pointed at in the rail; its footprint is drawn over the selected one's as a preview. */
  preview: string | null;
  /** The selected or pointed-at collection is in the area, so its outline is heavier. */
  areaHighlight: boolean;
  /** A drawn collection contains the whole area, so the area is lit up as its footprint. */
  areaCovered: boolean;
  /** The shapes of the shown collection to outline: pointed at here or in the rail. */
  hoverKeys: string[];
  onHoverKeys: (keys: string[]) => void;
  /** The shown collection's dots to ring: the one pointed at, here or in the rail. */
  ringIds: string[];
  /** The one item under the cursor here, for the rail to light up. */
  onHoverItem: (id: string | null) => void;
  /** Opens the item's page, from a click on it. */
  onOpenItem: (id: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  // Where the card renders: a div the popup owns, portaled into from React.
  const [cardHost, setCardHost] = useState<HTMLDivElement | null>(null);
  const [credits, setCredits] = useState<Credit[]>([]);
  // The collections whose footprints are on the map: the selected one, and
  // the one pointed at over it.
  const drawn = [shown, preview].filter((s): s is string => !!s);
  const current = areas.find((a) => a.slug === shown) ?? null;
  // A metadata-only parent has no footprint to frame. Bring its hovered
  // child into view instead, then restore the parent's frame on leave.
  const fitSlug = current && !current.drawn && preview ? preview : shown;
  const dense = areas.find((a) => drawn.includes(a.slug) && a.drawn === "density") ?? null;
  const [basemapDown, setBasemapDown] = useState(false);
  // The members under the cursor, named beside it. Kept with the slug they
  // belong to, so a new selection drops a stale one.
  const [tipState, setTip] = useState<{ slug: string; x: number; y: number; flip: boolean; rows: Hit[] } | null>(null);
  // The card on a clicked spot, kept with its slug the same way.
  const [cardState, setCard] = useState<Card | null>(null);
  const card = cardState?.slug === shown ? cardState : null;
  // The tooltip steps aside while the card already lists the same stack.
  const tip = tipState?.slug === shown && !(card && sameIds(card.hits, tipState.rows)) ? tipState : null;
  // The collection the map is framed to, when that's narrower than the area.
  const [framed, setFramed] = useState<string | null>(null);
  const framedArea = framed && framed === fitSlug ? (areas.find((a) => a.slug === framed) ?? null) : null;
  // Latest props for the one-time setup below. Written in an effect, never
  // during render.
  const areasRef = useRef(areas);
  const itemsRef = useRef(items);
  const shownRef = useRef(shown);
  const drawnRef = useRef(drawn);
  const areaRef = useRef(area);
  const frameBoxRef = useRef(frame);
  // What the fit button says it fits to: the opened catalog, or the area.
  const fitLabel = frameName ? `Fit to ${frameName}` : area ? `Fit to ${area.name}` : "Fit to the catalog";
  const fitLabelRef = useRef(fitLabel);
  const controlsRef = useRef<Controls | null>(null);
  const areaHighlightRef = useRef(areaHighlight);
  const areaCoveredRef = useRef(areaCovered);
  const hoverKeysRef = useRef(hoverKeys);
  const ringIdsRef = useRef(ringIds);
  const onHoverKeysRef = useRef(onHoverKeys);
  const onHoverItemRef = useRef(onHoverItem);
  const onOpenItemRef = useRef(onOpenItem);
  // Whether the viewer has moved the map by hand since the last pick.
  const movedByHand = useRef(false);
  // What the map is being framed to by a fit, read when the move ends.
  const framingRef = useRef<string | null>(null);
  const fitFrameRef = useRef<(duration?: number) => void>(() => {});
  useEffect(() => {
    areasRef.current = areas;
    itemsRef.current = items;
    shownRef.current = shown;
    drawnRef.current = drawn;
    areaRef.current = area;
    frameBoxRef.current = frame;
    areaHighlightRef.current = areaHighlight;
    areaCoveredRef.current = areaCovered;
    hoverKeysRef.current = hoverKeys;
    ringIdsRef.current = ringIds;
    onHoverKeysRef.current = onHoverKeys;
    onHoverItemRef.current = onHoverItem;
    onOpenItemRef.current = onOpenItem;
  });

  useEffect(() => {
    const frame = frameRef.current;
    const host = canvasRef.current;
    if (!frame || !host) return;
    let map: MapLibreMap | null = null;
    let disposed = false;
    let unwatch: (() => void) | null = null;
    let sizeObserver: ResizeObserver | null = null;

    void import("maplibre-gl").then((maplibregl) => {
      if (disposed) return;
      maplibregl.setWorkerUrl(WORKER_URL);
      const p = palette(frame);
      const bounds = (): [[number, number], [number, number]] => {
        const [w, s, e, n] = frameBoxRef.current;
        return [[w, s], [e, n]];
      };
      const m = new maplibregl.Map({
        container: host,
        style: blankStyle(p),
        attributionControl: false,
        bounds: bounds(),
        fitBoundsOptions: fitPadding(),
        maxZoom: 14,
        minZoom: 2,
        cooperativeGestures: matchMedia("(pointer: coarse)").matches,
      });
      map = m;
      mapRef.current = m;
      // Pane drags change the container without resizing the browser window.
      sizeObserver = new ResizeObserver(() => m.resize());
      sizeObserver.observe(host);
      // A handle for the console while developing: __sxMap.getStyle(), etc.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __sxMap?: unknown }).__sxMap = m;

      const cardDiv = document.createElement("div");
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        maxWidth: "none",
        className: "ffx-map-pin sx-map-card sx-map-card-band",
      }).setDOMContent(cardDiv);
      setCardHost(cardDiv);

      // A move with a pointer or wheel behind it is the viewer's own; the
      // map then stays where they put it until their next pick, and the
      // "framed to" pill goes, since it no longer is. A move without one is
      // a fit, which the pill then names.
      m.on("moveend", (e) => {
        if ((e as { originalEvent?: Event }).originalEvent) {
          movedByHand.current = true;
          setFramed(null);
        } else setFramed(framingRef.current);
      });
      const fitFrame = (duration = 750) => {
        movedByHand.current = false;
        framingRef.current = null;
        m.fitBounds(bounds(), { ...fitPadding(), duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration });
      };
      fitFrameRef.current = fitFrame;
      // The map already fills the window, so there's no full screen button.
      const controls = new Controls(m, frame, () => fitFrame(), fitLabelRef.current, { fullscreen: false });
      controlsRef.current = controls;
      m.addControl(controls, "top-right");
      // The map takes the window, so a resize changes what fits. With nothing
      // selected, keep the area framed.
      m.on("resize", () => {
        if (!shownRef.current && !movedByHand.current) m.fitBounds(bounds(), { ...fitPadding(), duration: 0 });
      });

      const draw = () => {
        if (m.getSource(SRC_ITEMS)) return;
        addLayers(
          m, palette(frame), itemsRef.current, areaRef.current, drawnRef.current, shownRef.current, hoverKeysRef.current,
          ringIdsRef.current, areaHighlightRef.current, areaCoveredRef.current,
        );
        setCredits(creditsOf(m));
      };
      const basemap = () => applyBasemap(m, frame, draw, setBasemapDown, () => disposed);

      m.on("load", () => {
        draw();
        basemap();
      });
      m.on("sourcedata", () => setCredits(creditsOf(m)));

      // Pointing at the shown collection names the items under the cursor,
      // which is how stacked models are told apart, and says it can be
      // clicked.
      const shownArea = () => areasRef.current.find((a) => a.slug === shownRef.current);
      // Only a change goes up, so moving over bare map doesn't render the page.
      const hoverKeysTo = (keys: string[]) => {
        if (keys.join("|") !== hoverKeysRef.current.join("|")) onHoverKeysRef.current(keys);
      };
      let hoverItem: string | null = null;
      const hoverItemTo = (id: string | null) => {
        if (id !== hoverItem) onHoverItemRef.current((hoverItem = id));
      };
      m.on("mousemove", (e) => {
        const area = shownArea();
        const got = pickAt(m, e.point, e.lngLat, area);
        m.getCanvas().style.cursor = got ? "pointer" : "";
        hoverKeysTo(got?.keys ?? []);
        hoverItemTo(got?.hits.length === 1 ? got.hits[0].id : null);
        if (!area || !got?.hits.length) return setTip(null);
        const { x, y } = e.point;
        setTip({ slug: area.slug, x, y, flip: x > m.getCanvas().clientWidth - 300, rows: got.hits });
      });
      m.on("mouseout", () => {
        setTip(null);
        hoverKeysTo([]);
        hoverItemTo(null);
      });
      // One item under the click opens its page, the same as its row in the
      // rail; a stack, or a footprint the map can't tell apart, opens the card.
      m.on("click", (e) => {
        const area = shownArea();
        const got = pickAt(m, e.point, e.lngLat, area);
        if (area && got?.hits.length === 1) return onOpenItemRef.current(got.hits[0].id);
        setCard(area && got ? { slug: area.slug, at: e.lngLat.toArray() as [number, number], hits: got.hits } : null);
      });

      unwatch = watchTheme(() => {
        for (const id of [...Object.values(L), LAYER_RELIEF]) if (m.getLayer(id)) m.removeLayer(id);
        for (const id of [SRC_MASK, SRC_ITEMS, SRC_AREA, SRC_TERRAIN]) if (m.getSource(id)) m.removeSource(id);
        basemap();
      });
    });

    return () => {
      disposed = true;
      unwatch?.();
      sizeObserver?.disconnect();
      popupRef.current?.remove();
      popupRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // Built once; highlight and data changes are applied by the effects below.

  }, []);

  useEffect(() => {
    const m = mapRef.current;
    const popup = popupRef.current;
    if (!m || !popup) return;
    if (card) popup.setLngLat(card.at).addTo(m);
    else popup.remove();
  }, [card]);

  // Escape takes the tooltip away first, wherever focus is, so it can be
  // dismissed without moving the pointer.
  const tipOn = !!tip;
  useEffect(() => {
    if (!tipOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setTip(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [tipOn]);

  // Escape closes the card before it closes the selected row.
  const open = !!card;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setCard(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  // A pick frames the collection: its own extent when it has one of its
  // own, the whole area when it covers most of it, and the area again when
  // the pick is cleared. Not when the viewer has moved the map by hand
  // since the last pick; that one pick leaves the map where it is.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (movedByHand.current) {
      movedByHand.current = false;
      return;
    }
    const a = fitSlug ? areasRef.current.find((x) => x.slug === fitSlug) : null;
    if (!a || !a.bbox || a.wide || a.drawn === "area" || !a.drawn) return fitFrameRef.current();
    const [w, s, e, n] = a.bbox;
    framingRef.current = a.slug;
    m.fitBounds([[w, s], [e, n]], { ...fitPadding(), maxZoom: FIT_MAX_ZOOM, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 750 });
  }, [fitSlug]);

  useEffect(() => {
    fitLabelRef.current = fitLabel;
    controlsRef.current?.setFitLabel(fitLabel);
  }, [fitLabel]);

  // A catalog opened or closed in the rail moves the frame. With nothing
  // picked, the map goes there; a pick keeps the map on the pick, and
  // closing it goes back to the new frame.
  const frameKey = frame.join(",");
  const frameSeen = useRef(frameKey);
  useEffect(() => {
    if (frameSeen.current === frameKey) return;
    frameSeen.current = frameKey;
    if (!shownRef.current) fitFrameRef.current();
  }, [frameKey]);

  // The list is built each render; only a change in what's drawn matters.
  const drawnKey = drawn.join("|");
  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.itemFill)) return;
    const slugs = drawnKey ? drawnKey.split("|") : [];
    for (const [id, role] of FOOTPRINT_ROLES) m.setFilter(id, footprintFilter(role, slugs));
  }, [drawnKey]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.areaCover)) return;
    m.setLayoutProperty(L.areaCover, "visibility", areaCovered ? "visible" : "none");
  }, [areaCovered]);

  useEffect(() => {
    const m = mapRef.current;
    if (m?.getLayer(L.itemHi)) m.setFilter(L.itemHi, hiFilter(shown, hoverKeys));
  }, [shown, hoverKeys]);

  useEffect(() => {
    const m = mapRef.current;
    if (m?.getLayer(L.itemRing)) m.setFilter(L.itemRing, ringFilter(shown, ringIds));
  }, [shown, ringIds]);

  useEffect(() => {
    const src = mapRef.current?.getSource(SRC_ITEMS) as GeoJSONSource | undefined;
    if (src) src.setData(items);
  }, [items]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.areaLine)) return;
    m.setPaintProperty(L.areaLine, "line-width", areaLineWidth(areaHighlight));
  }, [areaHighlight]);

  return (
    <figure ref={frameRef} className="ffx-map sx-home-map" aria-label={area ? `Datasets in ${area.name}` : "Datasets on the map"}>
      <div ref={canvasRef} className="ffx-map-canvas sx-home-canvas" />
      {tip && (
        <div className="ffx-map-tip sx-map-tip" data-stack={tip.rows.length > 1 || undefined} data-flip={tip.flip || undefined} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
          {tip.rows.length === 1 ? (
            <ItemTip row={tip.rows[0]} />
          ) : (
            <>
              {tip.rows.slice(0, TIP_ROWS).map((r) => (
                <span key={r.id} className="ffx-map-tip-row">
                  {r.tint && <i className="sx-swatch" data-step={r.tint} aria-hidden="true" />}
                  {r.kind && <span className="ffx-map-tip-kind">{r.kind}</span>}
                  <span className="ffx-map-tip-label">{r.label}</span>
                  {!r.hideId && <span className="ffx-id">{r.id}</span>}
                </span>
              ))}
              {tip.rows.length > TIP_ROWS && <span className="ffx-map-tip-more">and {tip.rows.length - TIP_ROWS} more</span>}
              <span className="sx-map-tip-hint">Click for the items here</span>
            </>
          )}
        </div>
      )}
      {cardHost && card && current && createPortal(<HomeCard area={current} hits={card.hits} />, cardHost)}
      {basemapDown && <div className="ffx-map-note">Basemap unavailable, showing data only.</div>}
      <figcaption className="ffx-map-readout">
        <span className="sx-map-pills">
          <MapCredits credits={credits} />
          {framedArea && (
            <button type="button" className="sx-map-pill" onClick={() => fitFrameRef.current()}>
              <Icon d={ICONS.fit} size={12} />
              Framed to {framedArea.name} · <b>Show {frameName ?? (area ? area.name : "everything")}</b>
            </button>
          )}
        </span>
        {dense?.steps && (
          <span className="sx-map-key">
            <span className="sx-density-box">
              <span>Items covering each spot</span>
              {dense.steps.map(([lo, hi], i) => (
                <span key={i} className="sx-legend">
                  <i className="sx-legend-step" data-step={i + 1} aria-hidden="true" />
                  <span className="ffx-num">{i === 2 ? `${lo}+` : lo === hi ? lo : `${lo}–${hi}`}</span>
                </span>
              ))}
            </span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** One item under the cursor: its name, its id and dates, and what a click does. */
function ItemTip({ row }: { row: Hit }) {
  const when = fmtRange(row.start, row.end);
  return (
    <>
      <span className="sx-map-tip-name">
        {row.tint && <i className="sx-swatch" data-step={row.tint} aria-hidden="true" />}
        {row.label}
        {row.kind && <span className="ffx-map-tip-kind">{row.kind}</span>}
      </span>
      {(!row.hideId || when) && (
        <span className="sx-map-tip-meta">
          {!row.hideId && <span className="ffx-id">{row.id}</span>}
          {when && <span className="ffx-num">{when}</span>}
        </span>
      )}
      <span className="sx-map-tip-hint">Click to open the item</span>
    </>
  );
}

/**
 * The card on a clicked spot: the collection as the heading, with the way
 * to it, and the items under the click below. When the map can't name the
 * items, the collection's count in their place.
 */
function HomeCard({ area, hits }: { area: HomeArea; hits: Hit[] }) {
  return (
    <MapCard
      head={area.name}
      action={{ href: area.href, label: "Browse collection" }}
      note={
        <>
          <span className="ffx-num">{fmtNum(area.itemCount)}</span> {area.itemCount === 1 ? "item" : "items"}
        </>
      }
      rows={hits.map((h) => ({ ...h, href: `${area.href}/items/${encodeURIComponent(h.id)}` }))}
    />
  );
}
