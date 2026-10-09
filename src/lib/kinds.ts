/**
 * What kind of thing a collection is: gages, a model, a storm catalog. The
 * landing page uses it for the label under each name and for the words on
 * the preview card. How a collection is drawn on the map doesn't depend on
 * it; that comes from the shapes of its items (see lib/overview.ts), so a
 * kind nobody planned for still draws correctly.
 */

export type AreaKind =
  | "gages"
  | "hms"
  | "ras"
  | "ressim"
  | "models"
  | "storms"
  | "dams"
  | "structures"
  | "terrain"
  | "other";

export const AREA_KIND_LABEL: Record<AreaKind, string> = {
  gages: "USGS gages",
  hms: "HEC-HMS model",
  ras: "HEC-RAS model",
  ressim: "HEC-ResSim model",
  models: "Calibration models",
  storms: "Storm catalog",
  dams: "Dam inventory",
  structures: "Structure inventory",
  terrain: "Terrain",
  other: "Collection",
};

/** Group headings in the landing page rail, in the program's order. */
export const AREA_KIND_GROUP: [AreaKind, string][] = [
  ["gages", "USGS gages"],
  ["hms", "HEC-HMS models"],
  ["ras", "HEC-RAS models"],
  ["ressim", "HEC-ResSim models"],
  ["models", "Calibration models"],
  ["storms", "Storm catalogs"],
  ["dams", "Dam inventories"],
  ["structures", "Structure inventories"],
  ["terrain", "Terrain"],
  ["other", "Other"],
];

/** What the collection's temporal extent means, for the preview card. */
export const AREA_KIND_TIME: Record<AreaKind, string> = {
  gages: "period of record",
  hms: "time span",
  ras: "time span",
  ressim: "time span",
  models: "time span",
  storms: "storm dates",
  dams: "inventory dates",
  structures: "inventory dates",
  terrain: "time span",
  other: "time span",
};

/**
 * A best guess at the kind of a collection the fixtures don't name, from its
 * id, title, keywords and description. The description counts because the
 * catalogs don't name things consistently: Development's storm catalog is
 * `72hr-events` with no title, and only its description says "storm".
 * Wrong guesses only change a label.
 *
 * Models are checked first, since a model's description can mention dams or
 * structures. A collection that holds more than one model type (calibration
 * carries HEC-RAS and HEC-HMS together) is "models", not whichever matched
 * first.
 */
export function guessKind(c: { id: string; title: string; keywords: string[]; description?: string | null }): AreaKind {
  const text = `${c.id} ${c.title} ${c.keywords.join(" ")} ${c.description ?? ""}`.toLowerCase();
  const ressim = /\bressim\b/.test(text);
  const hms = /\b(hec-?)?hms\b/.test(text);
  const ras = /\b(hec-?)?ras\b/.test(text);
  if (/\bcalibration\b/.test(text) || [ressim, hms, ras].filter(Boolean).length > 1) return "models";
  if (ressim) return "ressim";
  if (hms) return "hms";
  if (ras) return "ras";
  if (/storm/.test(text)) return "storms";
  if (/gage|gauge/.test(text)) return "gages";
  if (/\bdams?\b/.test(text)) return "dams";
  if (/\bstructures?\b/.test(text)) return "structures";
  if (/terrain|\bdem\b|elevation/.test(text)) return "terrain";
  return "other";
}
