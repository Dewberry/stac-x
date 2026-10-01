"use client";

import type { IControl, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

/**
 * What every map on the app shares: the palette read out of CSS, the basemap
 * choice, the button group, and the credit line. The two map components
 * (DataMap on a collection or item page, HomeMap on the landing page) are
 * built on this.
 */

export const STYLE_LIGHT =
  process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT || "https://tiles.openfreemap.org/styles/positron";
export const STYLE_DARK =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK || "https://tiles.openfreemap.org/styles/dark";

/**
 * Elevation tiles for the relief on the landing map: Mapzen's terrarium set,
 * open data on AWS, no key. Set the variable to nothing to turn relief off.
 */
export const TERRAIN_URL =
  process.env.NEXT_PUBLIC_MAP_TERRAIN ?? "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TERRAIN_CREDIT =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen terrain</a>';

export const WORKER_URL = "/vendor/maplibre-gl/maplibre-gl-worker.mjs";

export type Theme = "light" | "dark";

export function resolveTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark" || t === "light") return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function styleUrl() {
  return resolveTheme() === "dark" ? STYLE_DARK : STYLE_LIGHT;
}

/**
 * The app's colors, resolved to rgb() strings MapLibre can take. Read through
 * an element rather than getPropertyValue, because a token defined with
 * color-mix() only resolves to a color once something is painted with it.
 */
export function palette(host: HTMLElement) {
  const probe = document.createElement("span");
  host.appendChild(probe);
  const c = (token: string) => {
    probe.style.color = `var(${token})`;
    return rgb(getComputedStyle(probe).color);
  };
  const p = {
    ink: c("--ffx-ink"),
    inkSec: c("--ffx-ink-sec"),
    inkMut: c("--ffx-ink-mut"),
    inkDim: c("--ffx-ink-dim"),
    surface: c("--ffx-surface"),
    ground: c("--ffx-surface-inset"),
    verified: c("--ffx-verified"),
    bad: c("--ffx-bad"),
    attn: c("--ffx-attn"),
    neutral: c("--ffx-neutral"),
    trace: c("--ffx-trace-strong"),
    traceSoft: c("--ffx-trace"),
    planned: c("--ffx-planned"),
    mapLand: c("--ffx-map-land"),
    mapSurround: c("--ffx-map-surround"),
    mapWater: c("--ffx-map-water"),
    mapShade: c("--ffx-map-shade"),
    mapLight: c("--ffx-map-light"),
  };
  probe.remove();
  return p;
}
export type Palette = ReturnType<typeof palette>;

function rgb(css: string): string {
  const m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(css);
  if (!m) return css;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255));
  return m[4] ? `rgba(${r},${g},${b},${m[4]})` : `rgb(${r},${g},${b})`;
}

/** A blank ground in the app's palette, for when the basemap can't be fetched. */
export function blankStyle(p: Palette): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "ground", type: "background", paint: { "background-color": p.ground } }],
  };
}

export const SRC_TERRAIN = "ffx-terrain";
export const LAYER_RELIEF = "ffx-relief";

/**
 * Give a gray basemap some life: land in the app's paper color, water and
 * rivers in a pale river blue, and shaded relief under the roads and labels.
 * Layers are found by what they draw rather than by id, so another
 * OpenMapTiles style works too; on the blank fallback this only adds relief.
 */
export function dressBasemap(map: MapLibreMap, p: Palette) {
  const layers = map.getStyle().layers;
  for (const l of layers) {
    const of = (l as { "source-layer"?: string })["source-layer"];
    if (l.type === "background") map.setPaintProperty(l.id, "background-color", p.mapLand);
    else if (l.type === "fill" && of === "water") map.setPaintProperty(l.id, "fill-color", p.mapWater);
    else if (l.type === "line" && of === "waterway") map.setPaintProperty(l.id, "line-color", p.mapWater);
  }
  if (!TERRAIN_URL || map.getSource(SRC_TERRAIN)) return;
  map.addSource(SRC_TERRAIN, {
    type: "raster-dem",
    tiles: [TERRAIN_URL],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 12,
    attribution: TERRAIN_CREDIT,
  });
  // Over the land and its cover, under the first line or label.
  const above = layers.find((l) => l.type !== "background" && l.type !== "fill" && l.type !== "raster");
  map.addLayer(
    {
      id: LAYER_RELIEF,
      type: "hillshade",
      source: SRC_TERRAIN,
      paint: {
        "hillshade-exaggeration": 0.5,
        "hillshade-shadow-color": p.mapShade,
        "hillshade-highlight-color": p.mapLight,
        "hillshade-accent-color": p.mapShade,
      },
    },
    above?.id,
  );
}

/**
 * A label font the style can serve glyphs for: its own regular face if it has
 * one, else whatever its first label layer uses.
 */
