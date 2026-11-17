/**
 * How an item asks to be drawn. The catalog knows what a line is (a stream,
 * a road, a levee) and the app doesn't, so the color and weight come from
 * the data: an item can carry a `symbology` property,
 *
 *   "symbology": { "color": "#cb4154", "size": 0.5 }
 *
 * - `color`: a hex color, `#rgb` or `#rrggbb`.
 * - `size`: the line's weight as a multiple of the app's own, so 1 is what
 *   a line gets without it, 0.5 is half and 2 is double. The app's widths
 *   change with zoom, which is why this isn't a number of pixels. Kept
 *   between SIZE_MIN and SIZE_MAX.
 *
 * Both are optional, and a value that isn't one of these is ignored, so the
 * line draws as it would have: river blue at the default weight. It's read
 * from the item, since one collection can hold more than one kind of line.
 * In a parquet file it's a struct column (or a column of JSON text) of that
 * name.
 *
 * The catalog gives one color and the maps have two grounds, so a color
 * that would be lost on one of them (black on the dark map, a pale yellow
 * on the light one) is swapped there for the same hue at the opposite
 * lightness, so it's at least 3:1 against that ground, the contrast WCAG
 * asks of a graphic. `color` is the shade
 * for the light map; `colorDark` is there only when the dark map needs a
 * different one.
 */
export const SYMBOLOGY_PROPERTY = "symbology";

export const SIZE_MIN = 0.25;
export const SIZE_MAX = 4;

/** What a map feature carries for its item's symbology. */
export type Symbology = { color?: string; colorDark?: string; size?: number };

/**
 * The land the maps draw on: --ffx-map-land in styles/tokens.css, light and
 * dark. Written out here because this runs on the server, where there's no
 * stylesheet to read them from.
 */
const LAND = { light: "#fdfcf9", dark: "#111417" };
const CONTRAST_MIN = 3;

/** The symbology an item's properties give, or undefined when there's none that can be used. */
export function symbologyOf(properties: Record<string, unknown> | null | undefined): Symbology | undefined {
  let raw = properties?.[SYMBOLOGY_PROPERTY];
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const { color, size } = raw as { color?: unknown; size?: unknown };

  const out: Symbology = {};
  const hex = hexOf(color);
  if (hex) {
    out.color = legible(hex, LAND.light);
    const dark = legible(hex, LAND.dark);
    if (dark !== out.color) out.colorDark = dark;
  }
  const n = typeof size === "number" ? size : typeof size === "string" && size.trim() ? Number(size) : NaN;
  if (Number.isFinite(n) && n > 0) out.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));
  return out.color || out.size ? out : undefined;
}

/** One string for each distinct symbology, to group the lines drawn alike. */
export function symbologyKey(s: Symbology | undefined): string {
  return s ? `${s.color ?? ""}|${s.colorDark ?? ""}|${s.size ?? ""}` : "";
}

/** A hex color as `#rrggbb` in lower case, or undefined if it isn't one. */
function hexOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return undefined;
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? h.replace(/./g, "$&$&") : h}`;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The color itself if it shows on this ground. If it doesn't, the same hue
 * at the opposite lightness, so black on the dark map is white and a navy
 * is a light blue, then moved toward white or black if that still isn't
 * enough.
 */
function legible(hex: string, ground: string): string {
  const land = luminance(channels(ground));
  const shows = (rgb: [number, number, number]) => contrast(luminance(rgb), land) >= CONTRAST_MIN;
  const own = channels(hex);
  if (shows(own)) return hex;
  // Flipping HSL lightness leaves the chroma alone, so it's one shift for all three channels.
  const shift = 255 - Math.max(...own) - Math.min(...own);
  const from = own.map((c) => c + shift) as [number, number, number];
  const toward = land < 0.5 ? 255 : 0;
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const mixed = from.map((c) => Math.round(c + (toward - c) * t)) as [number, number, number];
    if (shows(mixed)) return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  return toward ? "#ffffff" : "#000000";
}
