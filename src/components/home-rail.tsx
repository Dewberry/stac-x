"use client";

import { useLayoutEffect, useRef } from "react";
import type { EnvKey } from "@/lib/env";
import { fmtNum } from "@/lib/format";
import type { QcStatus } from "@/lib/stac";
import type { GroupBy, HomeArea, Rows } from "./home";
import { AreaSub, OpenRow } from "./home-preview";
import type { ItemRow } from "./items-list";
import { QC_LABEL, QcMark, STATE_ORDER } from "./qc-mark";

/**
 * The collections rail, the left side of the home console: its head
 * (Collections and how many, the grouping, the search box, the review
 * states as legend and filter) and the rows in groups. A row is the
 * collection's name, its count and one line of where and when; the
 * selected row opens in place (OpenRow) with the collection's description,
 * its review state, the way in and its items. Pointing at a row previews
 * its footprint on the map; Enter on a row opens the collection.
 *
 * The search box appears only past SEARCH_MIN collections: a list that's
 * all in view has nothing to search. While there is one, it matches items
 * as well as collections, a collection with matching items is open on
 * them, and the groups with nothing in them fold into one line.
 */

export type Group = { key: string; label: string; rows: HomeArea[] };

/** Past this many collections the rail gets a search box. */
export const SEARCH_MIN = 10;

/** What the search found, while there is one. */
export type Search = {
  q: string;
  /** Collections matched by name. */
  collections: number;
  /** Items matched by name or id, across every collection. */
  items: number;
  /** Some collections' items are still being fetched. */
  pending: boolean;
  /** Some collections are out of the rail for not matching. */
  hidden: boolean;
};

const WIDE_SCREEN = "(min-width: 64rem)";

