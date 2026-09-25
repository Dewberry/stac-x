"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { QcChip } from "./qc-chip";
import { fmtRange } from "@/lib/format";
import { QC_STATUSES } from "@/lib/stac";
import { itemHref } from "@/lib/utils";

/**
 * The items of a collection: a search box, review-state tabs with counts, a
 * sort, and pages of rows. Filtering runs in the browser over a compact
 * summary of every item, which is fine into the tens of thousands; past that
 * the page should send a filtered slice and this component keeps its shape.
 */

export type ItemRow = {
  id: string;
  label: string | null;
  start: string | null;
  end: string | null;
  qc: string;
  dateApproved: string | null;
};

const PAGE = 50;

type Sort = "id" | "label" | "start" | "qc";

export function ItemsList({ collection, rows }: { collection: string; rows: ItemRow[] }) {
  const [query, setQuery] = useState("");
  const [qc, setQc] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("id");
  const [page, setPage] = useState(0);
  const q = useDeferredValue(query.trim().toLowerCase());

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.qc] = (c[r.qc] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (qc !== "all") out = out.filter((r) => r.qc === qc);
    if (q) out = out.filter((r) => r.id.toLowerCase().includes(q) || r.label?.toLowerCase().includes(q));
    const key = (r: ItemRow) =>
      sort === "label" ? (r.label ?? r.id) : sort === "start" ? (r.start ?? "") : sort === "qc" ? r.qc : r.id;
    return [...out].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
  }, [rows, qc, q, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = filtered.slice(current * PAGE, current * PAGE + PAGE);

  function pick(next: string) {
    setQc(next);
    setPage(0);
  }

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
            <option value="qc">QC status</option>
          </select>
        </label>
      </div>
      <div className="ffx-tabs">
        <div className="ffx-tabs-list" role="tablist" aria-label="Filter by QC status">
          <button type="button" role="tab" className="ffx-tab" aria-selected={qc === "all"} onClick={() => pick("all")}>
            All <span className="ffx-tab-count ffx-num">{counts.all}</span>
          </button>
          {QC_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="tab"
              className="ffx-tab"
              aria-selected={qc === s.value}
              onClick={() => pick(s.value)}
            >
              {s.label} <span className="ffx-tab-count ffx-num">{counts[s.value] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="ffx-tabs-aside ffx-num">
          {filtered.length === rows.length ? `${rows.length} items` : `${filtered.length} of ${rows.length}`}
        </div>
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
              <div className="sx-row-aside">
                {r.dateApproved && <span className="ffx-num hidden sm:inline">approved {r.dateApproved}</span>}
                <QcChip status={r.qc} />
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
