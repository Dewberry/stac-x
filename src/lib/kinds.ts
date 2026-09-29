/**
 * What kind of thing a collection is: gages, a model, a storm catalog. The
 * landing page uses it for the label under each name and for the words on
 * the preview card. How a collection is drawn on the map doesn't depend on
 * it; that comes from the shapes of its items (see lib/overview.ts), so a
 * kind nobody planned for still draws correctly.
 */

export type AreaKind = "gages" | "hms" | "ras" | "ressim" | "storms" | "other";

export const AREA_KIND_LABEL: Record<AreaKind, string> = {
  gages: "USGS gages",
  hms: "HEC-HMS model",
  ras: "HEC-RAS model",
  ressim: "HEC-ResSim model",
  storms: "Storm catalog",
  other: "Collection",
};

/** What the collection's temporal extent means, for the preview card. */
export const AREA_KIND_TIME: Record<AreaKind, string> = {
  gages: "period of record",
  hms: "time span",
  ras: "time span",
  ressim: "time span",
  storms: "storm dates",
  other: "time span",
};

/**
 * A best guess at the kind of a collection the fixtures don't name, from its
 * id, title and keywords. Wrong guesses only change a label.
 */
export function guessKind(c: { id: string; title: string; keywords: string[] }): AreaKind {
  const text = `${c.id} ${c.title} ${c.keywords.join(" ")}`.toLowerCase();
  if (/\bressim\b/.test(text)) return "ressim";
  if (/\b(hec-?)?hms\b/.test(text)) return "hms";
  if (/\b(hec-?)?ras\b/.test(text)) return "ras";
  if (/storm/.test(text)) return "storms";
  if (/gage|gauge/.test(text)) return "gages";
  return "other";
}
