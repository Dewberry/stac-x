"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import type { EnvKey } from "@/lib/env";
import { fmtNum } from "@/lib/format";
import type { QcStatus } from "@/lib/stac";
import { withEnvHome } from "@/lib/utils";
import type { HomeArea, Rows } from "./home";
import { AreaSub, countOf, OpenRow, UnitGlyph } from "./home-preview";
import { FolderGlyph, Icon, ICONS } from "./icons";
import type { ItemRow } from "./items-list";
import { QC_LABEL, QcMark, STATE_ORDER } from "./qc-mark";

/**
 * The dataset rail, the left side of the home console: its head (Datasets,
 * how many and in how many catalogs, the search box, the review states as
 * legend and filter) and the rows in groups. A row is a dataset: its name,
 * its count and one line of where and when. Rows sit under the top-level
 * catalog they're in, and each heading is a link that opens that catalog in
 * the rail. Top-level catalogs with nothing in them yet are named at the
 * foot of the list, not as rows.
 *
 * The selected row opens in place (OpenRow) with the dataset's
 * description, its review state, the way in and its items. Pointing at a
 * row previews its footprint on the map. Enter and Space open and close a
 * row like a click, as on any button; the open row's Browse collection goes
 * on to the dataset's page.
 */

/** One group of the rail's rows, under its top-level catalog, or under no heading for datasets at the top. */
export type Group = { key: string; catalog: { slug: string; name: string } | null; rows: HomeArea[] };

/** What the search found, while there is one. */
export type Search = {
  q: string;
  /** Matching datasets, under the review filter. */
  collections: number;
  /** Some datasets are out of the rail for not matching. */
  hidden: boolean;
};

const WIDE_SCREEN = "(min-width: 64rem)";

