/**
 * The catalog tree, shared by server and client: which loaded nodes are
 * catalogs (folders) and which are datasets, how they nest, and search.
 *
 * A catalog has a title, a description and children, and nothing else: no
 * extent, no items, no review state. A dataset has items or assets of its
 * own and is the only thing that's counted, reviewed, drawn or promoted. A
 * dataset can still have children (Project Scoping holds ten empty
 * catalogs); they travel with it.
 */
import type { Collection } from "./stac";

export type NodeKind = "catalog" | "dataset";

/**
 * A catalog when the STAC type says so. Until the generator types its
 * containers, a Collection with no items and no collection-level assets
 * describes no data, so it's a container too, with children or without:
 * an empty leaf (an Archive folder, Grids' AEP Grids) is a shelf waiting
 * for a dataset, not a dataset with nothing in it.
 */
export function kindOf(c: Pick<Collection, "type" | "itemCount" | "assets">): NodeKind {
  if (c.type === "Catalog") return "catalog";
  if (c.itemCount === 0 && Object.keys(c.assets).length === 0) return "catalog";
  return "dataset";
}

export type HierarchyNode = { slug: string; name: string; parentSlugs: string[]; kind: NodeKind };

/** A stable root-to-parent breadcrumb path from loaded child links, with cycle protection. */
export function collectionAncestors(collection: Collection, collections: Collection[]): Collection[] {
  const parents = new Map<string, Collection[]>();
  // Shared children have one deterministic trail; prefer current parent versions.
  const ordered = [...collections].sort((a, b) =>
    Number(b.id === b.series.latest) - Number(a.id === a.series.latest) ||
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  for (const parent of ordered) {
    for (const href of parent.childCollectionHrefs ?? []) {
      const list = parents.get(href) ?? [];
      list.push(parent);
      parents.set(href, list);
    }
  }
  const ancestors: Collection[] = [];
  const seen = new Set([collection.id]);
  let current = collection;
  while (current.docHref) {
    const parent = parents.get(current.docHref)?.find((candidate) => !seen.has(candidate.id));
    if (!parent) break;
    ancestors.push(parent);
    seen.add(parent.id);
    current = parent;
  }
  return ancestors.reverse();
}

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

/** The latest version of every series as tree nodes, for the server's pages. */
export function treeNodesOf(collections: Collection[]): (HierarchyNode & { collection: Collection })[] {
  const latest = collections.filter((c) => c.series.latest === c.id);
  const parents = collectionParents(collections, new Set(latest.map((c) => c.id)));
  return latest.map((c) => ({ slug: c.series.id, name: c.title, parentSlugs: parents.get(c.series.id) ?? [], kind: c.kind, collection: c }));
}

/** An index over only loaded, visible versions. Missing parents leave an orphan at the top level. */
export function hierarchyOf<T extends HierarchyNode>(nodes: T[]) {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const parents = new Map(nodes.map((n) => [n.slug, [...new Set(n.parentSlugs)].filter((s) => s !== n.slug && bySlug.has(s)).sort()]));
  const children = new Map(nodes.map((n) => [n.slug, [] as string[]]));
  for (const [child, ids] of parents) for (const parent of ids) children.get(parent)!.push(child);
  const byName = (a: string, b: string) => bySlug.get(a)!.name.localeCompare(bySlug.get(b)!.name) || a.localeCompare(b);
  for (const list of children.values()) list.sort(byName);

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

  // Each node's datasets anywhere below it, counted once.
  const below = new Map<string, number>();
  function datasetsBelow(slug: string): number {
    let n = below.get(slug);
    if (n === undefined) {
      n = 0;
      for (const d of descendants([slug])) if (d !== slug && bySlug.get(d)!.kind === "dataset") n++;
      below.set(slug, n);
    }
    return n;
  }

  /** Direct children, by name. */
  const childrenOf = (slug: string): T[] => (children.get(slug) ?? []).map((s) => bySlug.get(s)!);

  /**
   * The catalogs directly inside a node. The rail and the catalog page list
   * direct children; deeper ones are reached by opening those.
   */
  const catalogsBelow = (slug: string): number => childrenOf(slug).filter((c) => c.kind === "catalog").length;

  /** A catalog with no dataset anywhere below it. */
  const isEmpty = (slug: string): boolean => bySlug.get(slug)?.kind === "catalog" && datasetsBelow(slug) === 0;

  /**
   * One ancestor trail, root first, for headings, breadcrumbs and search
   * rows. The tree is strict, so there's one; with a shared child, the first
   * parent by slug wins.
   */
  function ancestorsOf(slug: string): T[] {
    const out: T[] = [];
    const seen = new Set([slug]);
    let at = parents.get(slug)?.find((p) => !seen.has(p));
    while (at) {
      out.unshift(bySlug.get(at)!);
      seen.add(at);
      at = parents.get(at)!.find((p) => !seen.has(p));
    }
    return out;
  }

  /** Ancestor titles, root first. */
  const pathOf = (slug: string): string[] => ancestorsOf(slug).map((n) => n.name);

  /** The top-level catalog a node sits under, or null for a root. */
  const rootCatalogOf = (slug: string): T | null => {
    const top = ancestorsOf(slug)[0];
    return top?.kind === "catalog" ? top : null;
  };

  return { roots, descendants, childrenOf, datasetsBelow, catalogsBelow, isEmpty, ancestorsOf, pathOf, rootCatalogOf };
}

export type Hierarchy<T extends HierarchyNode> = ReturnType<typeof hierarchyOf<T>>;

/**
 * Datasets and catalogs whose title or description has the text in it. A
 * match doesn't bring its descendants along: a parent named Storm doesn't
 * make everything under it a storm.
 */
export function searchCollections<T extends HierarchyNode & { blurb?: string }>(nodes: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes.filter((n) => [n.name, n.blurb].some((text) => text?.toLowerCase().includes(q)));
}
