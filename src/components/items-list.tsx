"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { fmtRange } from "@/lib/format";
import { breakable } from "./breakable";
import type { EnvKey } from "@/lib/env";
import { itemHref } from "@/lib/utils";
import { useItemHover } from "./item-hover";
import { GeomGlyph, Icon, ICONS } from "./icons";

/**
 * The items of a collection: a search box, a sort, and the rows. On the
 * collection page the rows carry id and dates and come in pages. In the
 * home rail (`compact`) each row is the item's name alone, on one line
 * with a chevron, in a block that scrolls inside the rail with a note
 * under it saying how many more are below. Either way the rows start in
 * the catalog's own order, and each row opens with a mark for what the
 * item's geometry is. An item with none also says "No geometry", unless
 * no item in the collection has any, which is said once above the rows
 * instead of on every one. The rail has no sort, since with names alone
 * there's nothing to sort by eye, and no search box either
 * unless the collection has more rows than the block shows, since a list
 * that's all in view has nothing to search. The collection page is where
 * the full table is. Filtering runs in the browser over a compact summary
 * of every item, which is fine into the tens of thousands; past that the
 * page should send a filtered slice and this component keeps its shape.
 */

export type ItemRow = {
  id: string;
  label: string | null;
  /** The label already says the id ("Storm event 1"), so it isn't repeated under it. */
  hideId?: boolean;
  /** "HEC-HMS" or "HEC-RAS" in a calibration collection, where both models carry the basin's name. */
  kind?: string | null;
  /** What the item's geometry is; null when it has none. Left out when that isn't known. */
  geom?: "point" | "line" | "area" | "mixed" | null;
  /** Which blue the item's shape is drawn in on the map, when there are few enough shapes to color. */
  tint?: 1 | 2 | 3;
  start: string | null;
  end: string | null;
};

// A dozen rows keeps a page short. The search box is how you find one gage
// in 192, not scrolling.
const PAGE = 12;
/** What the pager's "Per page" offers; the first is where it starts. */
const SIZES = [PAGE, 24, 48, 96];
const SIZE_KEY = "sx-items-per-page";

// The choice is the reader's own, so it's kept in their browser and holds
// from one collection to the next. Storage can be blocked or empty; then the
// choice lasts for the visit, held here.
let sizeHeld: number | null = null;
const sizeListeners = new Set<() => void>();
function readSize(): number {
  if (sizeHeld !== null) return sizeHeld;
  try {
    const n = Number(window.localStorage.getItem(SIZE_KEY));
    return SIZES.includes(n) ? n : PAGE;
  } catch {
    return PAGE;
  }
}
function writeSize(n: number) {
  sizeHeld = n;
  try {
    window.localStorage.setItem(SIZE_KEY, String(n));
  } catch {
    // Kept for the visit instead.
  }
  sizeListeners.forEach((l) => l());
}
function watchSize(cb: () => void) {
  sizeListeners.add(cb);
  return () => {
    sizeListeners.delete(cb);
  };
}
/** How many rows the rail's block shows before it scrolls; a search box is only worth having past that. */
const WINDOW = 5;

// "catalog" is the order the catalog lists the items in, which is how they
// start. Whoever wrote the catalog may have put them in an order that means
// something, and sorting by id up front threw that away.
/** A geometry mark in words, for a screen reader. */
const GEOM_NAME = { point: "Point", line: "Line", area: "Polygon", mixed: "Mixed geometry" } as const;

type Sort = "catalog" | "id" | "label" | "start";
const isSort = (v: unknown): v is Sort => v === "catalog" || v === "id" || v === "label" || v === "start";