const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`;

/** The home page scoped to one catalog (see home.tsx). */
export function scopeHref(env: EnvKey, slug: string) {
  return `${withEnvHome(env)}?in=${encodeURIComponent(slug)}`;
}

export function HomeRail({
  env,
  datasetCount,
  rootsWithData,
  emptyRoots,
  childCollections,
  scopeCount,
  parentPaths,
  groups,
  byState,
  notice,
  emptyText,
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
}: {
  env: EnvKey;
  /** Every dataset in the environment. */
  datasetCount: number;
  /** Top-level catalogs with at least one dataset below them. */
  rootsWithData: number;
  /** Top-level catalogs with no dataset anywhere below them, by name. */
  emptyRoots: HomeArea[];
  /** What's directly inside the open dataset. */
  childCollections: HomeArea[];
  /** Every dataset by default; matching datasets during search. */
  scopeCount: number;
  parentPaths: Record<string, string[]>;
  groups: Group[];
  /** How many datasets are in each review state. */
  byState: Record<QcStatus, number>;
  /** A problem loading the catalog, shown at the top of the list. */
  notice?: string | null;
  /** What the rail says when the environment has no datasets. */
  emptyText: string;
  filter: QcStatus | null;
  onFilter: (v: QcStatus | null) => void;
  query: string;
  onQuery: (v: string) => void;
  search: Search | null;
  selected: string | null;
  hovered: string | null;
  /** The dataset whose footprint the map is previewing, if not the selected one. */
  preview: string | null;
  rowsBySlug: Record<string, ItemRow[] | "error">;
  /** Item ids whose shape is under the cursor on the map, for the rows to light up. */
  activeIds: ReadonlySet<string>;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const shownCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const anything = datasetCount > 0 || emptyRoots.length > 0;

  // Scroll the list so the open row's head is in view, below its sticky
  // catalog heading. Done by hand rather than scrollIntoView, which would
  // scroll the page too.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!selected || !list || !matchMedia(WIDE_SCREEN).matches) return;
    const row = list.querySelector<HTMLElement>(`[data-slug="${CSS.escape(selected)}"] > .sx-row`);
    if (!row) return;
    const head = row.closest(".sx-group")?.querySelector<HTMLElement>(".sx-ghead");
    const headH = head?.offsetHeight ?? 0;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const bottom = top + row.offsetHeight;
    if (top - headH < list.scrollTop) list.scrollTop = top - headH;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = Math.min(top - headH, bottom - list.clientHeight);
  }, [selected]);

  return (
    <aside id="dataset-list" className="sx-rail" aria-label="Datasets">
      <div className="sx-rail-head">
        <div className="sx-rail-title">
          <h2>Datasets</h2>
          {/* How many datasets, and how many of them are showing while a filter or search hides some. */}
          <span className="sx-rail-count ffx-num">
            {shownCount === scopeCount ? fmtNum(scopeCount) : `${fmtNum(shownCount)} of ${fmtNum(scopeCount)}`}
          </span>
          {rootsWithData > 0 && !search && (
            <span className="sx-rail-in">in {plural(rootsWithData, "catalog", "catalogs")}</span>
          )}
        </div>
        {anything && (
          <label className="ffx-field">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Search datasets and catalogs</span>
            <input type="search" placeholder="Search datasets and catalogs" value={query} onChange={(e) => onQuery(e.target.value)} />
          </label>
        )}
        {/* Said once the search or filter changes. The lines below show the
            same, but a status region that mounts with its text is often missed. */}
        <p className="sr-only" role="status">
          {search ? `${plural(search.collections, "dataset", "datasets")} found.` : ""}
          {filter ? ` Showing ${QC_LABEL[filter]} only` : ""}
        </p>
        {search && (
          <p className="sx-search-line" aria-hidden="true">
            <b>
              <span className="ffx-num">{search.collections}</span> {search.collections === 1 ? "dataset found" : "datasets found"}
            </b>{" "}
            &ldquo;{search.q}&rdquo;
          </p>
        )}
        {/* The review states with their counts: the legend for the open
            row's mark, and a filter. Datasets only; catalogs aren't reviewed. */}
        {datasetCount > 0 && (
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
          <p className="sx-filter-line">
            <span aria-hidden="true">
              Showing <b>{QC_LABEL[filter]}</b> only
            </span>
            <button
              type="button"
              onClick={() => {
                document.querySelector<HTMLElement>(".sx-state-btn[aria-pressed=true]")?.focus();
                onFilter(null);
              }}
            >
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
        {groups.length === 0 && !search && <li className="sx-empty">{datasetCount ? "No datasets match." : emptyText}</li>}
        {groups.map((g) => (
          <li key={g.key} className="sx-group">
            {g.catalog && (
              <h3 className="sx-ghead">
                <Link href={scopeHref(env, g.catalog.slug)}>
                  <FolderGlyph />
                  <span className="sx-ghead-name">{g.catalog.name}</span>
                  <span className="sx-ghead-count">{plural(g.rows.length, "dataset", "datasets")}</span>
                  <Icon d={ICONS.chevronRight} size={12} />
                </Link>
              </h3>
            )}
            <ul>
              {g.rows.map((a) => {
                const open = selected === a.slug;
                return (
                  <AreaRow
                    key={a.slug}
                    env={env}
                    area={a}
                    childCollections={open ? childCollections : []}
                    parentPaths={parentPaths[a.slug] ?? []}
                    active={(selected ?? hovered) === a.slug}
                    previewing={preview === a.slug}
                    preview={preview}
                    open={open}
                    rows={open ? (rowsBySlug[a.slug] ?? null) : null}
                    activeIds={open ? activeIds : undefined}
                    onHover={onHover}
                    onSelect={onSelect}
                  />
                );
              })}
            </ul>
          </li>
        ))}
        {/* Top-level catalogs with nothing in them yet: named, not listed as rows or counted. */}
        {!search && emptyRoots.length > 0 && (
          <li className="sx-empty-roots">
            <p>
              {plural(emptyRoots.length, "top-level catalog", "top-level catalogs")} with no datasets yet.{" "}
              {emptyRoots.length === 1
                ? "It holds folders only and will show up above once a dataset lands in it."
                : "They hold folders only and will show up above once a dataset lands in them."}
            </p>
            <ul>
              {emptyRoots.map((r) => (
                <li key={r.slug}>
                  <Link href={scopeHref(env, r.slug)}>
                    <FolderGlyph />
                    {r.name}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        )}
        {search && search.hidden && (
          <li className="sx-rail-fold">
            {groups.length ? "No other datasets match." : "No datasets match."}{" "}
            <button
              type="button"
              onClick={() => {
                document.querySelector<HTMLElement>(".sx-rail input[type=search]")?.focus();
                onQuery("");
              }}
            >
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
  childCollections,
  parentPaths,
  active,
  previewing,
  preview,
  open,
  rows,
  activeIds,
  onHover,
  onSelect,
}: {
  env: EnvKey;
  area: HomeArea;
  childCollections: HomeArea[];
  /** Where the dataset sits, shown only while searching. */
  parentPaths: string[];
  active: boolean;
  previewing: boolean;
  preview: string | null;
  open: boolean;
  rows: Rows;
  activeIds?: ReadonlySet<string>;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
}) {
  const count = countOf(area);
  return (
    <li className="sx-rail-item" data-active={active} data-open={open} data-preview={previewing || undefined} data-slug={area.slug}>
      <button
        type="button"
        className="sx-row"
        aria-expanded={open}
        onClick={() => onSelect(area.slug)}
        onMouseEnter={() => onHover(area.slug)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(area.slug)}
        onBlur={() => onHover(null)}
      >
        <span className="sx-row-main">
          <span className="sx-row-title">{area.name}</span>
          {parentPaths.map((path) => <span key={path} className="sx-row-parent">Under {path}</span>)}
          <AreaSub area={area} open={open} />
        </span>
        <span className="sx-row-aside">
          {/* An eye beside the count on the row the map is previewing. Its
              slot is always there, so showing it moves nothing. */}
          <span className="sx-row-eye" data-on={previewing || undefined}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
              <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
            {previewing && <span className="sr-only">Previewing on the map</span>}
          </span>
          <span className="sx-row-count">
            <b className="sx-row-fig ffx-num">{count.n}</b>
            <span className="sx-row-unit">
              <UnitGlyph unit={area.unit} />
              {count.noun}
            </span>
          </span>
        </span>
      </button>
      {open && <OpenRow env={env} area={area} childCollections={childCollections} preview={preview} onHover={onHover} rows={rows} activeIds={activeIds} />}
    </li>
  );
}