export function labelFont(style: StyleSpecification | undefined): string[] | null {
  if (!style?.glyphs) return null;
  const fonts = style.layers
    .filter((l) => l.type === "symbol")
    .map((l) => (l as { layout?: { "text-font"?: unknown } }).layout?.["text-font"])
    .filter((f): f is string[] => Array.isArray(f) && f.every((x) => typeof x === "string"));
  return fonts.find((f) => /regular/i.test(f[0])) ?? fonts[0] ?? ["Noto Sans Regular"];
}

/**
 * Fetch the basemap for the current palette and apply it, then call `draw`
 * once the style is in so the app's layers go back on top. Falls back to a
 * blank ground and reports it.
 */
export function applyBasemap(
  map: MapLibreMap,
  host: HTMLElement,
  draw: () => void,
  onStatus: (down: boolean) => void,
  isDisposed: () => boolean,
) {
  fetch(styleUrl())
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((style: StyleSpecification) => {
      if (isDisposed()) return;
      onStatus(false);
      map.setStyle(style);
      map.once("styledata", draw);
    })
    .catch(() => {
      if (isDisposed()) return;
      onStatus(true);
      map.setStyle(blankStyle(palette(host)));
      map.once("styledata", draw);
    });
}

/** Watch the palette: a data-theme flip or an OS change. Returns a disposer. */
export function watchTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

const ICON = {
  zoomIn: "M8 3v10M3 8h10",
  zoomOut: "M3 8h10",
  fit: "M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3M5.5 5.5h5v5h-5z",
  enter: "M9 7l5-5M10 2h4v4M7 9l-5 5M2 10v4h4",
  exit: "M14 2L9 7M9 3v4h4M2 14l5-5M7 13V9H3",
};

function icon(d: string) {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

/**
 * The map's buttons, drawn here rather than taken from MapLibre's controls so
 * they are the app's: one hairline group, line icons in the current ink, no
 * shadow. Fullscreen takes the whole figure so the readout comes along.
 */
export class Controls implements IControl {
  private el?: HTMLDivElement;
  private onFs?: () => void;
  constructor(
    private readonly map: MapLibreMap,
    private readonly frame: HTMLElement,
    private readonly fit: () => void,
    private readonly fitLabel = "Fit to data",
  ) {}
  onAdd() {
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl ffx-map-ctl";
    const button = (label: string, d: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.innerHTML = icon(d);
      b.addEventListener("click", onClick);
      el.appendChild(b);
      return b;
    };
    button("Zoom in", ICON.zoomIn, () => this.map.zoomIn());
    button("Zoom out", ICON.zoomOut, () => this.map.zoomOut());
    button(this.fitLabel, ICON.fit, this.fit);
    if (document.fullscreenEnabled) {
      const fs = button("Full screen", ICON.enter, () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void this.frame.requestFullscreen();
      });
      this.onFs = () => {
        const on = document.fullscreenElement === this.frame;
        fs.innerHTML = icon(on ? ICON.exit : ICON.enter);
        fs.title = on ? "Exit full screen" : "Full screen";
        fs.setAttribute("aria-label", fs.title);
      };
      document.addEventListener("fullscreenchange", this.onFs);
    }
    this.el = el;
    return el;
  }
  onRemove() {
    if (this.onFs) document.removeEventListener("fullscreenchange", this.onFs);
    this.el?.remove();
  }
}

export type Credit = { text: string; href?: string };

/**
 * The basemap's credit, as text and links rather than the HTML it ships as.
 * A vector source's attribution usually arrives with its TileJSON, after the
 * style, so this is read from the loaded sources and re-read as they load.
 */
export function creditsOf(map: MapLibreMap): Credit[] {
  const style = map.getStyle();
  const out: Credit[] = [];
  const seen = new Set<string>();
  for (const id of Object.keys(style?.sources ?? {})) {
    const src = map.getSource(id) as { attribution?: string } | undefined;
    const html = src?.attribution;
    if (!html) continue;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const anchors = Array.from(doc.querySelectorAll("a"));
    if (anchors.length) {
      for (const a of anchors) {
        const text = a.textContent?.trim() ?? "";
        if (text && !seen.has(text)) {
          seen.add(text);
          out.push({ text, href: a.href });
        }
      }
    } else {
      const text = doc.body.textContent?.trim() ?? "";
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push({ text });
      }
    }
  }
  return out;
}

export function CreditLine({ credits }: { credits: Credit[] }) {
  if (!credits.length) return null;
  return (
    <span className="ffx-map-credit">
      {credits.map((c) =>
        c.href ? (
          <a key={c.text} href={c.href} target="_blank" rel="noreferrer">
            {c.text}
          </a>
        ) : (
          <span key={c.text}>{c.text}</span>
        ),
      )}
    </span>
  );
}
