"use client";

import nextDynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FeatureCollection } from "geojson";
import type { EnvKey } from "@/lib/env";
import type { AreaKind } from "@/lib/kinds";
import type { Tint } from "@/lib/overview";
import type { QcEdit, QcStatus } from "@/lib/stac";
import { ColHead } from "./col-head";
import { HomePane } from "./home-pane";
import { HomeRail, RailToggle } from "./home-rail";
import { ItemHoverContext } from "./item-hover";
import type { ItemRow } from "./items-list";

/**
 * The home page, a console for people who already know FFRD: three columns
 * under the environment band, each with a one-line header over a card. The
 * collections rail on the left, the selected collection (what it is, then
 * its items) in the middle, and the map on the right. Nothing here says
 * what stac-x is; the header does that.
 *
 * A collection is always selected: the first in the rail until one is
 * picked, so the page is never empty. Selecting one shows it in the middle
 * column and draws its footprint on the map; clicking the footprint opens a
 * card with the items there. Pointing at another row previews that one's
 * footprint, and the selected one returns when the pointer leaves. Enter on
 * a row opens the collection.
 *
 * The rail folds away (its toggle, kept in localStorage) to give the
 * collection and the map the width. The rail and the map stick to the
 * window while the collection's items scroll. On a phone the page is a
 * plain column: the rail, the collection header, the map, then the items.
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
  kind: AreaKind;
  huc4: string;
  bbox: [number, number, number, number];
  /** Covers most of the basin: "Whole basin" in the rail. */
  wide?: boolean;
  /**
   * How the collection's footprint is drawn on the map; null when it isn't.
   * "basin" means it contains the whole basin, which lights up instead. See
   * lib/overview.ts.
   */
  drawn: "points" | "areas" | "density" | "extent" | "basin" | null;
  /** For a density footprint, the count range of each of its three steps. */
  steps?: [number, number][];
  /**
   * For an areas footprint of a few shapes: the items behind them, each with
   * the `key` of the shape it's drawn as. Items with one geometry share a key.
   */
  members?: Member[];
  href: string;
  jsonHref: string;
  itemCount: number;
  temporal: [string | null, string | null] | null;
  /** The collection's QC record; null when it has none or isn't published. */
  qc: QcEdit | null;
  /** The latest version's label, and how many versions came before it. */
  version?: string | null;
  earlier?: number;
  blurb?: string;
};

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
};

const WIDE_SCREEN = "(min-width: 64rem)";
/** How long, in ms, the pointer rests on a collection before the map previews it. */
const PREVIEW_DELAY = 120;

/**
 * Whether the rail is open, a per-viewer preference kept in localStorage the
 * same way the rail's grouping is: read through useSyncExternalStore so the
 * server render (always open) and the browser's agree.
 */
const RAIL_KEY = "sx-home-rail";
let railInMemory = true;
function readRail(): boolean {
  try {
    const v = localStorage.getItem(RAIL_KEY);
    return v === "closed" ? false : v === "open" ? true : railInMemory;
  } catch {
    return railInMemory;
  }
}
function subscribeRail(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(RAIL_KEY, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RAIL_KEY, onChange);
  };
}
function setRail(open: boolean) {
  railInMemory = open;
  try {
    localStorage.setItem(RAIL_KEY, open ? "open" : "closed");
  } catch {}
  window.dispatchEvent(new Event(RAIL_KEY));
}

type Rows = ItemRow[] | "error";

