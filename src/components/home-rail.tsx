"use client";

import { useLayoutEffect, useRef } from "react";
import type { EnvKey } from "@/lib/env";
import { fmtNum } from "@/lib/format";
import type { QcStatus } from "@/lib/stac";
import type { GroupBy, HomeArea, Rows } from "./home";
import { AreaSub, countOf, OpenRow, UnitGlyph } from "./home-preview";
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
 * The search box matches collections by title and description, not their
 * items. While it does, the groups with nothing in them fold into one line.
 */

/** One group of the rail's rows. Ungrouped, the rail is one group with no heading. */
export type Group = { key: string; label: string | null; rows: HomeArea[] };

/** What the search found, while there is one. */
export type Search = {
  q: string;
  /** Collections matched by title or description, under the review filter. */
  collections: number;
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
  /** Item ids whose shape is under the cursor on the map, for the rows to light up. */
  activeIds: ReadonlySet<string>;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
  onOpen: (href: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const shownCount = groups.reduce((n, g) => n + g.rows.length, 0);

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
          {/* How many collections, and how many of them are showing while a filter or search hides some. */}
          <span className="sx-rail-count ffx-num">
            {shownCount === areas.length ? fmtNum(areas.length) : `${fmtNum(shownCount)} of ${fmtNum(areas.length)}`}
          </span>
          {/* On, the rows group by review state; off, they're one list by name. */}
          <button
            type="button"
            className="sx-group-switch"
            aria-pressed={groupBy === "review"}
            onClick={() => onGroupBy(groupBy === "review" ? "none" : "review")}
          >
            <span className="sx-switch" aria-hidden="true" />
            Group by review
          </button>
        </div>
        {areas.length > 0 && (
          <label className="ffx-field">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Search collections</span>
            <input type="search" placeholder="Search collections" value={query} onChange={(e) => onQuery(e.target.value)} />
          </label>
        )}
        {search && (
          <p className="sx-search-line" role="status">
            <b>
              <span className="ffx-num">{search.collections}</span> {search.collections === 1 ? "collection matches" : "collections match"}
            </b>{" "}
            &ldquo;{search.q}&rdquo;
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
            {g.label && (
              <div className="sx-group-head">
                <h3>{g.label}</h3>
                <span className="ffx-num">{g.rows.length}</span>
              </div>
            )}
            <ul>
              {g.rows.map((a) => {
                const open = selected === a.slug;
                return (
                  <AreaRow
                    key={a.slug}
                    env={env}
                    area={a}
                    active={(selected ?? hovered) === a.slug}
                    previewing={preview === a.slug}
                    open={open}
                    rows={open ? (rowsBySlug[a.slug] ?? null) : null}
                    activeIds={open ? activeIds : undefined}
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
            {groups.length ? "No other collections match." : "No collections match."}{" "}
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
  active,
  previewing,
  open,
  rows,
  activeIds,
  onHover,
  onSelect,
  onOpen,
}: {
  env: EnvKey;
  area: HomeArea;
  active: boolean;
  previewing: boolean;
  open: boolean;
  rows: Rows;
  activeIds?: ReadonlySet<string>;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
  onOpen: () => void;
}) {
  const count = countOf(area);
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
          <AreaSub area={area} open={open} />
          {/* Over the end of the facts line, out of the flow, so the word
              never wraps the line or changes the row's height. */}
          {previewing && <span className="sx-row-previewing">previewing</span>}
        </span>
        <span className="sx-row-aside">
          <b className="sx-row-fig ffx-num">{count.n}</b>
          <span className="sx-row-unit">
            <UnitGlyph unit={area.unit} />
            {count.noun}
          </span>
        </span>
      </button>
      {open && <OpenRow env={env} area={area} rows={rows} activeIds={activeIds} />}
    </li>
  );
}
