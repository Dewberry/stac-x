"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fmtBytes, fmtNum, humanize } from "@/lib/format";

/**
 * The first rows of the collection's own file (the stac-geoparquet it was
 * read from), on the collection page: a quick look at the columns the
 * pipeline wrote, one row per item. Five rows, enough to see the shape of
 * the data without a table taking over the page. Loaded as soon as the
 * page is, so it's there without a click.
 *
 * The columns that name a row (id, title, dates) come first; the ones that
 * hold a structure (the geometry, the assets, the links) go last and sit
 * folded, each cell saying what's in it, since a page of WKB bytes and
 * nested JSON says nothing at a glance. Open one to see it.
 */

type Preview = {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  byteLength: number;
  source: string;
};

/** The columns worth reading first, in this order; a name column of any spelling goes second. */
const FIRST = ["id", "title", "name", "label", "datetime", "start_datetime", "end_datetime"];
const NAME = /name|title|label/i;
/** Columns that are always a structure, however they're serialized. */
const FOLDED = new Set(["geometry", "bbox", "assets", "links", "stac_extensions"]);

export function DataPanel({ href, limit = 5 }: { href: string; limit?: number }) {
  const [state, setState] = useState<{ status: "loading" | "done" | "error"; data?: Preview; error?: string }>({ status: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${href}?limit=${limit}`, { signal: ac.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        setState({ status: "done", data: body as Preview });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", error: e.message });
      });
    return () => ac.abort();
  }, [href, limit]);

  if (state.status === "loading")
    return (
      <p className="sx-data-note" role="status">
        Reading the first rows…
      </p>
    );
  if (state.status === "error") return <p className="sx-data-note sx-form-error">Couldn&apos;t read the file: {state.error}</p>;

  const d = state.data!;
  const isFolded = (c: string) => FOLDED.has(c) || d.rows.some((r) => r[c] !== null && typeof r[c] === "object");
  const rest = d.columns.filter((c) => !FIRST.includes(c));
  const named = rest.filter((c) => NAME.test(c) && !isFolded(c));
  const cols = [
    ...FIRST.filter((c) => d.columns.includes(c)),
    ...named,
    ...rest.filter((c) => !named.includes(c) && !isFolded(c)),
    ...rest.filter(isFolded),
  ];

  return (
    <>
      <p className="sx-data-note">
        First <span className="ffx-num">{fmtNum(Math.min(limit, d.totalRows))}</span> of <span className="ffx-num">{fmtNum(d.totalRows)}</span> rows
        of <span className="ffx-id">{d.source}</span>, {fmtBytes(d.byteLength)}.
      </p>
      <div className="ffx-data-pane sx-data-pane">
        <table className="ffx-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{humanize(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <Cell key={c} name={c} value={r[c]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Cell({ name, value }: { name: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return <td className="sx-data-empty" />;
  if (typeof value === "number") return <td className="ffx-r ffx-num">{fmtNum(value, 4)}</td>;
  if (typeof value !== "object") return <td className={name === "id" ? "ffx-id" : undefined}>{String(value)}</td>;
  return (
    <td>
      <Fold name={name} value={value} />
    </td>
  );
}

/** A structure in a cell: what it holds, and its JSON on request. */
function Fold({ name, value }: { name: string; value: object }) {
  const [open, setOpen] = useState(false);
  let what: ReactNode;
  if (Array.isArray(value)) {
    const bytes = name === "geometry" && value.every((x) => typeof x === "number");
    what = bytes ? `binary, ${fmtNum(value.length)} bytes` : `${fmtNum(value.length)} ${value.length === 1 ? "item" : "items"}`;
  } else {
    const n = Object.keys(value).length;
    what = `${fmtNum(n)} ${n === 1 ? "field" : "fields"}`;
  }
  const text = JSON.stringify(value, null, 1);
  return (
    <>
      <button type="button" className="sx-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {"{…}"} {what}
      </button>
      {open && <pre className="sx-fold-body">{text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text}</pre>}
    </>
  );
}
