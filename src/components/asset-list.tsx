"use client";

import { useDeferredValue, useState, type CSSProperties, type ReactNode } from "react";
import { Chevron } from "./icons";

export type AssetRowData = {
  key: string;
  file: string;
  roles: string[];
  size: string | null;
  /** Lowercased name, title, roles and format, for the filter. */
  search: string;
  /** A button at the row's right that works without opening it (Preview, on a parquet asset). */
  action?: ReactNode;
  body: ReactNode;
};

/** Rows on a page. A list a little over one page shows whole instead of leaving a stub of a second page. */
const PAGE = 10;
const UNPAGED = 15;
/** Roles shown on a closed row, with a count of the rest; the open row shows them all. */
const ROLES = 3;

/**
 * The asset rows, the filter above them and the pager below. The filter
 * looks through every asset, not only the page that's showing, and starts
 * the pages over at the first.
 */
export function AssetList({ rows: all }: { rows: AssetRowData[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const q = useDeferredValue(query.trim().toLowerCase());
  const rows = q ? all.filter((r) => r.search.includes(q)) : all;
  const paged = rows.length > UNPAGED;
  const pages = paged ? Math.ceil(rows.length / PAGE) : 1;
  const current = Math.min(page, pages - 1);
  const first = current * PAGE;
  const slice = paged ? rows.slice(first, first + PAGE) : rows;
  const range = `${first + 1} to ${first + slice.length} of ${rows.length}`;

  return (
    <div className="sx-alist">
      {all.length > 6 && (
        <div className="sx-alist-bar">
          <label className="sx-afilter">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Filter assets</span>
            <input
              type="search"
              placeholder="Filter by name, role or format"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {q && rows.length > 0 && (
            <span className="sx-alist-count ffx-num" aria-hidden="true">
              {rows.length} of {all.length}
            </span>
          )}
        </div>
      )}
      {/* Always here, so a new page or a narrower filter is spoken. */}
      <p className="sr-only" role="status">
        {!rows.length
          ? "No assets match."
          : `${q ? `${rows.length} of ${all.length} assets match. ` : ""}${paged ? `Showing ${q ? "" : "assets "}${range}.` : ""}`}
      </p>
      {/* A paged list keeps a full page's height, so the pager stays under the pointer on a short last page. */}
      <div className="sx-arows" data-paged={pages > 1 ? "" : undefined} style={{ "--sx-arow-page": PAGE } as CSSProperties}>
        {slice.map((r) => (
          // The row's button sits beside the <details>, drawn over the
          // end of its summary. Inside the summary it would be a
          // control within a control, and its dialog would inherit the
          // summary's click handling.
          <div key={r.key} className="sx-arow-wrap" data-act={r.action ? "" : undefined}>
            <details className="sx-arow">
              <summary>
                <Chevron />
                <span className="sx-arow-file">{r.file}</span>
                <span className="sx-arow-roles">
                  {r.roles.length > 0 && <span className="sr-only">Roles: </span>}
                  {r.roles.map((role, i) => (
                    <span key={role} className="sx-tag" data-tone="muted" data-extra={i >= ROLES ? "" : undefined}>
                      {role}
                    </span>
                  ))}
                  {r.roles.length > ROLES && (
                    <span className="sx-arow-more ffx-num">
                      +{r.roles.length - ROLES}
                      <span className="sr-only"> more</span>
                    </span>
                  )}
                </span>
                <span className="sx-arow-size ffx-num">{r.size ?? ""}</span>
              </summary>
              <div className="sx-asset-body">{r.body}</div>
            </details>
            {r.action && <div className="sx-arow-act">{r.action}</div>}
          </div>
        ))}
      </div>
      {!rows.length && <p className="sx-empty">No assets match.</p>}
      {pages > 1 && (
        <div className="sx-pager sx-alist-pager">
          <span className="ffx-num">
            {first + 1}–{first + slice.length} of {rows.length}
          </span>
          <span className="flex gap-1.5">
            {/* aria-disabled, not disabled, at either end: the button pressed
                to get there keeps focus instead of dropping it. */}
            <button
              type="button"
              className="ffx-btn ffx-btn-sm"
              aria-label="Previous assets"
              aria-disabled={current === 0 || undefined}
              onClick={() => current > 0 && setPage(current - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="ffx-btn ffx-btn-sm"
              aria-label="Next assets"
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
