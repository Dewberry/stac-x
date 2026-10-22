"use client";

import { useDeferredValue, useState, type ReactNode } from "react";
import { Chevron } from "./icons";

export type AssetRowData = {
  key: string;
  file: string;
  what: string;
  size: string | null;
  /** Lowercased name, title and format, for the filter. */
  search: string;
  /** A button at the row's right that works without opening it (Preview, on a parquet asset). */
  action?: ReactNode;
  body: ReactNode;
};

export type AssetGroupData = {
  id: string;
  label: string;
  description: string;
  formats: string[];
  open: boolean;
  rows: AssetRowData[];
};

/**
 * The asset groups and the filter above them. Typing hides the groups with
 * nothing that matches and opens the ones that do; clearing it puts every
 * group back the way it was left.
 */
export function AssetGroups({ groups }: { groups: AssetGroupData[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.map((g) => [g.id, g.open])));
  const q = useDeferredValue(query.trim().toLowerCase());
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="sx-agroups">
      {total > 6 && (
        <div className="sx-agroups-bar">
          <label className="sx-afilter">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Filter assets</span>
            <input type="search" placeholder="Filter by name or format" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {groups.length > 1 && <span className="sx-agroups-by">Grouped by role</span>}
        </div>
      )}
      {groups.map((g) => {
        const rows = q ? g.rows.filter((r) => r.search.includes(q)) : g.rows;
        if (!rows.length) return null;
        const isOpen = q ? true : open[g.id];
        return (
          <div key={g.id} className="sx-agroup">
            <button
              type="button"
              className="sx-agroup-head"
              aria-expanded={isOpen}
              onClick={() => setOpen({ ...open, [g.id]: !open[g.id] })}
            >
              <Chevron />
              <span className="sx-agroup-name">
                <b>{g.label}</b> <span>{g.description}</span>
              </span>
              <span className="sx-agroup-meta">
                {g.formats.map((f) => (
                  <span key={f} className="sx-tag">
                    {f}
                  </span>
                ))}
                <span className="ffx-num sx-agroup-count">{rows.length}</span>
              </span>
            </button>
            {isOpen && (
              <div className="sx-arows">
                {rows.map((r) => (
                  <details key={r.key} className="sx-arow">
                    <summary>
                      <Chevron />
                      <span className="sx-arow-file">{r.file}</span>
                      <span className="sx-arow-what">{r.what}</span>
                      <span className="sx-arow-size ffx-num">{r.size ?? ""}</span>
                      {r.action && (
                        // A click here is the button's, not the row's: it mustn't open or close it.
                        <span
                          className="sx-arow-act"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          {r.action}
                        </span>
                      )}
                    </summary>
                    <div className="sx-asset-body">{r.body}</div>
                  </details>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {q && groups.every((g) => !g.rows.some((r) => r.search.includes(q))) && <p className="sx-empty">No assets match.</p>}
    </div>
  );
}
