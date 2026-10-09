import { AREA_KIND_LABEL, guessKind, type AreaKind } from "./kinds";

/** The collection's kind, for the label above a collection page's title ("USGS gages", "Storm catalog"). */
export function collectionKindLabel(c: CollectionLike): string | null {
  const kind = guessKind(c);
  return kind === "other" ? null : AREA_KIND_LABEL[kind];
}

/**
 * What one item of a collection is, in the singular: a USGS gage, a storm
 * event, a terrain tile. The item page puts it above the title, and an item
 * with no title of its own is called this instead of its id, so a heading is
 * never a bare number or a 40-character file name.
 */
export const ITEM_KIND_LABEL: Record<AreaKind, string> = {
  gages: "USGS gage",
  hms: "HEC-HMS model",
  ras: "HEC-RAS model",
  ressim: "HEC-ResSim model",
  models: "Calibration model",
  storms: "Storm event",
  dams: "Dam",
  structures: "Structure inventory",
  terrain: "Terrain tile",
  other: "Item",
};

type CollectionLike = { id: string; title: string; keywords: string[]; description?: string | null };

/**
 * The item's kind label. A calibration collection carries HMS and RAS models
 * side by side, so for those the item's own properties decide which one it
 * is: whichever extension has values filled in (the other's fields are
 * there but null), then the id.
 */
export function itemKindLabel(c: CollectionLike, item: { id: string; properties: Record<string, unknown> }): string {
  const kind = guessKind(c);
  if (kind !== "models") return ITEM_KIND_LABEL[kind];
  const filled = (re: RegExp) =>
    Object.entries(item.properties).filter(([k, v]) => re.test(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length)).length;
  const hms = filled(/^hms[:_]/i);
  const ras = filled(/^(hec-)?ras[:_]/i);
  if (hms > ras || (!ras && /\bhms\b/i.test(item.id.replace(/[-_]/g, " ")))) return "HEC-HMS calibration model";
  if (ras > hms || /\bras\b/i.test(item.id.replace(/[-_]/g, " "))) return "HEC-RAS calibration model";
  return ITEM_KIND_LABEL.models;
}

/**
 * A model item's name when it has no title: the project title the HEC
 * extensions carry (`hms:project_title`, `HEC-RAS:project_title`), which is
 * what a modeler calls it. Raw, as the model wrote it ("Big_Thompson").
 */
export function projectTitle(properties: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(properties)) {
    if (/(^|:)project_title$/i.test(k) && typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * What to call an item that has no title. A short id that reads as a number
 * in a series goes after the kind ("Storm event 1"); a long one is left to
 * the id chip beside the kind ("Terrain tile").
 */
export function untitledName(kindLabel: string, id: string): { title: string; idInTitle: boolean } {
  return id.length <= 8 && !/[_/]/.test(id) ? { title: `${kindLabel} ${id}`, idInTitle: true } : { title: kindLabel, idInTitle: false };
}
