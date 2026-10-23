/** Loaded collection relationships and root/descendant search, shared by server and client. */
import type { Collection } from "./stac";

export type HierarchyNode = { slug: string; name: string; parentSlugs: string[] };

/** Resolve links to older versions onto the latest visible version of that series. */
export function collectionParents(collections: Collection[], visibleIds: Set<string>): Map<string, string[]> {
  const byHref = new Map(collections.flatMap((c) => c.docHref ? [[c.docHref, c] as const] : []));
  const visible = collections.filter((c) => visibleIds.has(c.id));
  const visibleSlugs = new Set(visible.map((c) => c.series.id));
  const parents = new Map(visible.map((c) => [c.series.id, new Set<string>()]));
  for (const parent of visible) {
    for (const href of parent.childCollectionHrefs ?? []) {
      const child = byHref.get(href);
      if (child && visibleSlugs.has(child.series.id) && child.series.id !== parent.series.id) {
        parents.get(child.series.id)!.add(parent.series.id);
      }
    }
  }
  return new Map([...parents].map(([slug, ids]) => [slug, [...ids].sort()]));
}

/** An index over only loaded, visible versions. Missing parents leave an orphan at the top level. */
export function hierarchyOf<T extends HierarchyNode>(nodes: T[]) {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const parents = new Map(nodes.map((n) => [n.slug, [...new Set(n.parentSlugs)].filter((s) => s !== n.slug && bySlug.has(s))]));
  const children = new Map(nodes.map((n) => [n.slug, [] as string[]]));
  for (const [child, ids] of parents) for (const parent of ids) children.get(parent)!.push(child);

  function descendants(seeds: Iterable<string>): Set<string> {
    const found = new Set<string>();
    const todo = [...seeds];
    while (todo.length) {
      const slug = todo.pop()!;
      if (found.has(slug) || !bySlug.has(slug)) continue;
      found.add(slug);
      todo.push(...children.get(slug)!);
    }
    return found;
  }

  const roots = new Set(nodes.filter((n) => !parents.get(n.slug)!.length).map((n) => n.slug));
  const reachable = descendants(roots);
  // Malformed, rootless cycles mustn't make loaded data disappear. Keep
  // their otherwise unreachable branch visible until its links are fixed.
  for (const n of nodes) if (!reachable.has(n.slug)) roots.add(n.slug);

  function parentPaths(slug: string): string[] {
    const paths = new Set<string>();
    const walk = (at: string, path: string[], seen: Set<string>) => {
      const next = parents.get(at)!.filter((p) => !seen.has(p));
      if (!next.length) {
        if (path.length) paths.add(path.join(" / "));
        return;
      }
      for (const p of next) walk(p, [bySlug.get(p)!.name, ...path], new Set([...seen, p]));
    };
    walk(slug, [], new Set([slug]));
    return [...paths].sort();
  }
  return { roots, descendants, parentPaths };
}

/** A matching parent includes its descendants even when their own text doesn't match. */
export function searchCollections<T extends HierarchyNode & { blurb?: string }>(nodes: T[], query: string, hierarchy = hierarchyOf(nodes)): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes.filter((n) => hierarchy.roots.has(n.slug));
  const matches = nodes.filter((n) => [n.name, n.blurb].some((text) => text?.toLowerCase().includes(q)));
  const included = hierarchy.descendants(matches.map((n) => n.slug));
  return nodes.filter((n) => included.has(n.slug));
}