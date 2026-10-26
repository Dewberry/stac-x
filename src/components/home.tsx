"use client";

import nextDynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, MultiPolygon } from "geojson";
import { envMeta, type EnvKey } from "@/lib/env";
import type { ItemUnit } from "@/lib/footprint";
import type { Tint } from "@/lib/overview";
import { QC_STATUSES, type QcEdit, type QcStatus } from "@/lib/stac";
import { hierarchyOf, searchCollections, type NodeKind } from "@/lib/collection-hierarchy";
import { itemHref } from "@/lib/utils";
import { HomePreview } from "./home-preview";
import { HomeRail, type CatalogHit, type Group } from "./home-rail";
import { HomeSplit } from "./home-split";
import { ItemHoverContext } from "./item-hover";
import type { ItemRow } from "./items-list";
import { stateOf } from "./qc-mark";

/**
 * The home page, a console for people who already know FFRD: the
 * dataset rail on the left and the map on the right, filling the window
 * under the environment band. Nothing here says what stac-x is; the header
 * does that.
 *
 * The rail's rows are datasets, grouped under the top-level catalog each
 * sits in; catalogs are never rows (lib/collection-hierarchy.ts). Top-level
 * catalogs with no dataset anywhere below them are named once at the foot
 * of the list. A heading opens its catalog in the rail (?in=,
 * home-scope.tsx): the rail and the map narrow to that catalog's datasets,
 * one level of headings down, with its empty catalogs folded at the end.
 * The review states in the head count datasets only and are the legend for
 * the marks and the review filter in one. Search matches datasets by title
 * and description.
 * Selecting a dataset opens its row in place, with enough to decide
 * whether to open it and its items listed by name, and draws its footprint
 * on the map, which frames it. Pointing at another row previews that one's
 * footprint over the selection. Enter or Space on a row opens it like a
 * click, and Escape closes it.
 *
 * The rail and the map are one view: pointing at an item on either side
 * lights it up on the other.
 *
 * On a phone the page is a plain column: the map, then the rail with the
 * state buttons in its head, and a selection opens a sheet over the page
 * instead, with the same items in it. The map is first in the DOM because
 * that is the phone's order; on a wide screen the row is reversed so the
 * rail sits on the left.
 */

const HomeMap = nextDynamic(() => import("./home-map").then((m) => m.HomeMap), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-inset" style={{ position: "absolute", inset: 0 }} />,
});

export type HomeArea = {
  /** The series id: one area per collection across its versions. */
  slug: string;
  /** The latest version's collection id, for the item links. */
  id: string;
  name: string;
  /** A catalog (a folder) or a dataset; see lib/collection-hierarchy.ts. */
  kind: NodeKind;
  /** The middle of its extent is in the deployment's area. */
  inArea: boolean;
  bbox: [number, number, number, number] | null;
  /** Covers most of the deployment's area: "Whole area" in the rail. */
  wide?: boolean;
  /**
   * How the collection's footprint is drawn on the map; null when it isn't.
   * "area" means it contains the deployment's whole area, which lights up
   * instead. See lib/overview.ts.
   */
  drawn: "points" | "areas" | "density" | "extent" | "area" | null;
  /** For a density footprint, the count range of each of its three steps. */
  steps?: [number, number][];
  /**
   * For an areas footprint of a few shapes: the items behind them, each with
   * the `key` of the shape it's drawn as. Items with one geometry share a key.
   */
  members?: Member[];
  /** The one place the footprint is, when it has one ("Big Thompson"). */
  place?: string | null;
  href: string;
  jsonHref: string;
  itemCount: number;
  /** Loaded parent series, for grouping under catalogs. */
  parentSlugs: string[];
  /** For a catalog with datasets, where the map goes when it's opened in the rail. */
  frame: [number, number, number, number] | null;
  /** Datasets anywhere below it. Zero for a catalog means it's empty. */
  datasetsBelow: number;
  /** For a dataset, how many empty catalogs sit directly inside it (Project Scoping's ten). */
  emptyInside: number;
  /** What the items are on the map: all points, any shapes, or no geometry at all. */
  unit: ItemUnit;
  /** The file's geometry couldn't be read, so nothing of it is drawn and the row says so. */
  geometryError?: boolean;
  /** Its parent document didn't load, so it's at the top of the list for now, and the row says so. */
  parentMissing?: boolean;
  /** The footprint was too heavy to send with the page; it's fetched from the footprint route when picked. */
  lazy?: boolean;
  /** Where the extent sits against the deployment's area; null when there's no area or no extent. */
  coverage: "whole" | "part" | "beyond" | null;
  /** "1980–2025" when the extent spans more than one calendar year; null otherwise. */
  years: string | null;
  license: string | null;
  /** The providers' names. */
  providers: string[];
  keywords: string[];
  /** How many assets the collection itself carries (not its items). */
  assetCount: number;
  temporal: [string | null, string | null] | null;
  /** The collection's QC record; null when it has none or isn't published. */
  qc: QcEdit | null;
  /** The latest version's label, and how many versions came before it. */
  version?: string | null;
  earlier?: number;
  blurb?: string;
};

