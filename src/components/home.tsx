"use client";

import nextDynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FeatureCollection } from "geojson";
import { clipToFocus } from "@/lib/basins";
import { AREA_KIND_GROUP, AREA_KIND_LABEL, type AreaKind } from "@/lib/kinds";
import { fmtNum, fmtYears } from "@/lib/format";
import { versionName } from "@/lib/versions";
import type { Tint } from "@/lib/overview";
import type { QcEdit, QcStatus } from "@/lib/stac";
import { HomePreview, PreviewBody } from "./home-preview";
import { QC_LABEL, QcMark, STATE_ORDER, stateOf } from "./qc-mark";

/**
 * The home page, a console for people who already know FFRD: the
 * collections rail on the left and the map on the right, filling the window
 * under the environment band. Nothing here says what stac-x is; the header
 * does that. One shared hover joins the list and the pins, so pointing at a
 * name finds its mark and pointing at a mark finds its name.
 *
 * The map's review menu is the legend for the pins' marks and the review
 * filter in one: each state's row shows its count and narrows the rail to
 * that state, dimming the other pins. The rail groups by kind or by review
 * state. Selecting a collection expands its row in place with enough to
 * decide whether to open it, and draws its footprint on the map; nothing
 * covers the map. Enter on a row opens the collection, Escape closes the row.
 *
 * On a phone the page is a plain column: the map, then the rail with the
 * state buttons in its head, and a selection opens a sheet over the map
 * instead. The map is first in the DOM because that is the phone's order;
 * on a wide screen the row is reversed so the rail sits on the left.
 */

const HomeMap = nextDynamic(() => import("./home-map").then((m) => m.HomeMap), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-inset" style={{ position: "absolute", inset: 0 }} />,
});

