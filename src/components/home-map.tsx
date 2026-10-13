"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExpressionSpecification, GeoJSONSource, LngLat, Map as MapLibreMap, Point, Popup } from "maplibre-gl";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
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
import type { HomeArea, Member } from "./home";
import { membersHead } from "./home-preview";
import { BASINS_URL, FOCUS_BASIN, FOCUS_BBOX } from "@/lib/basins";
import { fmtNum } from "@/lib/format";
import { MapCard } from "./map-card";

/**
 * The landing page map: the South Platte basin, and the footprint of the
 * collection picked in the rail.
 *
 * There are no pins. Most collections cover the whole basin, so a pin at
 * each one's middle would stack on the basin's middle, and the one local
 * collection would be the only name on the map. The rail is the way in;
 * the map shows how much ground the collection covers.
 *
 * The South Platte is the only basin the program cares about, so the map
 * opens on it and its outline is the only boundary drawn. Inside the line
 * the basemap is at full strength: paper-white land, shaded relief, rivers
 * in blue. Everything beyond it sits under a darker, sand-colored wash, so
 * the basin reads as the lit shape on the card.
 *
 * Until something is selected or pointed at, the map holds only the basin, so
 * it stays readable however many collections there are. Selecting a
 * collection, or resting the pointer on one while nothing is selected, draws
 * its footprint without moving the map: small dots for
 * point items like gages, a faint fill and an outline for the area a model
 * covers, three steps of blue for how many shapes cover each spot when they
 * overlap heavily, or a dashed box when the shapes were too heavy to send
 * (lib/overview.ts decides which).
 * When the footprint is a few shapes (a calibration collection's HMS and RAS
 * models of one basin, stacked), pointing at it names every shape under the
 * cursor and lights up their rows in the rail, and pointing at a row lights
 * up its shape here, since stacked fills look like one. Pointing at a dot
 * names its item too.
 *
 * Clicking the selected collection's footprint opens a card there: the
 * collection as its heading, with the way to it, and under that every item
 * under the click, each row the way to its page. Where the map
 * can't tell the items apart (a dense footprint, an extent box, the lit
 * basin, or one shape shared by many items) the card is the collection
 * alone. Clicking anywhere else closes it; the map never moves on a click.
 *
 * A collection whose shapes contain the whole basin has no footprint
 * of its own: the basin lights up instead, since the shape would tint the
 * whole map, and a note at the bottom of the map says so, since a lit basin on
 * its own can read as the basin's usual styling.
 */