export function HomeConsole({
  env,
  areas,
  items,
  byState,
  initialRows,
  emptyText,
  notice,
}: {
  env: EnvKey;
  areas: HomeArea[];
  items: FeatureCollection;
  /** How many collections are in each review state. */
  byState: Record<QcStatus, number>;
  /** The first collection's items, sent with the page so the console opens full. */
  initialRows: { slug: string; rows: ItemRow[] } | null;
  /** What the rail says when the environment has no collections. */
  emptyText: string;
  /** A problem loading the catalog, shown at the top of the list. */
  notice?: string | null;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  // The row picked in the rail; the first row stands in until one is.
  const [picked, setPicked] = useState<string | null>(null);
  // The shape of the selected collection under the cursor, on the map or in
  // its item rows; the other side lights it up.
  const [hoverKeys, setHoverKeys] = useState<string[]>([]);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [basin, setBasin] = useState<string | null>(null);
  const railOpen = useSyncExternalStore(subscribeRail, readRail, () => true);
  const toggleRail = useCallback(() => setRail(!readRail()), []);

  const bySlug = useMemo(() => new Map(areas.map((a) => [a.slug, a])), [areas]);
  const selected = picked && bySlug.has(picked) ? picked : (areas[0]?.slug ?? null);
  const current = selected ? (bySlug.get(selected) ?? null) : null;

  // Each collection's items, fetched when it's first picked and kept. The
  // first collection's come with the page.
  const [rowsBySlug, setRowsBySlug] = useState<Record<string, Rows>>(() => (initialRows ? { [initialRows.slug]: initialRows.rows } : {}));
  const rows = selected ? (rowsBySlug[selected] ?? null) : null;
  useEffect(() => {
    if (!current || rows) return;
    const slug = current.slug;
    const ac = new AbortController();
    fetch(`${current.jsonHref}/rows`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: { rows: ItemRow[] }) => setRowsBySlug((prev) => ({ ...prev, [slug]: data.rows })))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setRowsBySlug((prev) => ({ ...prev, [slug]: "error" }));
      });
    return () => ac.abort();
  }, [current, rows]);

  // The collection pointed at, a beat after the pointer gets there, so
  // sweeping down the list doesn't flash every footprint on the way. The
  // map previews it over the selected one, which comes back on leave.
  const [pointed, setPointed] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPointed(hovered), PREVIEW_DELAY);
    return () => clearTimeout(t);
  }, [hovered]);
  const preview = pointed && pointed !== selected ? pointed : null;
  const drawn = preview ? (bySlug.get(preview) ?? null) : current;

  const paneRef = useRef<HTMLDivElement>(null);
  const select = useCallback(
    (slug: string) => {
      setPicked(slug);
      setHoverKeys([]);
      setHoveredItem(null);
      const a = bySlug.get(slug);
      if (!a) return;
      // On a phone the pane is under the rail, so a pick scrolls to it.
      if (!matchMedia(WIDE_SCREEN).matches) {
        const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
        paneRef.current?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
      }
      // Selecting a collection lights up its basin and draws its footprint,
      // but doesn't move the map: the whole South Platte is in view, so what
      // was clicked is already on screen.
      setBasin(a.huc4);
    },
    [bySlug],
  );

  // An item row pointed at lights its shape on the map, when the collection
  // draws as a few shapes; a shape pointed at on the map lights its rows.
  const itemKey = hoveredItem ? current?.members?.find((m) => m.id === hoveredItem)?.key : undefined;
  const keys = itemKey ? [itemKey] : hoverKeys;
  const activeIds = useMemo(
    () => new Set(current?.members?.filter((m) => hoverKeys.includes(m.key)).map((m) => m.id) ?? []),
    [current, hoverKeys],
  );
  const hoverValue = useMemo(() => ({ hovered: hoveredItem, setHovered: setHoveredItem }), [hoveredItem]);

  const highlightedBasin = basin ?? (hovered ? (bySlug.get(hovered)?.huc4 ?? null) : null);

  const map = (
    <section className="ffx-panel sx-console-map" aria-label="Map">
      <HomeMap
        areas={areas}
        items={items}
        shown={selected}
        preview={preview}
        basinHighlight={highlightedBasin}
        basinCovered={drawn?.drawn === "basin"}
        hoverKeys={keys}
        onHoverKeys={setHoverKeys}
      />
    </section>
  );

  return (
    <div className="sx-page sx-home">
      <div className="sx-console" data-rail={railOpen ? undefined : "closed"}>
        <HomeRail
          areas={areas}
          byState={byState}
          notice={notice}
          emptyText={emptyText}
          selected={selected}
          hovered={hovered}
          open={railOpen}
          onToggle={toggleRail}
          onHover={setHovered}
          onSelect={select}
          onOpen={(href) => router.push(href)}
        />
        {current ? (
          <ItemHoverContext.Provider value={hoverValue}>
            <HomePane
              env={env}
              area={current}
              rows={rows}
              railToggle={railOpen ? undefined : <RailToggle open={false} onToggle={toggleRail} />}
              activeIds={activeIds}
              map={map}
              paneRef={paneRef}
            />
          </ItemHoverContext.Provider>
        ) : (
          <div className="sx-pane">
            <ColHead className="sx-pane-head" title="No collections" lead={railOpen ? undefined : <RailToggle open={false} onToggle={toggleRail} />} />
            <ColHead className="sx-map-head" title="Map" />
            <div className="sx-pane-side">{map}</div>
            <section className="ffx-panel sx-items">
              <p className="sx-empty">{emptyText}</p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