export function HomeRail({
  env,
  areas,
  groups,
  byState,
  notice,
  emptyText,
  groupBy,
  onGroupBy,
  filter,
  onFilter,
  query,
  onQuery,
  search,
  selected,
  hovered,
  preview,
  rowsBySlug,
  itemMatches,
  activeIds,
  onHover,
  onSelect,
  onOpen,
}: {
  env: EnvKey;
  areas: HomeArea[];
  groups: Group[];
  /** How many collections are in each review state. */
  byState: Record<QcStatus, number>;
  /** A problem loading the catalog, shown at the top of the list. */
  notice?: string | null;
  /** What the rail says when the environment has no collections. */
  emptyText: string;
  groupBy: GroupBy;
  onGroupBy: (v: GroupBy) => void;
  filter: QcStatus | null;
  onFilter: (v: QcStatus | null) => void;
  query: string;
  onQuery: (v: string) => void;
  search: Search | null;
  selected: string | null;
  hovered: string | null;
  /** The collection whose footprint the map is previewing, if not the selected one. */
  preview: string | null;
  rowsBySlug: Record<string, ItemRow[] | "error">;
  /** The items the search matched, by collection. */
  itemMatches: Map<string, ItemRow[]>;
  /** Item ids whose shape is under the cursor on the map, for the rows to light up. */
  activeIds: ReadonlySet<string>;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
  onOpen: (href: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const shownCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const searchable = areas.length > SEARCH_MIN;

  // Scroll the list so the open row's head is in view, below its sticky
  // group heading. Done by hand rather than scrollIntoView, which would
  // scroll the page too.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!selected || !list || !matchMedia(WIDE_SCREEN).matches) return;
    const row = list.querySelector<HTMLElement>(`[data-slug="${CSS.escape(selected)}"] > .sx-row`);
    if (!row) return;
    const head = row.closest(".sx-group")?.querySelector<HTMLElement>(".sx-group-head");
    const headH = head?.offsetHeight ?? 0;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const bottom = top + row.offsetHeight;
    if (top - headH < list.scrollTop) list.scrollTop = top - headH;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = Math.min(top - headH, bottom - list.clientHeight);
  }, [selected, groupBy]);

  return (
    <aside className="sx-rail" aria-label="Collections">
      <div className="sx-rail-head">
        <div className="sx-rail-title">
          <h2>Collections</h2>
          <span className="sx-rail-count ffx-num">
            {shownCount} of {areas.length}
          </span>
          <div className="sx-group-switch" role="group" aria-label="Group by">
            <span className="sx-group-switch-l" aria-hidden="true">Group by</span>
            {(["kind", "review"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={groupBy === v} onClick={() => onGroupBy(v)}>
                {v === "kind" ? "Kind" : "Review"}
              </button>
            ))}
          </div>
        </div>
        {searchable && (
          <label className="ffx-field">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Search collections and items</span>
            <input type="search" placeholder="Search collections and items" value={query} onChange={(e) => onQuery(e.target.value)} />
          </label>
        )}
        {search && (
          <p className="sx-search-line" role="status">
            <span className="ffx-num">{search.collections}</span> {search.collections === 1 ? "collection" : "collections"} ·{" "}
            <b>
              <span className="ffx-num">{search.items}</span> {search.items === 1 ? "item" : "items"}
            </b>{" "}
            match &ldquo;{search.q}&rdquo;{search.pending && <span className="sx-search-wait">, still looking</span>}
          </p>
        )}
        {/* The review states with their counts: the legend for the open
            row's mark, and a filter. */}
        {areas.length > 0 && (
          <div className="sx-rail-states" role="group" aria-label="Filter by review state">
            {STATE_ORDER.map((st) => (
              <button
                key={st}
                type="button"
                className="sx-state-btn"
                aria-pressed={filter === st}
                onClick={() => onFilter(filter === st ? null : st)}
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
            <button type="button" onClick={() => onFilter(null)}>
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
        {groups.length === 0 && !search && <li className="sx-empty">{areas.length ? "No collections match." : emptyText}</li>}
        {groups.map((g) => (
          <li key={g.key} className="sx-group">
            <div className="sx-group-head">
              <h3>{g.label}</h3>
              <span className="ffx-num">{g.rows.length}</span>
            </div>
            <ul>
              {g.rows.map((a) => {
                const found = search ? itemMatches.get(a.slug) : undefined;
                const open = selected === a.slug || !!found;
                return (
                  <AreaRow
                    key={a.slug}
                    env={env}
                    area={a}
                    showKind={groupBy === "review"}
                    active={(selected ?? hovered) === a.slug}
                    previewing={preview === a.slug}
                    open={open}
                    rows={open ? (rowsBySlug[a.slug] ?? null) : null}
                    found={found ?? null}
                    query={found ? search?.q ?? null : null}
                    activeIds={selected === a.slug ? activeIds : undefined}
                    onHover={onHover}
                    onSelect={onSelect}
                    onOpen={() => onOpen(a.href)}
                  />
                );
              })}
            </ul>
          </li>
        ))}
        {search && search.hidden && (
          <li className="sx-rail-fold">
            {groups.length ? "No other collections or items match." : "No collections or items match."}{" "}
            <button type="button" onClick={() => onQuery("")}>
              Clear search
            </button>
          </li>
        )}
      </ul>
    </aside>
  );
}

function AreaRow({
  env,
  area,
  showKind,
  active,
  previewing,
  open,
  rows,
  found,
  query,
  activeIds,
  onHover,
  onSelect,
  onOpen,
}: {
  env: EnvKey;
  area: HomeArea;
  showKind: boolean;
  active: boolean;
  previewing: boolean;
  open: boolean;
  rows: Rows;
  /** The items the search matched in this collection, when it did. */
  found: ItemRow[] | null;
  query: string | null;
  activeIds?: ReadonlySet<string>;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
  onOpen: () => void;
}) {
  return (
    <li className="sx-rail-item" data-active={active} data-open={open} data-preview={previewing || undefined} data-slug={area.slug}>
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
        <span className="sx-row-main">
          <span className="sx-row-title">{area.name}</span>
          <AreaSub area={area} showKind={showKind} version={open} />
        </span>
        <span className="sx-row-aside">
          <span className="ffx-num">{fmtNum(area.itemCount)}</span>
          {open && (
            <svg className="sx-row-caret" viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true">
              <path d="M8 5 3 11h10z" />
            </svg>
          )}
        </span>
        {/* Out of the row's flow, at the end of its second line, so the
            word never moves the name or changes the row's height. */}
        {previewing && <span className="sx-row-previewing">previewing</span>}
      </button>
      {open && <OpenRow env={env} area={area} rows={found ?? rows} total={area.itemCount} query={query} activeIds={activeIds} />}
    </li>
  );
}
