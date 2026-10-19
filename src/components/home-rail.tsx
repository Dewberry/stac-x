"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AREA_KIND_GROUP, AREA_KIND_LABEL } from "@/lib/kinds";
import { fmtNum } from "@/lib/format";
import type { QcStatus } from "@/lib/stac";
import { ColHead } from "./col-head";
import type { HomeArea } from "./home";
import { AreaSub } from "./home-preview";
import { Icon, ICONS } from "./icons";
import { QC_LABEL, QcMark, STATE_ORDER, stateOf } from "./qc-mark";

/**
 * The collections rail, the left column of the home console: a column
 * header (Collections and how many, the grouping, the fold button) and a
 * card with a search box, the review states as a legend and filter, and the
 * rows in groups. Selecting a row shows that collection in the pane beside
 * the rail and draws its footprint on the map. Pointing at a row previews
 * its footprint. Enter on a row opens the collection.
 *
 * The rail folds away entirely, giving the collection and the map the
 * width; its toggle then sits at the start of the collection header, so
 * folding it adds no column of its own. Search and filter are kept here,
 * so they survive a fold.
 */

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

export function HomeRail({
  areas,
  byState,
  notice,
  emptyText,
  selected,
  hovered,
  open,
  onToggle,
  onHover,
  onSelect,
  onOpen,
}: {
  areas: HomeArea[];
  /** How many collections are in each review state. */
  byState: Record<QcStatus, number>;
  /** A problem loading the catalog, shown at the top of the list. */
  notice?: string | null;
  /** What the rail says when the environment has no collections. */
  emptyText: string;
  selected: string | null;
  hovered: string | null;
  open: boolean;
  onToggle: () => void;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
  onOpen: (href: string) => void;
}) {
  const [filter, setFilter] = useState<QcStatus | null>(null);
  const [query, setQuery] = useState("");
  const groupBy = useSyncExternalStore(subscribeGroup, readGroup, () => "kind");
  const listRef = useRef<HTMLUListElement>(null);
  const q = query.trim().toLowerCase();

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

  // Scroll the list so the selected row is in view, below its sticky group
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

  if (!open) return null;

  return (
    <>
      <ColHead
        id="col-rail-h"
        title="Collections"
        tag={shown.length === areas.length ? fmtNum(areas.length) : `${fmtNum(shown.length)} of ${fmtNum(areas.length)}`}
        actions={
          <>
            <div className="sx-group-switch" role="group" aria-label="Group by">
              <span className="sx-group-switch-l" aria-hidden="true">Group by</span>
              {(["kind", "review"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={groupBy === v} onClick={() => regroup(v)}>
                  {v === "kind" ? "Kind" : "Review"}
                </button>
              ))}
            </div>
            <RailToggle open onToggle={onToggle} />
          </>
        }
      />
      <section id="col-rail" className="ffx-panel sx-rail" aria-labelledby="col-rail-h">
        <div className="sx-rail-head">
          <label className="ffx-field">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Search collections</span>
            <input type="search" placeholder="Search collections" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                    active={(hovered ?? selected) === a.slug}
                    open={selected === a.slug}
                    onHover={onHover}
                    onSelect={onSelect}
                    onOpen={() => onOpen(a.href)}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * Folds the rail away (in the Collections header) or brings it back (in the
 * collection header). The same icon both ways; the label and aria-expanded
 * say which. Disabled while the catalog loads, where there's nothing to fold.
 */
export function RailToggle({ open, onToggle, disabled }: { open: boolean; onToggle?: () => void; disabled?: boolean }) {
  const words = open ? "Hide collections" : "Show collections";
  return (
    <button
      type="button"
      className="sx-iconbtn sx-railbtn"
      aria-expanded={open}
      aria-controls={open ? "col-rail" : undefined}
      aria-label={words}
      title={words}
      disabled={disabled}
      onClick={onToggle}
    >
      <Icon d={ICONS.sidebar} size={16} />
    </button>
  );
}

function AreaRow({
  area,
  showKind,
  active,
  open,
  onHover,
  onSelect,
  onOpen,
}: {
  area: HomeArea;
  showKind: boolean;
  active: boolean;
  open: boolean;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
  onOpen: () => void;
}) {
  return (
    <li className="sx-rail-item" data-active={active} data-open={open} data-slug={area.slug}>
      <button
        type="button"
        className="sx-row"
        aria-current={open ? "true" : undefined}
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
          <span className="sx-row-title">{area.name}</span>
          <AreaSub area={area} showKind={showKind} />
        </span>
        <span className="sx-row-aside ffx-num">{fmtNum(area.itemCount)}</span>
      </button>
    </li>
  );
}