export function ItemsList({
  env,
  collection,
  rows,
  compact,
  fill,
  openHref,
  activeIds,
}: {
  env: EnvKey;
  collection: string;
  rows: ItemRow[];
  /** The rail's form: name-only rows in a scrolling block, no pages. */
  compact?: boolean;
  /** In the phone's sheet: the block takes the room left, instead of a bounded height. */
  fill?: boolean;
  /** The collection's page, where the full table is. */
  openHref?: string;
  /** Items lit up from elsewhere (a shape under the cursor on the home map), besides the one pointed at here. */
  activeIds?: ReadonlySet<string>;
}) {
  // On the collection page the search, sort and page live in the URL, so
  // Back from an item returns to the page of the list it was opened from,
  // and a link to "page 3, sorted by name" works. The rail's list is part of
  // the home page's own state and leaves the URL alone.
  const sp = useSearchParams();
  const [query, setQuery] = useState(() => (compact ? "" : sp.get("q") ?? ""));
  const [sort, setSort] = useState<Sort>(() => {
    const v = compact ? null : sp.get("sort");
    return isSort(v) ? v : "catalog";
  });
  const [page, setPage] = useState(() => (compact ? 0 : Math.max(0, (Number(sp.get("page")) || 1) - 1)));
  const q = useDeferredValue(query.trim().toLowerCase());
  // Shared with the page's map: pointing at a row lights up its shape.
  const { hovered, setHovered } = useItemHover();

  const filtered = useMemo(() => {
    let out = rows;
    if (q) out = out.filter((r) => r.id.toLowerCase().includes(q) || r.label?.toLowerCase().includes(q));
    if (sort === "catalog") return out;
    const key = (r: ItemRow) => (sort === "label" ? (r.label ?? r.id) : sort === "start" ? (r.start ?? "") : r.id);
    return [...out].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
  }, [rows, q, sort]);

  const all = rows.length;
  // Names more than one row shares ("Dam", 905 times): those rows say their
  // id in the rail instead, so they can be told apart. A name that already
  // carries its id ("Storm event 1") is never repeated.
  const repeated = useMemo(() => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const r of rows) if (r.label && !r.hideId) (seen.has(r.label) ? twice : seen).add(r.label);
    return twice;
  }, [rows]);
  // A row's React key. Ids should be unique in a collection, but a scraped
  // one can carry different items under one id (two models both called
  // BoxelderCreek), so a repeat gets a suffix. Keyed on the row itself, it
  // stays put through a search or a sort.
  const keys = useMemo(() => {
    const n = new Map<string, number>();
    return new Map(rows.map((r) => {
      const k = n.get(r.id) ?? 0;
      n.set(r.id, k + 1);
      return [r, k ? `${r.id}#${k}` : r.id];
    }));
  }, [rows]);
  // With no geometry anywhere in the collection, one line above the rows
  // says so, and the rows carry the mark without the words.
  const noneHave = all > 0 && rows.every((r) => r.geom === null);
  const geomMark = (r: ItemRow) => (r.geom === undefined ? null : <GeomGlyph kind={r.geom} step={r.tint} />);
  const geomWords = (r: ItemRow) =>
    r.geom === undefined ? null : r.geom === null ? (
      noneHave ? (
        <span className="sr-only">No geometry</span>
      ) : (
        <span className="sx-tag" data-tone="muted">
          No geometry
        </span>
      )
    ) : (
      <span className="sr-only">{GEOM_NAME[r.geom]}</span>
    );
  // Where every row is already in view, there's nothing to search for.
  const searchable = all > 0 && (!compact || all > WINDOW);
  // The server renders the first size; a kept choice takes over in the browser.
  const size = useSyncExternalStore(watchSize, readSize, () => PAGE);
  const pages = compact ? 1 : Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, pages - 1);
  const slice = compact ? filtered : filtered.slice(current * size, current * size + size);

  useEffect(() => {
    if (compact) return;
    const p = new URLSearchParams(window.location.search);
    const put = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k));
    put("q", q || null);
    put("sort", sort === "catalog" ? null : sort);
    put("page", current > 0 ? String(current + 1) : null);
    const s = p.toString();
    const url = `${window.location.pathname}${s ? `?${s}` : ""}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", url);
  }, [compact, q, sort, current]);

  // A new page, search or sort starts at the top of the full list's scroller.
  const rowsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (rowsRef.current) rowsRef.current.scrollTop = 0;
  }, [current, q, sort]);

  // In the rail: how many rows fit in the block, for the note under it, and
  // whether more are below the fold, for the fade.
  const blockRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(0);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = blockRef.current;
    if (!el || !compact) return;
    let n = 0;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      if (child.offsetTop + child.offsetHeight <= el.clientHeight + 1) n++;
    }
    setVisible(n);
    setMore(el.scrollHeight > el.clientHeight + el.scrollTop + 1);
  }, [compact, slice]);
  const onScroll = () => {
    const el = blockRef.current;
    if (el) setMore(el.scrollHeight > el.clientHeight + el.scrollTop + 1);
  };

  // An item pointed at on the map scrolls into view here, unless the
  // pointer is on this list, in which case it's the one that was pointed at.
  useEffect(() => {
    const el = blockRef.current;
    if (!el || !hovered || el.matches(":hover")) return;
    el.querySelector<HTMLElement>(`[data-id="${CSS.escape(hovered)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hovered]);

  const rowProps = (r: ItemRow) => ({
    href: itemHref(env, collection, r.id),
    "data-id": r.id,
    "data-active": hovered === r.id || activeIds?.has(r.id) || undefined,
    onMouseEnter: () => setHovered(r.id),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(r.id),
    onBlur: () => setHovered(null),
  });

  return (
    <div className={compact ? "sx-items-compact" : undefined} data-fill={fill || undefined}>
      {searchable && (
      <div className="ffx-toolbar">
        <label className="ffx-field min-w-0 flex-[1_1_12rem] sm:max-w-xs">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Search items</span>
          <input
            type="search"
            placeholder={compact ? `Search ${all.toLocaleString()} ${all === 1 ? "item" : "items"}` : "Search id or name"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        {!compact && filtered.length !== rows.length && (
          <span className="text-micro text-ink-mut ffx-num" aria-hidden="true">
            {filtered.length} of {rows.length}
          </span>
        )}
        {/* The rail's rows show names alone, so there's nothing there to sort by eye; the collection page keeps the sort. */}
        {!compact && (
          <label className="ffx-field ffx-field-select ml-auto">
            <span className="ffx-field-label">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="catalog">Catalog order</option>
              <option value="id">Id</option>
              <option value="label">Name</option>
              <option value="start">Start date</option>
            </select>
          </label>
        )}
        <span className="sr-only" role="status">
          {filtered.length !== rows.length ? `${filtered.length} of ${rows.length} items` : ""}
        </span>
      </div>
      )}
      {slice.length === 0 ? (
        <p className="sx-empty">{all === 0 ? "This collection has no items." : "No items match."}</p>
      ) : null}
      {noneHave && slice.length > 0 && <p className="sx-items-note">These items have no geometry, so none are on the map.</p>}
      {slice.length === 0 ? null : compact ? (
        <div className="sx-item-block" data-more={more || undefined}>
          <div ref={blockRef} className="sx-item-list" onScroll={onScroll}>
            {slice.map((r) => (
              <Link key={keys.get(r)} className="sx-item" {...rowProps(r)}>
                {geomMark(r) ?? (r.tint && <i className="sx-swatch" data-step={r.tint} aria-hidden="true" />)}
                {r.label && !repeated.has(r.label) ? (
                  <span className="sx-item-name">{mark(r.label, q)}</span>
                ) : (
                  <span className="sx-item-name ffx-id">{mark(r.id, q)}</span>
                )}
                {r.kind && (
                  <span className="sx-tag" data-tone="muted">
                    {r.kind}
                  </span>
                )}
                {geomWords(r)}
                <Icon d={ICONS.chevronRight} size={12} />
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div ref={rowsRef} className="sx-rows sx-items-rows ffx-scroll">
          {slice.map((r) => (
            <Link key={keys.get(r)} className="sx-row" {...rowProps(r)}>
              <div className="sx-row-main">
                <div className="sx-row-title">
                  {geomMark(r) ?? (r.tint && <i className="sx-swatch" data-step={r.tint} aria-hidden="true" />)}
                  {breakable(r.label ?? r.id)}
                </div>
                <div className="sx-row-sub">
                  {r.kind && (
                    <span className="sx-tag" data-tone="muted">
                      {r.kind}
                    </span>
                  )}
                  {geomWords(r)}
                  {r.label && !r.hideId && <span className="ffx-id">{r.id}</span>}
                  {(r.start || r.end) && <span className="ffx-num">{fmtRange(r.start, r.end)}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {compact && slice.length > 0 && (q || filtered.length > visible) && (
        <p className="sx-item-foot">
          {q ? (
            <>
              <span className="ffx-num">{filtered.length}</span> of <span className="ffx-num">{all.toLocaleString()}</span> items ·{" "}
              <button
                type="button"
                onClick={(e) => {
                  // This line goes once the search is cleared, so focus goes back to the search box.
                  e.currentTarget.closest(".sx-items-compact")?.querySelector<HTMLElement>("input[type=search]")?.focus();
                  setQuery("");
                }}
              >
                Show all
              </button>
            </>
          ) : (
            <>
              Scroll for <span className="ffx-num">{(filtered.length - visible).toLocaleString()}</span> more
              {openHref && (
                <>
                  {" "}
                  · <Link href={openHref}>Browse collection</Link> for the full table
                </>
              )}
            </>
          )}
        </p>
      )}
      {/* Shown whenever the smallest page wouldn't hold them all, so a larger
          choice that fits everything on one page can still be turned down. */}
      {!compact && filtered.length > SIZES[0] && (
        <div className="sx-pager">
          <span className="ffx-num">
            Page {current + 1} of {pages}
          </span>
          <label className="ffx-field ffx-field-select sx-pager-size">
            <span className="ffx-field-label">Per page</span>
            <select
              value={size}
              onChange={(e) => {
                const n = Number(e.target.value);
                // Stay on the page that holds the row now at the top.
                setPage(Math.floor((current * size) / n));
                writeSize(n);
              }}
            >
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="flex gap-1.5">
            {/* aria-disabled, not disabled, at either end: the button pressed
                to get there keeps focus instead of dropping it. */}
            <button
              type="button"
              className="ffx-btn ffx-btn-sm"
              aria-disabled={current === 0 || undefined}
              onClick={() => current > 0 && setPage(current - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="ffx-btn ffx-btn-sm"
              aria-disabled={current >= pages - 1 || undefined}
              onClick={() => current < pages - 1 && setPage(current + 1)}
            >
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/** The name with the search's text marked in it. */
function mark(text: string, q: string): ReactNode {
  if (!q) return breakable(text);
  const at = text.toLowerCase().indexOf(q);
  if (at < 0) return breakable(text);
  return (
    <>
      {breakable(text.slice(0, at))}
      <mark>{text.slice(at, at + q.length)}</mark>
      {breakable(text.slice(at + q.length))}
    </>
  );
}
