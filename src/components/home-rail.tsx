"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { EnvKey } from "@/lib/env";
import { fmtNum } from "@/lib/format";
import type { QcStatus } from "@/lib/stac";
import type { HomeArea, Rows } from "./home";
import { AreaSub, countOf, OpenRow, UnitGlyph } from "./home-preview";
import { ScopeLink } from "./home-scope";
import { Chevron, FolderGlyph, Icon, ICONS } from "./icons";
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
 * A search lists what matches in two parts: the datasets, each with the
 * catalogs it sits in, and then the catalogs, one row per name, since a
 * name like Archive can be a folder in seven places. Neither part brings
 * along what's inside a match. The line under the box says plainly when
 * nothing reviewable matched.
 *
 * With a catalog open (?in=, home-scope.tsx) the head is that catalog's:
 * the way back, its name and description, and how many datasets and empty
 * catalogs are in it. Its datasets are the rows, under the catalogs inside
 * it that hold them, and its empty catalogs fold under one heading at the
 * end. Opening or leaving a catalog moves focus to the rail's title and
 * says what's showing.
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
  /** Matching datasets, before the review filter. */
  datasets: number;
};

/**
 * Catalogs that match a search and share a name, each with the catalogs it
 * sits in, top first: all of them, and those below the opened catalog.
 */
export type CatalogHit = { name: string; places: { area: HomeArea; path: string[]; within: string[] }[] };

const WIDE_SCREEN = "(min-width: 64rem)";

const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`;

/** How many empty catalogs the fold shows before "Show all". */
const FOLD_FIRST = 6;

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/** A small count as a word, for a sentence: "seven places". */
const word = (n: number) => WORDS[n] ?? fmtNum(n);
/** "A", "A and B", "A, B and C". */
const listOf = (parts: string[]) => parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

/** Whether a catalog has anything in it yet, for its row. */
const catalogNote = (a: HomeArea) => a.datasetsBelow ? plural(a.datasetsBelow, "dataset", "datasets") : "Nothing in it yet";

/**
 * The line under the search box, and a note for the list when nothing that
 * can be reviewed matched: "No datasets match “archive”. 7 empty catalogs
 * are named Archive."
 */
function summaryOf(search: Search, hits: CatalogHit[], opened: HomeArea | null): { line: string; note: string | null } {
  const places = hits.flatMap((h) => h.places);
  const catalogs = places.length;
  const allEmpty = places.every((p) => !p.area.datasetsBelow);
  const noun = allEmpty ? (catalogs === 1 ? "empty catalog" : "empty catalogs") : catalogs === 1 ? "catalog" : "catalogs";
  const quoted = `“${search.q}”`;
  if (search.datasets && catalogs) {
    return { line: `${plural(search.datasets, "dataset", "datasets")} and ${fmtNum(catalogs)} ${noun} match ${quoted}.`, note: null };
  }
  if (search.datasets) return { line: `${plural(search.datasets, "dataset matches", "datasets match")} ${quoted}.`, note: null };
  if (!catalogs) return { line: `Nothing matches ${quoted}.`, note: null };
  const name = hits.length === 1 ? hits[0].name : null;
  const what = name
    ? `${fmtNum(catalogs)} ${noun} ${catalogs === 1 ? "is" : "are"} named ${name}.`
    : `${fmtNum(catalogs)} ${noun} ${catalogs === 1 ? "matches" : "match"}.`;
  let note: string | null = null;
  if (allEmpty) {
    const a = name && /^[aeiou]/i.test(name) ? "An" : "A";
    note = !name
      ? "Nothing to review here. None of these catalogs holds a dataset yet."
      : catalogs === 1
        ? `Nothing to review here. ${a} ${name} folder exists in one place in the tree, but it doesn't hold a dataset yet.`
        : `Nothing to review here. ${a} ${name} folder exists in ${word(catalogs)} places in ${opened ? opened.name : "the tree"}, but none of them holds a dataset yet.`;
  }
  return { line: `No datasets match ${quoted}. ${what}`, note };
}

