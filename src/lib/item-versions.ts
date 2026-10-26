import type { CatalogItem, Collection, QcStatus } from "./stac";

/**
 * The versions of one item, so its page can open the others.
 *
 * Most of the time an item's versions are the same id in each version of
 * its collection (06693800 in gages-v1 and gages-v2), which versions.ts has
 * already worked out. An item can also carry the Version extension's own
 * predecessor-, successor- and latest-version links, which may point at a
 * different id or at an item in the same collection. Those are added where
 * the links put them. A link that doesn't lead to a loaded item, or leads
 * back to this one (some pipelines write latest-version as a self link), is
 * left out.
 */

export type ItemVersion = {
  collection: string;
  item: string;
  /** The version label, e.g. "v2" or "1.0"; null when nothing names one. */
  label: string | null;
  /** What the link said it was, for a version with no label of its own. */
  rel: "predecessor-version" | "successor-version" | "latest-version" | null;
  latest: boolean;
  deprecated: boolean;
  qc: QcStatus;
};

/** Oldest first, this item included. A list of one means there's nothing else to open. */
export function itemVersions(c: Collection, item: CatalogItem, collections: Collection[]): ItemVersion[] {
  const byId = new Map(collections.map((x) => [x.id, x]));
  const has = (col: Collection | undefined, id: string) => !!col?.items.some((i) => i.id === id);
  const deprecated = (col: Collection, id: string) =>
    col.items.find((i) => i.id === id)?.properties.deprecated === true;

  const out: ItemVersion[] = [];
  for (const v of c.series.versions) {
    const col = byId.get(v.id);
    if (!col || !has(col, item.id)) continue;
    out.push({
      collection: v.id,
      item: item.id,
      label: v.label,
      rel: null,
      latest: v.id === c.series.latest,
      deprecated: v.deprecated || deprecated(col, item.id),
      qc: v.qc,
    });
  }

  const at = () => out.findIndex((v) => v.collection === c.id && v.item === item.id);
  for (const rel of ["predecessor-version", "successor-version", "latest-version"] as const) {
    for (const l of item.links.filter((x) => x.rel === rel)) {
      const t = target(l.href, c, collections, byId);
      // Already listed, this item included, so a self link adds nothing.
      if (!t || out.some((v) => v.collection === t.collection && v.item === t.item)) continue;
      const col = byId.get(t.collection)!;
      // The item's own version, or its collection's when that's a different one.
      const own = col.items.find((i) => i.id === t.item)?.properties.version;
      const colLabel = t.collection !== c.id ? col.series.versions.find((x) => x.id === col.id)?.label ?? null : null;
      const v: ItemVersion = {
        ...t,
        label: typeof own === "string" && own ? own : colLabel,
        rel,
        latest: rel === "latest-version",
        deprecated: col.deprecated || deprecated(col, t.item),
        qc: col.qc?.qc ?? "pending",
      };
      if (rel === "predecessor-version") out.splice(at(), 0, v);
      else if (rel === "successor-version") out.splice(at() + 1, 0, v);
      else {
        for (const o of out) o.latest = false;
        out.push(v);
      }
    }
  }
  return out;
}

/**
 * The loaded item a link's href names. Hrefs from parquet are often left
 * relative to a file this app never sees, so it goes by the names in the
 * path: the item id is the last part, and the collection is a part that
 * names one holding that item, or failing that this collection, its other
 * versions, or the only collection anywhere that has the id.
 */
function target(href: string, from: Collection, collections: Collection[], byId: Map<string, Collection>) {
  const parts = href.split(/[?#]/)[0].split("/").filter(Boolean).map(decode);
  const id = (parts.pop() ?? "").replace(/\.json$/i, "");
  if (!id) return null;
  const holds = (col: Collection | undefined): col is Collection => !!col?.items.some((i) => i.id === id);

  const named = [...parts].reverse().map((p) => byId.get(p)).find(holds);
  const near = [from.id, ...[...from.series.versions].reverse().map((v) => v.id)].map((x) => byId.get(x)).find(holds);
  const anywhere = collections.filter(holds);
  const col = named ?? near ?? (anywhere.length === 1 ? anywhere[0] : null);
  return col ? { collection: col.id, item: id } : null;
}

function decode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    // A stray % in the href. Matched as written, if at all.
    return s;
  }
}