export type HomeArea = {
  slug: string;
  name: string;
  kind: AreaKind;
  huc4: string;
  bbox: [number, number, number, number];
  /** Covers most of the basin: no pin, and "Whole basin" in the rail. */
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

export type GroupBy = "kind" | "review";

/** The order of the rail's review groups: what needs someone first. */
const REVIEW_GROUPS: QcStatus[] = ["needs_revision", "rejected", "pending", "approved"];
const GROUP_KEY = "sx-home-group";
const WIDE_SCREEN = "(min-width: 64rem)";

/**
 * The rail's grouping, a per-viewer preference kept in localStorage. Read
 * through useSyncExternalStore so the server render (always by kind) and
 * the browser's agree, and so a change in another tab carries over.
 */
const GROUP_EVENT = "sx-home-group";
// Kept here too, for when storage is blocked.
let groupInMemory: GroupBy = "kind";
function readGroup(): GroupBy {
  try {
    const v = localStorage.getItem(GROUP_KEY);
    return v === "review" || v === "kind" ? v : groupInMemory;
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

export function HomeConsole({
  areas,
  items,
  byState,
  emptyText,
  notice,
}: {
  areas: HomeArea[];
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
  // its member list; the other side lights it up.
  const [hoverKeys, setHoverKeys] = useState<string[]>([]);
  const [filter, setFilter] = useState<QcStatus | null>(null);
  const groupBy = useSyncExternalStore(subscribeGroup, readGroup, () => "kind");
  const [basin, setBasin] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ bbox: [number, number, number, number]; key: number } | null>(null);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const listRef = useRef<HTMLUListElement>(null);


  const shown = useMemo(
    () =>
      areas.filter(
        (a) =>
          (!filter || stateOf(a) === filter) &&
          (!q || `${a.name} ${a.slug} ${AREA_KIND_LABEL[a.kind]}`.toLowerCase().includes(q)),
      ),
    [areas, filter, q],
  );
  const groups = useMemo(() => {
    const list =
      groupBy === "kind"
        ? AREA_KIND_GROUP.map(([kind, label]) => ({ key: kind, label, rows: shown.filter((a) => a.kind === kind) }))
        : REVIEW_GROUPS.map((s) => ({ key: s, label: QC_LABEL[s], rows: shown.filter((a) => stateOf(a) === s) }));
    return list.filter((g) => g.rows.length);
  }, [shown, groupBy]);

  const bySlug = useMemo(() => new Map(areas.map((a) => [a.slug, a])), [areas]);
  const current = selected ? bySlug.get(selected) ?? null : null;

  const mapBoxRef = useRef<HTMLDivElement>(null);
  const select = useCallback(
    (slug: string | null, fromList = false) => {
      const next = slug && slug === selected ? null : slug;
      setSelected(next);
      setHoverKeys([]);
      const a = next ? bySlug.get(next) : null;
      if (!a) return;
      // On a phone the list is under the map, and the sheet opens on the map.
      if (fromList && !matchMedia(WIDE_SCREEN).matches) {
        const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
        mapBoxRef.current?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
      }
      // Selecting a collection lights up its basin and draws its footprint,
      // but doesn't move the map: the whole South Platte is in view, so what
      // was clicked is already on screen.
      setBasin(a.huc4);
    },
    [bySlug, selected],
  );

  const selectBasin = useCallback(
    (huc4: string) => {
      setBasin(huc4);
      setSelected(null);
      // Zoom to the union of the basin's areas, which is what the catalog has there.
      const list = areas.filter((a) => a.huc4 === huc4);
      if (list.length) {
        const bbox: [number, number, number, number] = [
          Math.min(...list.map((a) => a.bbox[0])),
          Math.min(...list.map((a) => a.bbox[1])),
          Math.max(...list.map((a) => a.bbox[2])),
          Math.max(...list.map((a) => a.bbox[3])),
        ];
        setFocus({ bbox: clipToFocus(bbox), key: Date.now() });
      }
    },
    [areas],
  );

  // Escape closes the open row from anywhere on the page.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  // Scroll the list so the whole open row is in view, below its sticky group
  // heading. Done by hand rather than scrollIntoView, which would scroll the
  // page too.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!selected || !list || !matchMedia(WIDE_SCREEN).matches) return;
    const row = list.querySelector<HTMLElement>(`[data-slug="${CSS.escape(selected)}"]`);
    if (!row) return;
    const head = row.closest(".sx-group")?.querySelector<HTMLElement>(".sx-group-head");
    const headH = head?.offsetHeight ?? 0;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const bottom = top + row.offsetHeight;
    if (top - headH < list.scrollTop) list.scrollTop = top - headH;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = Math.min(top - headH, bottom - list.clientHeight);
  }, [selected, groupBy]);

  const highlightedBasin = basin ?? (hovered ? bySlug.get(hovered)?.huc4 ?? null : null);

  return (
    <div className="sx-home">
      <div className="sx-console">
        <div ref={mapBoxRef} className="sx-console-map">
          <HomeMap
            areas={areas}
            items={items}
            highlight={selected ?? hovered}
            shown={selected}
            filter={filter}
            basinHighlight={highlightedBasin}
            basinCovered={current?.drawn === "basin"}
            focus={focus}
            hoverKeys={hoverKeys}
            onHover={setHovered}
            onHoverKeys={setHoverKeys}
            onSelect={select}
            onBasinSelect={selectBasin}
          />
          {current && <HomePreview area={current} hoverKeys={hoverKeys} onHoverKeys={setHoverKeys} onClose={() => setSelected(null)} />}
        </div>
        <aside className="sx-rail" aria-label="Collections">
          <div className="sx-rail-head">
            <div className="sx-rail-title">
              <h2>Collections</h2>
              <span className="sx-rail-count ffx-num">
                {shown.length} of {areas.length}
              </span>
              <div className="sx-group-switch" role="group" aria-label="Group by">
                <span className="sx-group-switch-l" aria-hidden="true">Group by</span>
                {(["kind", "review"] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={groupBy === v} onClick={() => regroup(v)}>
                    {v === "kind" ? "Kind" : "Review"}
                  </button>
                ))}
              </div>
            </div>
            <label className="ffx-field">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search collections</span>
              <input
                type="search"
                placeholder="Search collections"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {/* The review states with their counts: the legend for the rows'
                marks, and a filter. Each row carries its own mark too. */}
            {areas.length > 0 && (
              <div className="sx-rail-states" role="group" aria-label="Filter by review state">
                {STATE_ORDER.map((st) => (
                  <button
                    key={st}
                    type="button"
                    className="sx-state-btn"
                    aria-pressed={filter === st}
                    onClick={() => setFilter(filter === st ? null : st)}
                  >
                    <QcMark state={st} />
                    <b className="ffx-num">{fmtNum(byState[st])}</b>
                    <span>{QC_LABEL[st]}</span>
                  </button>
                ))}
              </div>
            )}
            {filter && (
              <p className="sx-filter-line" role="status">
                <span>
                  Showing <b>{QC_LABEL[filter]}</b> only
                </span>
                <button type="button" onClick={() => setFilter(null)}>
                  Show all
                </button>
              </p>
            )}
          </div>
          {notice && (
            <p className="sx-rail-note" role="status">
              {notice}
            </p>
          )}
          <ul ref={listRef} className="sx-rail-list ffx-scroll">
            {groups.length === 0 && <li className="sx-empty">{areas.length ? "No collections match." : emptyText}</li>}
            {groups.map((g) => (
              <li key={g.key} className="sx-group">
                <div className="sx-group-head">
                  <h3>{g.label}</h3>
                  <span className="ffx-num">{g.rows.length}</span>
                </div>
                <ul>
                  {g.rows.map((a) => (
                    <AreaRow
                      key={a.slug}
                      area={a}
                      showKind={groupBy === "review"}
                      active={(selected ?? hovered) === a.slug}
                      open={selected === a.slug}
                      hoverKeys={hoverKeys}
                      onHover={setHovered}
                      onHoverKeys={setHoverKeys}
                      onSelect={(slug) => select(slug, true)}
                      onOpen={() => router.push(a.href)}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function AreaRow({
  area,
  showKind,
  active,
  open,
  hoverKeys,
  onHover,
  onHoverKeys,
  onSelect,
  onOpen,
}: {
  area: HomeArea;
  showKind: boolean;
  active: boolean;
  open: boolean;
  hoverKeys: string[];
  onHover: (slug: string | null) => void;
  onHoverKeys: (keys: string[]) => void;
  onSelect: (slug: string) => void;
  onOpen: () => void;
}) {
  const meta = [
    showKind ? AREA_KIND_LABEL[area.kind] : null,
    fmtYears(area.temporal) ?? "No dates",
    area.wide ? "Whole basin" : null,
  ].filter(Boolean);
  return (
    <li className="sx-rail-item" data-active={active} data-open={open} data-slug={area.slug}>
      <button
        type="button"
        className="sx-row"
        aria-expanded={open}
        onClick={() => onSelect(area.slug)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          onOpen();
        }}
        onMouseEnter={() => onHover(area.slug)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(area.slug)}
        onBlur={() => onHover(null)}
      >
        <QcMark state={stateOf(area)} />
        <span className="sx-row-main">
          <span className="sx-row-title">
            {area.name}
          </span>
          <span className="sx-row-sub">
            <span className="ffx-num">{meta.join(" · ")}</span>
            {area.version && <span className="sx-tag">{versionName(area.version)}</span>}
          </span>
        </span>
        <span className="sx-row-aside ffx-num">{fmtNum(area.itemCount)}</span>
      </button>
      {open && (
        <div className="sx-row-more">
          <PreviewBody area={area} hoverKeys={hoverKeys} onHoverKeys={onHoverKeys} />
        </div>
      )}
    </li>
  );
}
