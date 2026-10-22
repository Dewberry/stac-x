import { collectionName, itemLabel, tidyCaps } from "./format";
import { guessKind, type AreaKind } from "./kinds";

/**
 * What one item of a collection is, in the singular: a USGS gage, a storm
 * event, a terrain tile. The item page puts it above the title, and an item
 * with no title of its own is called this instead of its id, so a heading is
 * never a bare number or a 40-character file name.
 */
export const ITEM_KIND_LABEL: Record<AreaKind, string> = {
  gages: "Gage",
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
 * The item's kind label. A gage is a USGS gage only when the collection says
 * so. A calibration collection carries HMS and RAS models side by side, so
 * for those the item's own properties decide which one it is: whichever
 * extension has values filled in (the other's fields are there but null),
 * then the id.
 */
export function itemKindLabel(c: CollectionLike, item: ItemLike): string {
  const kind = guessKind(c);
  if (kind === "gages" && /\busgs\b/i.test(`${c.id} ${c.title} ${c.keywords.join(" ")} ${c.description ?? ""}`)) return "USGS gage";
  if (kind !== "models") return ITEM_KIND_LABEL[kind];
  const model = modelOf(item);
  return model ? `${model} calibration model` : ITEM_KIND_LABEL.models;
}

type ItemLike = { id: string; properties: Record<string, unknown> };

/** "HEC-HMS" or "HEC-RAS" for a model item, by whichever extension has values filled in, then the id. */
function modelOf(item: ItemLike): "HEC-HMS" | "HEC-RAS" | null {
  const filled = (re: RegExp) =>
    Object.entries(item.properties).filter(([k, v]) => re.test(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length)).length;
  const hms = filled(/^hms[:_]/i);
  const ras = filled(/^(hec-)?ras[:_]/i);
  const words = item.id.replace(/[-_]/g, " ");
  if (hms > ras || (!ras && /\bhms\b/i.test(words))) return "HEC-HMS";
  if (ras > hms || /\bras\b/i.test(words)) return "HEC-RAS";
  return null;
}

/**
 * The short kind that tells apart items of a calibration collection, which
 * carries an HMS and a RAS model of the same basin under the same project
 * title: "HEC-HMS" or "HEC-RAS". Null for every other collection, whose
 * items are all one kind.
 */
export function itemKindShort(c: CollectionLike, item: ItemLike): string | null {
  return guessKind(c) === "models" ? modelOf(item) : null;
}

/**
 * How an item is named in a list or on a map, the same on every page: its
 * title, else its project title, else what it is ("Storm event 1", "Terrain
 * tile"), never its bare id. `hideId` says the label already carries the id.
 */
export function itemRowLabel(c: CollectionLike, item: ItemLike): { label: string; hideId: boolean; kind: string | null } {
  const project = projectTitle(item.properties);
  const label = itemLabel(item.properties) ?? (project ? collectionName(project, project) : null);
  const kind = itemKindShort(c, item);
  if (label) return { label: tidyCaps(label), hideId: false, kind };
  const unnamed = untitledName(itemKindLabel(c, item), item.id);
  return { label: unnamed.title, hideId: unnamed.idInTitle, kind };
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