/**
 * Where the catalogs that share a name sit, by the catalog they're under
 * one level down from where the rail is: "one under Conformance and two
 * under Production". Past three of those it's just how many.
 */
function whereEach(hit: CatalogHit, opened: HomeArea | null): string {
  const byTop = new Map<string, number>();
  for (const p of hit.places) byTop.set(p.within[0] ?? "", (byTop.get(p.within[0] ?? "") ?? 0) + 1);
  const tops = [...byTop].sort(([a], [b]) => a.localeCompare(b));
  const here = opened ? `directly in ${opened.name}` : "at the top level";
  const where = tops.length > 3
    ? `under ${word(tops.length)} ${opened ? "catalogs in it" : "top-level catalogs"}`
    : tops.length > 1 && tops.every(([top, n]) => top && n === 1)
      ? `one each under ${listOf(tops.map(([top]) => top))}`
      : listOf(tops.map(([top, n]) => (top ? `${word(n)} under ${top}` : `${word(n)} ${here}`)));
  return `${fmtNum(hit.places.length)} catalogs share this name, ${where}. Open to see where each sits.`;
}

/** The searched-for text underlined wherever it is in a name, in river blue. */
function Hit({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    out.push(text.slice(at, i), <mark key={i} className="sx-hit">{text.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

export function HomeRail({
  env,
  datasetCount,
  rootsWithData,
  allInCatalogs,
  emptyRoots,
  opened,
  openedParent,
  emptyInOpened,
  catalogsInside,
  trail,
  childCollections,
  total,
  paths,
  catalogHits,
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
  /** Every dataset sits in some catalog, so "in N catalogs" is the whole story. */
  allInCatalogs: boolean;
  /** Top-level catalogs with no dataset anywhere below them, by name. */
  emptyRoots: HomeArea[];
  /** The catalog open in the rail, if one is. */
  opened: HomeArea | null;
  /** The catalog it's in, for the way back; null at the top level. */
  openedParent: HomeArea | null;
  /** The empty catalogs directly inside the opened one, by name. */
  emptyInOpened: HomeArea[];
  /** How many catalogs are directly inside a catalog. */
  catalogsInside: (slug: string) => number;
  /** The catalogs the open dataset sits in, top first. */
  trail: HomeArea[];
  /** What's directly inside the open dataset. */
  childCollections: HomeArea[];
  /** Every dataset the rail is about: all of them, or the opened catalog's. */
  total: number;
  /** While searching, the catalogs each matching dataset sits in, top first. */
  paths: Record<string, string[]>;
  /** While searching, the matching catalogs, by name. */
  catalogHits: CatalogHit[];
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
  const summary = search ? summaryOf(search, catalogHits, opened) : null;
  const hitPlaces = catalogHits.reduce((n, h) => n + h.places.length, 0);
  const anything = datasetCount > 0 || emptyRoots.length > 0;

  // Opening or leaving a catalog replaces the whole rail, so focus goes to
  // its title and the list starts at its top, unless a dataset that's still
  // in view stays open. Not on the first render: a link to a catalog lands
  // there without taking focus from the page.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openedSlug = opened?.slug ?? null;
  const seenScope = useRef(openedSlug);
  useEffect(() => {
    if (seenScope.current === openedSlug) return;
    seenScope.current = openedSlug;
    titleRef.current?.focus();
    if (!selected && listRef.current) listRef.current.scrollTop = 0;
  }, [openedSlug, selected]);
  // Somewhere steady for focus when the control that had it goes.
  const focusSteady = (selector: string) => (document.querySelector<HTMLElement>(selector) ?? titleRef.current)?.focus();
  // The review states show where there are datasets to count.
  const statesShown = datasetCount > 0 && (!opened || opened.datasetsBelow > 0);

  // Scroll the list so the open row's head is in view, below its sticky
  // catalog heading. Done by hand rather than scrollIntoView, which would
  // scroll the page too.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!selected || !list || !matchMedia(WIDE_SCREEN).matches) return;
    const row = list.querySelector<HTMLElement>(`[data-slug="${CSS.escape(selected)}"] > .sx-row`);
    if (!row) return;
    const head = row.closest(".sx-group")?.querySelector<HTMLElement>(".sx-ghead, .sx-shead");
    const headH = head?.offsetHeight ?? 0;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const bottom = top + row.offsetHeight;
    if (top - headH < list.scrollTop) list.scrollTop = top - headH;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = Math.min(top - headH, bottom - list.clientHeight);
  }, [selected]);

  return (
    <aside id="dataset-list" className="sx-rail" aria-label="Datasets">
      <div className="sx-rail-head">
        {opened ? (
          <>
            <ScopeLink env={env} slug={openedParent?.slug ?? null} className="sx-rail-back">
              <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7.5 2.5 4 6l3.5 3.5" />
              </svg>
              {openedParent ? openedParent.name : "All datasets"}
            </ScopeLink>
            <div className="sx-rail-title">
              <h2 ref={titleRef} tabIndex={-1} className="sx-scope-title">
                <FolderGlyph />
                {opened.name}
              </h2>
              <span className="sx-kind">Catalog</span>
            </div>
            {opened.blurb && <ScopeDesc key={opened.slug} text={opened.blurb} />}
            <p className="sx-scope-counts">
              <b>{opened.datasetsBelow ? plural(opened.datasetsBelow, "dataset", "datasets") : "No datasets yet"}</b>
              {emptyInOpened.length > 0 && (
                <>
                  {" · "}
                  {emptyInOpened.length === 1
                    ? "1 catalog inside it with nothing in it yet"
                    : `${fmtNum(emptyInOpened.length)} catalogs inside it with nothing in them yet`}
                </>
              )}
            </p>
            <Link href={opened.href} className="sx-rail-page">
              Catalog page
              <Icon d={ICONS.chevronRight} size={12} />
            </Link>
          </>
        ) : (
          <div className="sx-rail-title">
            <h2 ref={titleRef} tabIndex={-1}>Datasets</h2>
            {/* How many datasets, and how many of them are showing while a filter or search hides some. */}
            <span className="sx-rail-count ffx-num">
              {shownCount === total ? fmtNum(total) : `${fmtNum(shownCount)} of ${fmtNum(total)}`}
            </span>
            {rootsWithData > 0 && allInCatalogs && !search && (
              <span className="sx-rail-in">in {plural(rootsWithData, "catalog", "catalogs")}</span>
            )}
          </div>
        )}
        {anything && (
          <label className="ffx-field">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <span className="sr-only">{opened ? `Search in ${opened.name}` : "Search datasets and catalogs"}</span>
            <input
              type="search"
              placeholder={opened ? `Search in ${opened.name}` : "Search datasets and catalogs"}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
            />
          </label>
        )}
        {/* What's showing, said when a catalog is opened or left. Its own
            region, so a search doesn't say it again. */}
        <p className="sr-only" role="status">
          {opened
            ? `Showing ${opened.name}, ${plural(opened.datasetsBelow, "dataset", "datasets")}`
            : `Showing all datasets, ${fmtNum(datasetCount)}`}
        </p>
        {/* Said once the search or filter changes. The lines below show the
            same, but a status region that mounts with its text is often missed. */}
        <p className="sr-only" role="status">
          {summary?.line ?? ""}
          {filter ? ` Showing ${QC_LABEL[filter]} only` : ""}
        </p>
        {summary && (
          <p className="sx-search-line" aria-hidden="true">
            {summary.line}
          </p>
        )}
        {/* The review states with their counts: the legend for the open
            row's mark, and a filter. Datasets only; catalogs aren't reviewed. */}
        {statesShown && (
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
        {filter && statesShown && (
          <p className="sx-filter-line">
            <span aria-hidden="true">
              Showing <b>{QC_LABEL[filter]}</b> only
            </span>
            <button
              type="button"
              onClick={() => {
                focusSteady(".sx-state-btn[aria-pressed=true]");
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
        {groups.length === 0 && !search && (!opened || (opened.datasetsBelow > 0 && filter)) && (
          <li className="sx-empty">{datasetCount ? "No datasets match." : emptyText}</li>
        )}
        {opened && !opened.datasetsBelow && !emptyInOpened.length && !search && <li className="sx-empty">Nothing in it yet.</li>}
        {/* Matches the review filter hides: say so, rather than an empty list under a line counting them. */}
        {search && filter && statesShown && shownCount === 0 && search.datasets > 0 && (
          <li className="sx-empty">No matching datasets are {QC_LABEL[filter]}.</li>
        )}
        {groups.map((g) => (
          <li key={g.key} className="sx-group">
            {search && (
              <h3 className="sx-shead">
                {g.rows.length === 1 ? "Dataset" : "Datasets"} · <span className="ffx-num">{fmtNum(g.rows.length)}</span>
              </h3>
            )}
            {g.catalog && (
              <h3 className="sx-ghead">
                <ScopeLink env={env} slug={g.catalog.slug}>
                  <FolderGlyph />
                  <span className="sx-ghead-name">{g.catalog.name}</span>
                  <span className="sx-ghead-count">{plural(g.rows.length, "dataset", "datasets")}</span>
                  <Icon d={ICONS.chevronRight} size={12} />
                </ScopeLink>
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
                    trail={open ? trail : []}
                    path={paths[a.slug]}
                    q={search?.q ?? ""}
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
        {opened && !search && emptyInOpened.length > 0 && (
          <EmptyFold key={opened.slug} env={env} opened={opened} catalogs={emptyInOpened} catalogsInside={catalogsInside} />
        )}
        {/* Top-level catalogs with nothing in them yet: named, not listed as rows or counted. */}
        {!opened && !search && emptyRoots.length > 0 && (
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
                  <ScopeLink env={env} slug={r.slug}>
                    <FolderGlyph />
                    {r.name}
                  </ScopeLink>
                </li>
              ))}
            </ul>
          </li>
        )}
        {search && catalogHits.length > 0 && (
          <li className="sx-group">
            <h3 className="sx-shead">
              {catalogHits.every((h) => h.places.every((p) => !p.area.datasetsBelow)) ? "Catalogs with nothing in them yet" : "Catalogs"}
              {" · "}
              <span className="ffx-num">{fmtNum(hitPlaces)}</span>
            </h3>
            <ul>
              {catalogHits.map((hit) => (
                <CatalogHitRow key={hit.name.toLowerCase()} env={env} hit={hit} q={search.q} opened={opened} />
              ))}
            </ul>
          </li>
        )}
        {summary?.note && <li className="sx-rail-fold">{summary.note}</li>}
        {search && (
          <li className="sx-rail-fold">
            <button
              type="button"
              onClick={() => {
                focusSteady(".sx-rail input[type=search]");
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

/**
 * Catalogs that matched a search under one name. One alone is a link to it
 * with where it sits; several are one row that opens to a line for each,
 * with its whole path, each a link that opens it in the rail.
 */
function CatalogHitRow({ env, hit, q, opened }: { env: EnvKey; hit: CatalogHit; q: string; opened: HomeArea | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (hit.places.length === 1) {
    const { area, path } = hit.places[0];
    return (
      <li>
        <ScopeLink env={env} slug={area.slug} className="sx-crow">
          <FolderGlyph />
          <span className="sx-crow-main">
            <span className="sx-crow-name">
              <Hit text={area.name} q={q} />
            </span>
            <span className="sx-crow-sub">{path.length ? path.join(" › ") : "Top-level catalog"}</span>
          </span>
          <span className="sx-crow-note">{catalogNote(area)}</span>
        </ScopeLink>
      </li>
    );
  }
  return (
    <li>
      <button type="button" className="sx-crow" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <FolderGlyph />
        <span className="sx-crow-main">
          <span className="sx-crow-name">
            <Hit text={hit.name} q={q} /> · <span className="ffx-num">{fmtNum(hit.places.length)}</span>
          </span>
          <span className="sx-crow-sub">{whereEach(hit, opened)}</span>
        </span>
        <Chevron />
      </button>
      <ul id={id} className="sx-cplaces" hidden={!open}>
        {hit.places.map(({ area, path }) => (
          <li key={area.slug}>
            <ScopeLink env={env} slug={area.slug} className="sx-erow">
              <FolderGlyph />
              <span className="sx-erow-name">
                {path.map((p, i) => (
                  <span key={i}>{p} › </span>
                ))}
                <b>{area.name}</b>
              </span>
              <span className="sx-erow-note">{catalogNote(area)}</span>
            </ScopeLink>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * The opened catalog's description. On a phone it's two lines until Read
 * more, which stays as Show less so focus has somewhere to be.
 */
function ScopeDesc({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  // Whether two lines cut it off, measured while it's folded.
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (!el.dataset.open) setCut(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const id = useId();
  return (
    <div className="sx-scope-desc">
      <p ref={ref} id={id} data-open={open || undefined}>
        {text}
      </p>
      {(cut || open) && (
        <button type="button" className="sx-readmore" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

/**
 * The opened catalog's empty catalogs, folded under one heading, open to
 * start. The first few show; Show all brings the rest in place and moves
 * focus to the first of them, since the button goes.
 */
function EmptyFold({
  env,
  opened,
  catalogs,
  catalogsInside,
}: {
  env: EnvKey;
  opened: HomeArea;
  catalogs: HomeArea[];
  catalogsInside: (slug: string) => number;
}) {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const revealed = useRef(false);
  useEffect(() => {
    if (!all || !revealed.current) return;
    revealed.current = false;
    listRef.current?.querySelectorAll("a")[FOLD_FIRST]?.focus();
  }, [all]);
  const rows = all ? catalogs : catalogs.slice(0, FOLD_FIRST);
  return (
    <li className="sx-empties">
      <h3>
        <button
          type="button"
          className="sx-ehead"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`Catalogs inside ${opened.name} with nothing in them yet, ${catalogs.length}`}
          onClick={() => setOpen(!open)}
        >
          <Chevron />
          Nothing in them yet · <span className="ffx-num">{fmtNum(catalogs.length)}</span>
        </button>
      </h3>
      <div id={listId} hidden={!open}>
        <ul ref={listRef}>
          {rows.map((c) => {
            const inside = catalogsInside(c.slug);
            return (
              <li key={c.slug}>
                <ScopeLink env={env} slug={c.slug} className="sx-erow">
                  <FolderGlyph />
                  <span className="sx-erow-name">{c.name}</span>
                  {inside > 0 && <span className="sx-erow-note">{plural(inside, "catalog inside", "catalogs inside")}</span>}
                </ScopeLink>
              </li>
            );
          })}
        </ul>
        {!all && catalogs.length > FOLD_FIRST && (
          <button
            type="button"
            className="sx-eshow"
            onClick={() => {
              revealed.current = true;
              setAll(true);
            }}
          >
            Show all {fmtNum(catalogs.length)}
          </button>
        )}
      </div>
    </li>
  );
}

function AreaRow({
  env,
  area,
  childCollections,
  trail,
  path,
  q,
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
  trail: HomeArea[];
  /** Where the dataset sits, shown only while searching. */
  path?: string[];
  /** The search, to underline in the name. */
  q: string;
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
          <span className="sx-row-title">
            <Hit text={area.name} q={q} />
          </span>
          <AreaSub area={area} open={open} path={path} />
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
      {open && <OpenRow env={env} area={area} trail={trail} childCollections={childCollections} preview={preview} onHover={onHover} rows={rows} activeIds={activeIds} />}
    </li>
  );
}
