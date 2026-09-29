import type { Collection, Series, StacLink } from "./stac";

/**
 * Which collections are versions of each other.
 *
 * Every version is its own collection, with its own id, page, QC record and
 * promotion. This only works out which ones belong together, so a page can
 * offer the others and the home map can draw each series once.
 *
 * There are two ways a catalog says it. The STAC Version extension links the
 * versions' collection documents with latest-, predecessor- and
 * successor-version links; those win when the metadata has them. Most public
 * catalogs skip the extension and put the version in the id instead
 * (HLSL30_2.0, usgs-lcmap-conus-v13), so collections whose ids differ only by
 * a version suffix are grouped too. A bare trailing number (reach-12) isn't a
 * version; it needs a "v" or a dot.
 */

type Input = Pick<Collection, "id" | "version" | "deprecated" | "experimental" | "docHref" | "versionLinks" | "qc">;

const SUFFIX = /^(.+?)[-_.](?:v(\d+(?:\.\d+)*)|(\d+\.\d+(?:\.\d+)*))$/i;

/** "gages-v2" is version "v2" of "gages"; "gages" has no suffix. */
export function splitVersion(id: string): { base: string; label: string } | null {
  const m = SUFFIX.exec(id);
  if (!m) return null;
  return { base: m[1], label: m[2] ? `v${m[2]}` : m[3] };
}

/** A version label as the UI says it: "v2" and "2.0" read "Version 2", "Version 2.0". */
export function versionName(label: string | null): string {
  if (!label) return "Unversioned";
  const m = /^v?(\d.*)$/i.exec(label);
  return m ? `Version ${m[1]}` : label;
}

export function groupVersions<C extends Input>(collections: C[]): Map<string, Series> {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const parent = new Map(collections.map((c) => [c.id, c.id]));
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  // 1. The extension's links, resolved to the collections they point at.
  const byHref = new Map<string, string>();
  for (const c of collections) if (c.docHref) byHref.set(c.docHref, c.id);
  const target = (c: C, l: StacLink) => {
    const href = resolve(l.href, c.docHref);
    const hit = byHref.get(href) ?? idFromHref(href, byId);
    return hit && hit !== c.id ? hit : null;
  };
  // older -> newer, for ordering a linked series
  const edges: [string, string][] = [];
  const latestLink = new Map<string, string>();
  for (const c of collections) {
    for (const l of c.versionLinks) {
      const t = target(c, l);
      if (!t) continue;
      union(c.id, t);
      if (l.rel === "predecessor-version") edges.push([t, c.id]);
      else if (l.rel === "successor-version") edges.push([c.id, t]);
      else if (l.rel === "latest-version") {
        edges.push([c.id, t]);
        latestLink.set(c.id, t);
      }
    }
  }

  // 2. The id suffix, for collections no link joined to anything.
  const size = new Map<string, number>();
  for (const c of collections) size.set(find(c.id), (size.get(find(c.id)) ?? 0) + 1);
  const byBase = new Map<string, C[]>();
  for (const c of collections) {
    const s = splitVersion(c.id);
    if (!s || size.get(find(c.id))! > 1) continue;
    byBase.set(s.base, [...(byBase.get(s.base) ?? []), c]);
  }
  for (const group of byBase.values()) for (const c of group.slice(1)) union(group[0].id, c.id);

  // 3. Each group, ordered oldest first.
  const groups = new Map<string, C[]>();
  for (const c of collections) groups.set(find(c.id), [...(groups.get(find(c.id)) ?? []), c]);

  const out = new Map<string, Series>();
  for (const members of groups.values()) {
    const ordered = order(members, edges);
    const newest = [...ordered].reverse();
    const linked = newest.map((c) => latestLink.get(c.id)).find((id) => id && members.some((m) => m.id === id));
    const latest = linked ?? (newest.find((c) => !c.experimental) ?? newest[0]).id;
    // A lone gages-v1 is still "gages", so another environment holding
    // gages-v2 can find it.
    const bases = new Set(members.map((c) => splitVersion(c.id)?.base ?? c.id));
    const id = bases.size === 1 ? Array.from(bases)[0] : latest;
    const series: Series = {
      id,
      latest,
      versions: ordered.map((c) => ({
        id: c.id,
        label: c.version ?? splitVersion(c.id)?.label ?? null,
        deprecated: c.deprecated,
        qc: c.qc?.qc ?? "pending",
      })),
    };
    for (const c of members) out.set(c.id, series);
  }
  return out;
}

/** Links first, then version numbers for anything the links leave open. */
function order<C extends Input>(members: C[], edges: [string, string][]): C[] {
  if (members.length === 1) return members;
  const ids = new Set(members.map((c) => c.id));
  const mine = edges.filter(([a, b]) => ids.has(a) && ids.has(b));
  const indegree = new Map(members.map((c) => [c.id, 0]));
  for (const [, b] of mine) indegree.set(b, indegree.get(b)! + 1);
  const out: C[] = [];
  const ready = members.filter((c) => indegree.get(c.id) === 0);
  while (ready.length) {
    ready.sort(byVersion);
    const c = ready.shift()!;
    out.push(c);
    for (const [a, b] of mine) {
      if (a !== c.id) continue;
      indegree.set(b, indegree.get(b)! - 1);
      if (indegree.get(b) === 0) ready.push(members.find((m) => m.id === b)!);
    }
  }
  // A loop in the links: fall back to the numbers alone.
  return out.length === members.length ? out : [...members].sort(byVersion);
}

function byVersion(a: Input, b: Input) {
  const key = (c: Input) => c.version ?? splitVersion(c.id)?.label.replace(/^v/i, "") ?? "";
  return key(a).localeCompare(key(b), "en", { numeric: true }) || a.id.localeCompare(b.id);
}

/** A link's href against the document it's in: S3, http or a local path. */
function resolve(href: string, base: string | null): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || !base) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(base)) {
    try {
      return new URL(href, base).toString();
    } catch {
      return href;
    }
  }
  const parts = base.split("/").slice(0, -1);
  for (const p of href.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

/**
 * When the href isn't one of our documents, the id is usually in it anyway:
 * .../gages-v2/collection.json, .../collections/gages-v2, gages-v2.json.
 */
function idFromHref(href: string, byId: Map<string, unknown>): string | null {
  const parts = href.split(/[?#]/)[0].split("/").filter(Boolean);
  let last = parts.pop() ?? "";
  if (last === "collection.json") last = parts.pop() ?? "";
  last = decodeURIComponent(last.replace(/\.json$/i, ""));
  return byId.has(last) ? last : null;
}