const SRC_ITEMS = "sx-items";
const SRC_BASINS = "sx-basins";
const SRC_MASK = "sx-mask";
const L = {
  mask: "sx-outside-mask",
  basinCover: "sx-basin-cover",
  basinLine: "sx-basin-line",
  itemFill: "sx-live-fill",
  itemExtent: "sx-live-extent",
  itemLine: "sx-live-line",
  itemHi: "sx-live-hi",
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
  drawn: string | null,
  hoverKeys: string[],
  basinHighlight: string | null,
  basinCovered: boolean,
) {
  dressBasemap(map, p);
  map.addSource(SRC_MASK, { type: "geojson", data: { type: "Feature", properties: {}, geometry: outside(basin?.geometry ?? null) } });
  map.addSource(SRC_ITEMS, { type: "geojson", data: items });
  map.addSource(SRC_BASINS, { type: "geojson", data: basinData(basin) });

  // The surround token carries its own alpha, so each palette picks how
  // much of the outside to dim.
  map.addLayer({
    id: L.mask, type: "fill", source: SRC_MASK,
    paint: { "fill-color": p.mapSurround, "fill-opacity": 1 },
  });
  // A selected basin is marked by its outline alone, so the land stays paper
  // white, except while the selected collection covers the whole basin:
  // then the basin itself is its footprint, in the same blue the fills use.
  map.addLayer({
    id: L.basinCover, type: "fill", source: SRC_BASINS, filter: basinCoverFilter(basinCovered),
    paint: { "fill-color": p.trace, "fill-opacity": 0.16, "fill-antialias": false },
  });
  map.addLayer({
    id: L.basinLine, type: "line", source: SRC_BASINS,
    layout: { "line-join": "round" },
    paint: { "line-color": p.ink, "line-width": basinLineWidth(basinHighlight), "line-opacity": 0.85 },
  });

  map.addLayer({
    id: L.itemFill, type: "fill", source: SRC_ITEMS, filter: footprintFilter("fill", drawn),
    // Antialiasing draws a seam wherever two subbasins meet; the outline
    // layer already gives the edge. A few stacked shapes each get one of
    // the three blues (lib/overview.ts), the pale one stronger so it shows
    // on the white basin.
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
    id: L.itemHi, type: "line", source: SRC_ITEMS, filter: hiFilter(drawn, hoverKeys),
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": p.ink, "line-width": 2.25, "line-opacity": 0.95 },
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

/** One part of the drawn collection's footprint; nothing when none is drawn. */
function footprintFilter(role: string, slug: string | null): ExpressionSpecification {
  return ["all", ["==", ["get", "role"], role], ["==", ["get", "slug"], slug ?? ""]];
}

/** The selected collection's shapes with these keys. */
function hiFilter(shown: string | null, keys: string[]): ExpressionSpecification {
  return ["all", footprintFilter("fill", shown), ["in", ["get", "key"], ["literal", keys]]];
}

/** How far around the cursor, in pixels, counts as pointing at a shape. */
const HIT = 4;
/** The most names the tooltip lists before "and N more". */
const TIP_ROWS = 6;

/** The basin's own fill: on while the drawn collection covers all of it, off otherwise. */
function basinCoverFilter(covered: boolean): ExpressionSpecification {
  return ["==", ["get", "huc4"], covered ? FOCUS_BASIN : ""];
}

function basinData(basin: Feature<Shape> | null): FeatureCollection {
  return { type: "FeatureCollection", features: basin ? [basin] : [] };
}

function basinLineWidth(basinHighlight: string | null) {
  return basinHighlight === FOCUS_BASIN ? 3.25 : 2.5;
}

/** An item the map can name: a dot, or one of a few keyed shapes. */
type Hit = Omit<Member, "key">;

/** What a click can land on: the shapes and dots of the selected collection, or the lit basin. */
const PICK = [L.items, L.itemFill, L.itemLine, L.density, L.densityLine, L.basinCover];

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
  const [w, s, e, n] = area.bbox;
  const inBox = area.drawn === "extent" && lngLat.lng >= w && lngLat.lng <= e && lngLat.lat >= s && lngLat.lat <= n;
  if (!found.length && !inBox) return null;
  const keys = new Set<string>();
  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const f of found) {
    const p = f.properties ?? {};
    if (typeof p.key === "string") keys.add(p.key);
    if (f.layer.id === L.items && typeof p.id === "string" && !seen.has(p.id)) {
      seen.add(p.id);
      hits.push({ id: p.id, label: typeof p.label === "string" ? p.label : p.id, hideId: p.hideId === true, kind: typeof p.kind === "string" ? p.kind : null });
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
  shown,
  preview,
  basinHighlight,
  basinCovered,
  hoverKeys,
  onHoverKeys,
}: {
  areas: HomeArea[];
  /** Every collection's footprint, from lib/overview.ts. */
  items: FeatureCollection;
  /** The selected collection. */
  shown: string | null;
  /** The collection pointed at while nothing is selected; its footprint is drawn as a preview. */
  preview: string | null;
  basinHighlight: string | null;
  /** The drawn collection contains the whole basin, so the basin is lit up as its footprint. */
  basinCovered: boolean;
  /** The shapes of the shown collection to outline: pointed at here or in the rail. */
  hoverKeys: string[];
  onHoverKeys: (keys: string[]) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  // Where the card renders: a div the popup owns, portaled into from React.
  const [cardHost, setCardHost] = useState<HTMLDivElement | null>(null);
  const [credits, setCredits] = useState<Credit[]>([]);
  // The collection whose footprint is on the map: the selected one, or else
  // the one pointed at.
  const drawn = shown ?? preview;
  const current = areas.find((a) => a.slug === drawn) ?? null;
  const dense = current?.drawn === "density" ? current : null;
  const [basemapDown, setBasemapDown] = useState(false);
  // The members under the cursor, named beside it. Kept with the slug they
  // belong to, so a new selection drops a stale one.
  const [tipState, setTip] = useState<{ slug: string; x: number; y: number; flip: boolean; rows: Hit[] } | null>(null);
  // The card on a clicked spot, kept with its slug the same way.
  const [cardState, setCard] = useState<Card | null>(null);
  const card = cardState?.slug === shown ? cardState : null;
  // The tooltip steps aside while the card already lists the same stack.
  const tip = tipState?.slug === shown && !(card && sameIds(card.hits, tipState.rows)) ? tipState : null;
  // Latest props for the one-time setup below. Written in an effect, never
  // during render.
  const areasRef = useRef(areas);
  const itemsRef = useRef(items);
  const shownRef = useRef(shown);
  const drawnRef = useRef(drawn);
  const basinHighlightRef = useRef(basinHighlight);
  const basinCoveredRef = useRef(basinCovered);
  const hoverKeysRef = useRef(hoverKeys);
  const basinRef = useRef<Feature<Shape> | null>(null);
  const onHoverKeysRef = useRef(onHoverKeys);
  useEffect(() => {
    areasRef.current = areas;
    itemsRef.current = items;
    shownRef.current = shown;
    drawnRef.current = drawn;
    basinHighlightRef.current = basinHighlight;
    basinCoveredRef.current = basinCovered;
    hoverKeysRef.current = hoverKeys;
    onHoverKeysRef.current = onHoverKeys;
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

      const cardDiv = document.createElement("div");
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        maxWidth: "none",
        className: "ffx-map-pin sx-map-card sx-map-card-band",
      }).setDOMContent(cardDiv);
      setCardHost(cardDiv);

      const fit = () => m.fitBounds([[FOCUS_BBOX[0], FOCUS_BBOX[1]], [FOCUS_BBOX[2], FOCUS_BBOX[3]]], { ...fitPadding(), duration: 300 });
      // The map already fills the window, so there's no full screen button.
      m.addControl(new Controls(m, frame, fit, "Fit to the South Platte", { fullscreen: false }), "top-right");
      // The map takes the window, so a resize changes what fits. With nothing
      // selected, keep the basin framed.
      m.on("resize", () => {
        if (!shownRef.current) m.fitBounds([[FOCUS_BBOX[0], FOCUS_BBOX[1]], [FOCUS_BBOX[2], FOCUS_BBOX[3]]], { ...fitPadding(), duration: 0 });
      });

      const draw = () => {
        if (m.getSource(SRC_ITEMS)) return;
        addLayers(
          m, palette(frame), itemsRef.current, basinRef.current, drawnRef.current, hoverKeysRef.current,
          basinHighlightRef.current, basinCoveredRef.current,
        );
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
      m.on("mousemove", (e) => {
        const area = shownArea();
        const got = pickAt(m, e.point, e.lngLat, area);
        m.getCanvas().style.cursor = got ? "pointer" : "";
        hoverKeysTo(got?.keys ?? []);
        if (!area || !got?.hits.length) return setTip(null);
        const { x, y } = e.point;
        setTip({ slug: area.slug, x, y, flip: x > m.getCanvas().clientWidth - 300, rows: got.hits });
      });
      m.on("mouseout", () => {
        setTip(null);
        hoverKeysTo([]);
      });
      m.on("click", (e) => {
        const area = shownArea();
        const got = pickAt(m, e.point, e.lngLat, area);
        setCard(area && got ? { slug: area.slug, at: e.lngLat.toArray() as [number, number], hits: got.hits } : null);
      });

      unwatch = watchTheme(() => {
        for (const id of [...Object.values(L), LAYER_RELIEF]) if (m.getLayer(id)) m.removeLayer(id);
        for (const id of [SRC_MASK, SRC_ITEMS, SRC_BASINS, SRC_TERRAIN]) if (m.getSource(id)) m.removeSource(id);
        basemap();
      });
    });

    return () => {
      disposed = true;
      unwatch?.();
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

  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.itemFill)) return;
    for (const [id, role] of FOOTPRINT_ROLES) m.setFilter(id, footprintFilter(role, drawn));
  }, [drawn]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.basinCover)) return;
    m.setFilter(L.basinCover, basinCoverFilter(basinCovered));
  }, [basinCovered]);

  useEffect(() => {
    const m = mapRef.current;
    if (m?.getLayer(L.itemHi)) m.setFilter(L.itemHi, hiFilter(shown, hoverKeys));
  }, [shown, hoverKeys]);

  useEffect(() => {
    const src = mapRef.current?.getSource(SRC_ITEMS) as GeoJSONSource | undefined;
    if (src) src.setData(items);
  }, [items]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m?.getLayer(L.basinLine)) return;
    m.setPaintProperty(L.basinLine, "line-width", basinLineWidth(basinHighlight));
  }, [basinHighlight]);

  return (
    <figure ref={frameRef} className="ffx-map sx-home-map" aria-label="Collections in the South Platte basin">
      <div ref={canvasRef} className="ffx-map-canvas sx-home-canvas" />
      {tip && (
        <div className="ffx-map-tip" data-stack={tip.rows.length > 1 || undefined} data-flip={tip.flip || undefined} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
          {tip.rows.slice(0, TIP_ROWS).map((r) => (
            <span key={r.id} className="ffx-map-tip-row">
              {r.tint && <i className="sx-swatch" data-step={r.tint} aria-hidden="true" />}
              {r.kind && <span className="ffx-map-tip-kind">{r.kind}</span>}
              <span className="ffx-map-tip-label">{r.label}</span>
              {!r.hideId && <span className="ffx-id">{r.id}</span>}
            </span>
          ))}
          {tip.rows.length > TIP_ROWS && <span className="ffx-map-tip-more">and {tip.rows.length - TIP_ROWS} more</span>}
        </div>
      )}
      {cardHost && card && current && createPortal(<HomeCard area={current} hits={card.hits} />, cardHost)}
      {basinCovered && <div className="sx-map-cover">Covers the whole South Platte basin</div>}
      {basemapDown && <div className="ffx-map-note">Basemap unavailable, showing data only.</div>}
      <figcaption className="ffx-map-readout">
        <MapCredits credits={credits} />
        {current?.members && !dense && <span className="sx-map-count">{membersHead(current)}</span>}
        {dense?.steps && (
          <span className="sx-map-key">
            {dense?.steps && (
              <span className="sx-density-box">
                <span>{dense.kind === "storms" ? "Storms" : "Items"} covering each spot</span>
                {dense.steps.map(([lo, hi], i) => (
                  <span key={i} className="sx-legend">
                    <i className="sx-legend-step" data-step={i + 1} aria-hidden="true" />
                    <span className="ffx-num">{i === 2 ? `${lo}+` : lo === hi ? lo : `${lo}–${hi}`}</span>
                  </span>
                ))}
              </span>
            )}
          </span>
        )}
      </figcaption>
    </figure>
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
      action={{ href: area.href, label: "Open collection" }}
      note={
        <>
          <span className="ffx-num">{fmtNum(area.itemCount)}</span> {area.itemCount === 1 ? "item" : "items"}
        </>
      }
      rows={hits.map((h) => ({ ...h, href: `${area.href}/items/${encodeURIComponent(h.id)}` }))}
    />
  );
}
