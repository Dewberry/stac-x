"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { fmtRange } from "@/lib/format";
import { itemHref } from "@/lib/utils";

/**
 * The items of a collection: a search box, a sort, and pages of rows. Filtering runs in the browser over a compact
 * summary of every item, which is fine into the tens of thousands; past that
 * the page should send a filtered slice and this component keeps its shape.
 */

export type ItemRow = {
  id: string;
  label: string | null;
  start: string | null;
  end: string | null;
};

// A dozen rows keeps a page short. The search box is how you find one gage
// in 192, not scrolling.
const PAGE = 12;

type Sort = "id" | "label" | "start";

export function ItemsList({ collection, rows }: { collection: string; rows: ItemRow[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("id");
  const [page, setPage] = useState(0);
  const q = useDeferredValue(query.trim().toLowerCase());

  const filtered = useMemo(() => {
    let out = rows;
    if (q) out = out.filter((r) => r.id.toLowerCase().includes(q) || r.label?.toLowerCase().includes(q));
    const key = (r: ItemRow) =>
      sort === "label" ? (r.label ?? r.id) : sort === "start" ? (r.start ?? "") : r.id;
    return [...out].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
  }, [rows, q, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = filtered.slice(current * PAGE, current * PAGE + PAGE);

  return (
    <div>
      <div className="ffx-toolbar">
        <label className="ffx-field min-w-0 flex-1 sm:max-w-xs">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Search items</span>
          <input
            type="search"
            placeholder="Search id or name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="ffx-field ffx-field-select">
          <span className="ffx-field-label">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="id">Id</option>
            <option value="label">Name</option>
            <option value="start">Start date</option>
          </select>
        </label>
        {filtered.length !== rows.length && (
          <span className="ml-auto text-micro text-ink-mut ffx-num">
            {filtered.length} of {rows.length}
          </span>
        )}
      </div>
      {slice.length === 0 ? (
        <p className="sx-empty">No items match.</p>
      ) : (
        <div className="sx-rows">
          {slice.map((r) => (
            <Link key={r.id} href={itemHref(collection, r.id)} className="sx-row">
              <div className="sx-row-main">
                <div className="sx-row-title">{r.label ?? r.id}</div>
                <div className="sx-row-sub">
                  {r.label && <span className="ffx-id">{r.id}</span>}
                  {(r.start || r.end) && <span className="ffx-num">{fmtRange(r.start, r.end)}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
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
