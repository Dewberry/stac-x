"use client";

import nextDynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FeatureCollection, MultiPolygon } from "geojson";
import { envMeta, type EnvKey } from "@/lib/env";
import type { Tint } from "@/lib/overview";
import type { QcEdit, QcStatus } from "@/lib/stac";
import { itemHref } from "@/lib/utils";
import { HomePreview } from "./home-preview";
import { HomeRail, type Group } from "./home-rail";
import { ItemHoverContext } from "./item-hover";
import type { ItemRow } from "./items-list";
import { QC_LABEL, stateOf } from "./qc-mark";

/**
 * The home page, a console for people who already know FFRD: the
 * collections rail on the left and the map on the right, filling the window
 * under the environment band. Nothing here says what stac-x is; the header
 * does that.
 *
 * The rail is the way in. Its search box matches collections by title and
 * description; the review states in its head are the legend for the marks
 * and the review filter in one; the rows are one list by name, or grouped
 * by review state.
 * Selecting a collection opens its row in place, with enough to decide
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
  /** What the items are on the map: all points, any shapes, or no geometry at all. */
  unit: "points" | "shapes" | "items";
  /** The file's geometry couldn't be read, so nothing of it is drawn and the row says so. */
  geometryError?: boolean;
  /** Where the extent sits against the deployment's area; null when there's no area or no extent. */
  coverage: "whole" | "part" | "larger" | null;
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

export type GroupBy = "none" | "review";

/** The order of the rail's review groups: what needs someone first. */
const REVIEW_GROUPS: QcStatus[] = ["needs_revision", "rejected", "pending", "approved"];
const GROUP_KEY = "sx-home-group";
/** How long, in ms, the pointer rests on a collection before the map previews it. */
const PREVIEW_DELAY = 120;

/**
 * The rail's grouping, a per-viewer preference kept in localStorage. Read
 * through useSyncExternalStore so the server render (never grouped) and
 * the browser's agree, and so a change in another tab carries over.
 */
const GROUP_EVENT = "sx-home-group";
// Kept here too, for when storage is blocked.
let groupInMemory: GroupBy = "none";
function readGroup(): GroupBy {
  try {
    const v = localStorage.getItem(GROUP_KEY);
    return v === "review" || v === "none" ? v : groupInMemory;
  } catch {
    return groupInMemory;
  }
}
function subscribeGroup(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(GROUP_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(GROUP_EVENT, onChange);
  };
}
function regroup(v: GroupBy) {
  groupInMemory = v;
  try {
    localStorage.setItem(GROUP_KEY, v);
  } catch {}
  window.dispatchEvent(new Event(GROUP_EVENT));
}

/** A collection's items as the rail lists them: null until fetched, "error" when they couldn't be. */
export type Rows = ItemRow[] | "error" | null;

export function HomeConsole({
  env,
  areas,
  area,
  frame,
  items,
  byState,
  emptyText,
  notice,
}: {
  env: EnvKey;
  areas: HomeArea[];
  /** The deployment's area; null when none is set. */
  area: FocusArea | null;
  /** Where the map opens, west, south, east, north. */
  frame: [number, number, number, number];
  items: FeatureCollection;
  /** How many collections are in each review state. */
  byState: Record<QcStatus, number>;
  /** What the rail says when the environment has no collections. */
  emptyText: string;
  /** A problem loading the catalog, shown at the top of the list. */
  notice?: string | null;
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
  const groupBy = useSyncExternalStore(subscribeGroup, readGroup, (): GroupBy => "none");
  // Whether the last selected collection is in the area, which outlines
  // the area more heavily.
  const [pickedInArea, setPickedInArea] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const searching = q.length > 0;

  const bySlug = useMemo(() => new Map(areas.map((a) => [a.slug, a])), [areas]);
  const current = selected ? (bySlug.get(selected) ?? null) : null;

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

  // The search matches a collection's title and description, not its items.
  const shown = useMemo(
    () => areas.filter((a) => (!filter || stateOf(a) === filter) && (!searching || [a.name, a.blurb].some((t) => t?.toLowerCase().includes(q)))),
    [areas, filter, searching, q],
  );
  const groups = useMemo<Group[]>(() => {
    const list =
      groupBy === "review"
        ? REVIEW_GROUPS.map((s) => ({ key: s, label: QC_LABEL[s], rows: shown.filter((a) => stateOf(a) === s) }))
        : [{ key: "all", label: null, rows: shown }];
    return list.filter((g) => g.rows.length);
  }, [shown, groupBy]);

  // The collection pointed at, a beat after the pointer gets there, so
  // sweeping down the list doesn't flash every footprint on the way. The
  // map previews it over the selected one, which stays put.
  const [pointed, setPointed] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPointed(hovered), PREVIEW_DELAY);
    return () => clearTimeout(t);
  }, [hovered]);
  const preview = pointed && pointed !== selected ? pointed : null;
  const previewArea = preview ? (bySlug.get(preview) ?? null) : null;

  // On a phone the sheet opens over the list where it was tapped, and the
  // page stays put, so closing it leaves the reader in the same place.
  const select = useCallback(
    (slug: string | null) => {
      const next = slug && slug === selected ? null : slug;
      setSelected(next);
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

  const areaHighlight = pickedInArea ?? (hovered ? (bySlug.get(hovered)?.inArea ?? false) : false);
  const areaCovered = current?.drawn === "area" || previewArea?.drawn === "area";
  const rows: Rows = current ? (rowsBySlug[current.slug] ?? null) : null;

  return (
    <ItemHoverContext.Provider value={hoverValue}>
      <div className="sx-home">
        {/* The page has no visible title (the header names the app), but a screen reader's outline needs one. */}
        <h1 className="sr-only">Collections in {envMeta(env).label}</h1>
        <div className="sx-console">
          <div className="sx-console-map">
            <HomeMap
              areas={areas}
              items={items}
              area={area}
              frame={frame}
              shown={selected}
              preview={preview}
              areaHighlight={areaHighlight}
              areaCovered={areaCovered}
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
              rows={rows}
              activeIds={activeIds}
              onClose={close}
            />
          )}
          <HomeRail
            env={env}
            areas={areas}
            groups={groups}
            byState={byState}
            notice={notice}
            emptyText={emptyText}
            groupBy={groupBy}
            onGroupBy={regroup}
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
            search={searching ? { q, collections: shown.length, hidden: shown.length < areas.length } : null}
            selected={selected}
            hovered={hovered}
            preview={preview}
            rowsBySlug={rowsBySlug}
            activeIds={activeIds}
            onHover={setHovered}
            onSelect={select}
          />
        </div>
      </div>
    </ItemHoverContext.Provider>
  );
}