/** The deployment's area (lib/map-area.ts), as the map draws it. */
export type FocusArea = { name: string; geometry: MultiPolygon };

export type Member = {
  id: string;
  key: string;
  label: string;
  /** The label already says the id ("Storm event 1"). */
  hideId: boolean;
  /** "HEC-HMS" or "HEC-RAS" in a calibration collection; null elsewhere. */
  kind: string | null;
  /** Which blue its shape is drawn in, when the collection has few enough shapes to color. */
  tint?: Tint;
  start?: string | null;
  end?: string | null;
};

/** How long, in ms, the pointer rests on a collection before the map previews it. */
const PREVIEW_DELAY = 120;

/** A collection's items as the rail lists them: null until fetched, "error" when they couldn't be. */
export type Rows = ItemRow[] | "error" | null;

export function HomeConsole({
  env,
  areas,
  area,
  frame,
  items,
  emptyText,
  notice,
  railShare,
}: {
  env: EnvKey;
  areas: HomeArea[];
  /** The deployment's area; null when none is set. */
  area: FocusArea | null;
  /** Where the map opens, west, south, east, north. */
  frame: [number, number, number, number];
  items: FeatureCollection;
  /** What the rail says when the environment has no collections. */
  emptyText: string;
  /** A problem loading the catalog, shown at the top of the list. */
  notice?: string | null;
  /** The dataset list's share of the width, in percent (lib/rail-share.ts). */
  railShare: number;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // The shape of the selected collection under the cursor, on the map or in
  // its item rows; the other side lights it up.
  const [hoverKeys, setHoverKeys] = useState<string[]>([]);
  // The item under the cursor, in the rows or on the map, by id.
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [filter, setFilter] = useState<QcStatus | null>(null);
  // Whether the last selected collection is in the area, which outlines
  // the area more heavily.
  const [pickedInArea, setPickedInArea] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const searching = q.length > 0;

  const bySlug = useMemo(() => new Map(areas.map((a) => [a.slug, a])), [areas]);

  // Each collection's items, fetched when it's first picked and kept.
  const [rowsBySlug, setRowsBySlug] = useState<Record<string, ItemRow[] | "error">>({});
  const pending = useRef(new Set<string>());
  const load = useCallback(
    (slug: string) => {
      const a = bySlug.get(slug);
      if (!a || pending.current.has(slug)) return;
      pending.current.add(slug);
      fetch(`${a.jsonHref}/rows`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
        .then((data: { rows: ItemRow[] }) => setRowsBySlug((prev) => ({ ...prev, [slug]: data.rows })))
        .catch(() => setRowsBySlug((prev) => ({ ...prev, [slug]: "error" })))
        .finally(() => pending.current.delete(slug));
    },
    [bySlug],
  );
  useEffect(() => {
    if (selected && !rowsBySlug[selected]) load(selected);
  }, [selected, rowsBySlug, load]);

  const hierarchy = useMemo(() => hierarchyOf(areas), [areas]);
  const datasets = useMemo(() => areas.filter((a) => a.kind === "dataset"), [areas]);
  // The catalog opened in the rail, from ?in= (home-scope.tsx). A slug that
  // isn't a catalog here, or isn't here at all, opens nothing.
  const inParam = useSearchParams().get("in");
  const opened = useMemo(() => {
    const a = inParam ? bySlug.get(inParam) : null;
    return a?.kind === "catalog" ? a : null;
  }, [inParam, bySlug]);
  // The datasets the rail is about: all of them, or the opened catalog's.
  const inView = useMemo(() => {
    if (!opened) return datasets;
    const below = hierarchy.descendants([opened.slug]);
    return datasets.filter((a) => below.has(a.slug));
  }, [datasets, opened, hierarchy]);
  // Opening or leaving a catalog starts the rail afresh there. The search
  // that found the catalog would hide what's in it, and a dataset left
  // selected outside it would come back on Back. On a phone the sheet goes
  // too, since the rail it covers is what changed. Done while rendering,
  // the way React keeps state in step with a changed input.
  const openedSlug = opened?.slug ?? null;
  const [lastOpened, setLastOpened] = useState(openedSlug);
  if (lastOpened !== openedSlug) {
    setLastOpened(openedSlug);
    setQuery("");
    setHovered(null);
    const narrow = typeof window !== "undefined" && !window.matchMedia("(min-width: 64rem)").matches;
    if (selected && (narrow || !inView.some((a) => a.slug === selected))) setSelected(null);
  }
  // Review facets count this scope before applying the selected QC state.
  const scope = useMemo(() => q ? searchCollections(inView, q) : inView, [inView, q]);
  const shown = useMemo(() => scope.filter((a) => !filter || stateOf(a) === filter), [scope, filter]);
  // The opened catalog's empty catalogs, directly inside it.
  const emptyInOpened = useMemo(
    () => opened ? hierarchy.childrenOf(opened.slug).filter((c) => hierarchy.isEmpty(c.slug)) : [],
    [opened, hierarchy],
  );
  // Top-level catalogs that hold a dataset, and those that hold none yet.
  const roots = useMemo(() => {
    const top = areas.filter((a) => hierarchy.roots.has(a.slug) && a.kind === "catalog");
    return {
      full: top.filter((a) => a.datasetsBelow > 0).length,
      empty: top.filter((a) => a.datasetsBelow === 0),
      all: datasets.every((d) => hierarchy.rootCatalogOf(d.slug)),
    };
  }, [areas, datasets, hierarchy]);
  const shownIds = useMemo(() => new Set(shown.map((a) => a.slug)), [shown]);
  const activeSelected = selected && shownIds.has(selected) ? selected : null;
  const current = activeSelected ? (bySlug.get(activeSelected) ?? null) : null;
  const childCollections = useMemo(() => activeSelected ? hierarchy.childrenOf(activeSelected) : [], [hierarchy, activeSelected]);
  // An open dataset's child datasets can be previewed without becoming rows.
  // Catalogs inside it have nothing to draw.
  const previewableIds = useMemo(
    () => new Set([...shownIds, ...childCollections.filter((child) => child.kind === "dataset").map((child) => child.slug)]),
    [shownIds, childCollections],
  );
  const activeHovered = hovered && shownIds.has(hovered) ? hovered : null;
  const byState = useMemo(() => {
    const counts = Object.fromEntries(QC_STATUSES.map((s) => [s.value, 0])) as Record<QcStatus, number>;
    for (const a of scope) counts[stateOf(a)]++;
    return counts;
  }, [scope]);
  // While searching, where each matching dataset sits, for its row.
  const paths = useMemo(() => searching
    ? Object.fromEntries(shown.map((a) => [a.slug, hierarchy.pathOf(a.slug)]))
    : {}, [hierarchy, searching, shown]);
  // Catalogs that match, in the opened catalog or anywhere, one entry per
  // name: an Archive folder in seven places is one row that opens to seven.
  const catalogHits = useMemo<CatalogHit[]>(() => {
    if (!q) return [];
    const below = opened ? hierarchy.descendants([opened.slug]) : null;
    const catalogs = areas.filter((a) => a.kind === "catalog" && a.slug !== opened?.slug && (!below || below.has(a.slug)));
    const byName = new Map<string, CatalogHit>();
    for (const a of searchCollections(catalogs, q)) {
      const key = a.name.toLowerCase();
      let hit = byName.get(key);
      if (!hit) byName.set(key, (hit = { name: a.name, places: [] }));
      const trail = hierarchy.ancestorsOf(a.slug);
      // Inside an opened catalog, where it sits is said from there.
      const from = opened ? trail.findIndex((t) => t.slug === opened.slug) + 1 : 0;
      hit.places.push({ area: a, path: trail.map((t) => t.name), within: trail.slice(from).map((t) => t.name) });
    }
    for (const hit of byName.values()) hit.places.sort((x, y) => x.path.join(" ").localeCompare(y.path.join(" ")));
    return [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [q, areas, opened, hierarchy]);
  // Datasets under the catalog they sit in one level down from where the
  // rail is: a top-level catalog on the landing, a catalog inside the opened
  // one when one's open. Catalogs by name. Datasets directly at that level
  // come first, under no heading.
  const groups = useMemo<Group[]>(() => {
    if (!shown.length) return [];
    if (searching) return [{ key: "found", catalog: null, rows: shown }];
    const byHead = new Map<string, Group>();
    for (const a of shown) {
      const trail = hierarchy.ancestorsOf(a.slug);
      const head = trail[opened ? trail.findIndex((t) => t.slug === opened.slug) + 1 : 0];
      const catalog = head?.kind === "catalog" ? head : null;
      const key = catalog?.slug ?? "";
      let g = byHead.get(key);
      if (!g) byHead.set(key, (g = { key: key || "top", catalog: catalog ? { slug: catalog.slug, name: catalog.name } : null, rows: [] }));
      g.rows.push(a);
    }
    return [...byHead.values()].sort((x, y) =>
      !x.catalog ? -1 : !y.catalog ? 1 : x.catalog.name.localeCompare(y.catalog.name) || x.key.localeCompare(y.key));
  }, [shown, searching, hierarchy, opened]);
  // The way back out of the opened catalog: the catalog it's in, or the
  // landing. A dataset above it (Project Scoping's catalogs) can't be opened
  // in the rail, so the way back skips it.
  const openedParent = useMemo(
    () => opened ? (hierarchy.ancestorsOf(opened.slug).filter((t) => t.kind === "catalog").at(-1) ?? null) : null,
    [opened, hierarchy],
  );
  // Where the open dataset sits, for its facts.
  const trail = useMemo(
    () => current ? hierarchy.ancestorsOf(current.slug).filter((t) => t.kind === "catalog") : [],
    [current, hierarchy],
  );

  // The collection pointed at, a beat after the pointer gets there, so
  // sweeping down the list doesn't flash every footprint on the way. The
  // map previews it over the selected one, which stays put.
  const [pointed, setPointed] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPointed(hovered), PREVIEW_DELAY);
    return () => clearTimeout(t);
  }, [hovered]);
  const preview = pointed && previewableIds.has(pointed) && pointed !== activeSelected ? pointed : null;
  const previewArea = preview ? (bySlug.get(preview) ?? null) : null;

  // Footprints too heavy to send with the page, fetched the first time
  // their collection is picked or pointed at, and kept. One that can't be
  // fetched is kept empty, so the map draws nothing for it rather than
  // asking again on every hover.
  const [footprints, setFootprints] = useState<Record<string, Feature[]>>({});
  const fetching = useRef(new Set<string>());
  const loadFootprint = useCallback(
    (slug: string) => {
      const a = bySlug.get(slug);
      if (!a?.lazy || fetching.current.has(slug)) return;
      fetching.current.add(slug);
      fetch(`${a.jsonHref}/footprint`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
        .then((data: { features: Feature[] }) => setFootprints((prev) => ({ ...prev, [slug]: data.features })))
        .catch(() => setFootprints((prev) => ({ ...prev, [slug]: [] })))
        .finally(() => fetching.current.delete(slug));
    },
    [bySlug],
  );
  useEffect(() => {
    // Warm direct children's heavy footprints on expansion, before hover.
    // Inline footprints are already available; neither path loads item assets.
    for (const slug of [activeSelected, preview, ...childCollections.map((child) => child.slug)]) {
      if (slug && !footprints[slug]) loadFootprint(slug);
    }
  }, [activeSelected, preview, childCollections, footprints, loadFootprint]);
  const mapAreas = useMemo(() => previewArea && !shownIds.has(previewArea.slug)
    ? [...shown, previewArea]
    : shown, [shown, shownIds, previewArea]);
  const mapItems = useMemo<FeatureCollection>(() => {
    const fetched = Object.values(footprints).flat();
    return { type: "FeatureCollection", features: [...items.features, ...fetched].filter((f) => shownIds.has(f.properties?.slug) || f.properties?.slug === preview) };
  }, [items, footprints, shownIds, preview]);

  // Search/filter controls keep focus while the open row or mobile sheet
  // disappears. Clear selection rather than reviving it on a later search.
  const resetSelection = () => {
    setSelected(null);
    setHovered(null);
    setPointed(null);
    setPickedInArea(null);
    setHoverKeys([]);
    setHoveredItem(null);
  };

  // On a phone the sheet opens over the list where it was tapped, and the
  // page stays put, so closing it leaves the reader in the same place.
  const select = useCallback(
    (slug: string | null) => {
      const next = slug && slug === selected ? null : slug;
      setSelected(next);
      setHovered(null);
      setPointed(null);
      setHoverKeys([]);
      setHoveredItem(null);
      const a = next ? bySlug.get(next) : null;
      if (!a) return;
      setPickedInArea(a.inArea);
    },
    [bySlug, selected],
  );

  // Closing the open row or the phone's sheet. Focus inside either would go
  // down with it, so it moves to the row's button first.
  const close = useCallback(() => {
    if (!selected) return;
    const item = document.querySelector(`.sx-rail [data-slug="${CSS.escape(selected)}"]`);
    const sheet = document.querySelector(".sx-preview");
    const at = document.activeElement;
    if (item?.contains(at) || sheet?.contains(at)) item?.querySelector<HTMLElement>(".sx-row")?.focus({ preventScroll: true });
    setSelected(null);
    setHovered(null);
    setPointed(null);
  }, [selected]);

  // Escape closes the open row from anywhere on the page.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, close]);

  // What the map lights up. An item pointed at in the rows lights its shape
  // (a few shapes) or rings its dot (points); a shape pointed at on the map
  // lights its rows.
  const keyOf = useCallback((id: string) => current?.members?.find((m) => m.id === id)?.key, [current]);
  const keys = useMemo(() => {
    if (!hoveredItem) return hoverKeys;
    const key = keyOf(hoveredItem);
    return key ? [key] : [];
  }, [hoveredItem, hoverKeys, keyOf]);
  const ringIds = useMemo(() => (hoveredItem ? [hoveredItem] : []), [hoveredItem]);
  const activeIds = useMemo(
    () => new Set(current?.members?.filter((m) => hoverKeys.includes(m.key)).map((m) => m.id) ?? []),
    [current, hoverKeys],
  );
  const hoverValue = useMemo(() => ({ hovered: hoveredItem, setHovered: setHoveredItem }), [hoveredItem]);
  const openItem = useCallback(
    (id: string) => {
      if (current) router.push(itemHref(env, current.id, id));
    },
    [router, env, current],
  );

  const areaHighlight = (current ? pickedInArea : null) ?? (activeHovered ? (bySlug.get(activeHovered)?.inArea ?? false) : false);
  // The collection lighting up the whole area, when one is: the preview
  // draws over the selection, so it's named first.
  const coveredBy = (previewArea?.drawn === "area" ? previewArea : current?.drawn === "area" ? current : null)?.name ?? null;
  const rows: Rows = current ? (rowsBySlug[current.slug] ?? null) : null;

  return (
    <ItemHoverContext.Provider value={hoverValue}>
      <div className="sx-home">
        {/* The page has no visible title (the header names the app), but a screen reader's outline needs one. */}
        <h1 className="sr-only">Datasets in {envMeta(env).label}</h1>
        <p className="sr-only" role="status">
          {previewArea ? !previewArea.drawn
            ? `No map preview available for ${previewArea.name}.`
            : previewArea.lazy && !footprints[previewArea.slug]
              ? `Loading map preview for ${previewArea.name}.`
              : previewArea.lazy && !footprints[previewArea.slug]?.length
                ? `Map preview couldn't be loaded for ${previewArea.name}.`
                : previewArea.drawn === "area"
                  ? `Previewing ${previewArea.name} on the map. It covers all of ${area?.name ?? "the area"}.`
                  : `Previewing ${previewArea.name} on the map.`
            : ""}
        </p>
        <HomeSplit initial={railShare}>
          <div className="sx-console-map">
            <HomeMap
              areas={mapAreas}
              items={mapItems}
              area={area}
              frame={opened?.frame ?? frame}
              frameName={opened?.frame ? opened.name : null}
              shown={activeSelected}
              preview={preview}
              areaHighlight={areaHighlight}
              coveredBy={coveredBy}
              hoverKeys={keys}
              onHoverKeys={setHoverKeys}
              ringIds={ringIds}
              onHoverItem={setHoveredItem}
              onOpenItem={openItem}
            />
          </div>
          {current && (
            <HomePreview
              env={env}
              area={current}
              trail={trail}
              childCollections={childCollections}
              preview={preview}
              onHover={setHovered}
              rows={rows}
              activeIds={activeIds}
              onClose={close}
            />
          )}
          <HomeRail
            env={env}
            datasetCount={datasets.length}
            rootsWithData={roots.full}
            allInCatalogs={roots.all}
            emptyRoots={roots.empty}
            opened={opened}
            openedParent={openedParent}
            emptyInOpened={emptyInOpened}
            catalogsInside={(slug) => hierarchy.catalogsBelow(slug)}
            trail={trail}
            childCollections={childCollections}
            total={inView.length}
            paths={paths}
            catalogHits={catalogHits}
            groups={groups}
            byState={byState}
            notice={notice}
            emptyText={emptyText}
            filter={filter}
            onFilter={(value) => { resetSelection(); setFilter(value); }}
            query={query}
            onQuery={(value) => { resetSelection(); setQuery(value); }}
            search={searching ? { q, datasets: scope.length } : null}
            selected={activeSelected}
            hovered={activeHovered}
            preview={preview}
            rowsBySlug={rowsBySlug}
            activeIds={activeIds}
            onHover={setHovered}
            onSelect={select}
          />
        </HomeSplit>
      </div>
    </ItemHoverContext.Provider>
  );
}
