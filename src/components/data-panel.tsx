"use client";

import { useEffect, useState } from "react";
import { DataTable } from "./data-table";
import { Loading } from "./spinner";
import type { TablePreview } from "@/lib/data-preview";
import { fmtBytes, fmtNum } from "@/lib/format";

type Data = TablePreview & { source: string };

/**
 * The first rows of the collection's own file (the stac-geoparquet it was
 * read from), on the collection page: a quick look at the columns the
 * pipeline wrote, one row per item. Five rows, enough to see the shape of
 * the data without a table taking over the page. Loaded as soon as the
 * page is, so it's there without a click. The Open button in the panel's
 * head (components/data-modal.tsx) shows more of the same file in a dialog.
 */
export function DataPanel({ href, limit = 5 }: { href: string; limit?: number }) {
  const [state, setState] = useState<{ status: "loading" | "done" | "error"; data?: Data; error?: string }>({ status: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${href}?limit=${limit}`, { signal: ac.signal })
      .then(async (res) => {
        // A failure isn't always JSON (a gateway's error page, a 500 with
        // no body), and parsing that first hid the real reason behind a
        // parse error. The status decides; the body only adds the reason.
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? (res.statusText || `the server answered ${res.status}.`));
        if (!body) throw new Error("the answer wasn't valid JSON.");
        setState({ status: "done", data: body as Data });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", error: e.message });
      });
    return () => ac.abort();
  }, [href, limit]);

  if (state.status === "loading") return <Loading>Reading the first rows…</Loading>;
  if (state.status === "error") return <p className="sx-data-note sx-form-error">Couldn&apos;t read the file: {state.error}</p>;

  const d = state.data!;
  return (
    <>
      <p className="sx-data-note">
        First <span className="ffx-num">{fmtNum(d.rows.length)}</span> of <span className="ffx-num">{fmtNum(d.totalRows ?? d.rows.length)}</span> rows
        of <span className="ffx-id">{d.source}</span>, {fmtBytes(d.byteLength)}.
      </p>
      <div className="ffx-data-pane sx-data-pane">
        <DataTable data={d} limit={limit} />
      </div>
    </>
  );
}
