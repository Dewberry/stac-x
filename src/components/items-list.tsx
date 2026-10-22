"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fmtRange } from "@/lib/format";
import type { EnvKey } from "@/lib/env";
import { itemHref } from "@/lib/utils";
import { useItemHover } from "./item-hover";
import { Icon, ICONS } from "./icons";

/**
 * The items of a collection: a search box, a sort, and the rows. On the
 * collection page the rows carry id and dates and come in pages. In the
 * home rail (`compact`) each row is the item's name alone, on one line
 * with a chevron, in a block that scrolls inside the rail with a note
 * under it saying how many more are below. There's no sort, since with
 * names alone there's nothing to sort by eye, and no search box either
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
  /** Which blue the item's shape is drawn in on the map, when there are few enough shapes to color. */
  tint?: 1 | 2 | 3;
  start: string | null;
  end: string | null;
};

// A dozen rows keeps a page short. The search box is how you find one gage
// in 192, not scrolling.
const PAGE = 12;
/** How many rows the rail's block shows before it scrolls; a search box is only worth having past that. */
const WINDOW = 5;

type Sort = "id" | "label" | "start";

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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("id");
  const [page, setPage] = useState(0);
  const q = useDeferredValue(query.trim().toLowerCase());
  // Shared with the page's map: pointing at a row lights up its shape.
  const { hovered, setHovered } = useItemHover();

  const filtered = useMemo(() => {
    let out = rows;
    if (q) out = out.filter((r) => r.id.toLowerCase().includes(q) || r.label?.toLowerCase().includes(q));
    const key = (r: ItemRow) =>
      sort === "label" ? (r.label ?? r.id) : sort === "start" ? (r.start ?? "") : r.id;
    return [...out].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
  }, [rows, q, sort]);

  const all = rows.length;
  // Where every row is already in view, there's nothing to search for.
  const searchable = !compact || all > WINDOW;
  const pages = compact ? 1 : Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = compact ? filtered : filtered.slice(current * PAGE, current * PAGE + PAGE);

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
        <label className="ffx-field min-w-0 flex-1 sm:max-w-xs">
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
        {/* The rail's rows show names alone, so there's nothing there to sort by eye; the collection page keeps the sort. */}
        {!compact && (
          <label className="ffx-field ffx-field-select">
            <span className="ffx-field-label">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="id">Id</option>
              <option value="label">Name</option>
              <option value="start">Start date</option>
            </select>
          </label>
        )}
        {!compact && filtered.length !== rows.length && (
          <span className="ml-auto text-micro text-ink-mut ffx-num">
            {filtered.length} of {rows.length}
          </span>
        )}
      </div>
      )}
      {slice.length === 0 ? (
        <p className="sx-empty">No items match.</p>
      ) : compact ? (
        <div className="sx-item-block" data-more={more || undefined}>
          <div ref={blockRef} className="sx-item-list" onScroll={onScroll}>
            {slice.map((r) => (
              <Link key={r.id} className="sx-item" {...rowProps(r)}>
                {r.tint && <i className="sx-swatch" data-step={r.tint} aria-hidden="true" />}
                <span className="sx-item-name">{mark(r.label ?? r.id, q)}</span>
                {r.kind && (
                  <span className="sx-tag" data-tone="muted">
                    {r.kind}
                  </span>
                )}
                <Icon d={ICONS.chevronRight} size={12} />
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="sx-rows">
          {slice.map((r) => (
            <Link key={r.id} className="sx-row" {...rowProps(r)}>
              <div className="sx-row-main">
                <div className="sx-row-title">
                  {r.tint && <i className="sx-swatch" data-step={r.tint} aria-hidden="true" />}
                  {r.label ?? r.id}
                </div>
                <div className="sx-row-sub">
                  {r.kind && (
                    <span className="sx-tag" data-tone="muted">
                      {r.kind}
                    </span>
                  )}
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
              <button type="button" onClick={() => setQuery("")}>
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
      {pages > 1 && (
        <div className="sx-pager">
          <span className="ffx-num">
            Page {current + 1} of {pages}
          </span>
          <span className="flex gap-1.5">
            <button type="button" className="ffx-btn ffx-btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <button
              type="button"
              className="ffx-btn ffx-btn-sm"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
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
  if (!q) return text;
  const at = text.toLowerCase().indexOf(q);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}
