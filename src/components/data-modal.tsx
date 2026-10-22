"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CopyButton } from "./copy-button";
import { DataTable } from "./data-table";
import { Icon, ICONS } from "./icons";
import { JsonTree } from "./json-tree";
import { Loading, Spinner } from "./spinner";
import type { Preview } from "@/lib/data-preview";
import { fmtBytes, fmtNum } from "@/lib/format";

/** Rows on open, and rows after "Show more". The routes cap at the latter. */
const FIRST = 20;
const MORE = 100;

/**
 * A button that opens a look inside a file in a dialog over the page: the
 * first rows of a parquet, CSV or row-shaped JSON file as a table, or any
 * other JSON as a tree. The dialog is wide, since a table is, and a table
 * loads a short first look (20 rows) with one step up to 100. That's a
 * look at the data, not a way to browse all of it: the file is the thing
 * to download for that.
 *
 * `url` is a preview route for the file (mode "preview", the default),
 * which gets a limit added, or a route that returns the JSON itself (mode
 * "json"), for the collection and item documents. `actions` go in the head
 * beside Close (Download, Copy URI, the raw JSON).
 */
export function PreviewButton({
  url,
  file,
  mode = "preview",
  actions,
  icon = ICONS.table,
  className = "ffx-btn ffx-btn-sm",
  children = "Preview",
}: {
  url: string;
  file: string;
  mode?: "preview" | "json";
  actions?: ReactNode;
  icon?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const title = mode === "json" ? `Read ${file} here` : `Preview the first rows of ${file}`;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title={title}>
        <Icon d={icon} size={12} /> {children}
      </button>
      {open && <DataDialog url={url} file={file} mode={mode} actions={actions} onClose={() => setOpen(false)} />}
    </>
  );
}

type State =
  | { status: "loading" }
  | { status: "done"; data: Preview; limit: number }
  | { status: "error"; error: string };

function DataDialog({
  url,
  file,
  mode,
  actions,
  onClose,
}: {
  url: string;
  file: string;
  mode: "preview" | "json";
  actions?: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [limit, setLimit] = useState(FIRST);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const at = mode === "json" ? url : `${url}${url.includes("?") ? "&" : "?"}limit=${limit}`;
    // The rows already shown stay up while a longer read is on its way.
    fetch(at, { signal: ac.signal })
      .then(async (res) => {
        const text = await res.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          throw new Error(res.ok ? "it isn't valid JSON." : res.statusText);
        }
        if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
        const data: Preview = mode === "json" ? { kind: "json", value: body, byteLength: text.length } : (body as Preview);
        setState({ status: "done", data, limit });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", error: e.message });
      });
    return () => ac.abort();
  }, [url, mode, limit]);

  const d = state.status === "done" ? state.data : null;
  const fetching = state.status === "loading" || (state.status === "done" && state.limit !== limit);
  const table = d?.kind === "table" ? d : null;
  const doc = d?.kind === "json" ? d : null;
  const shown = table ? table.rows.length : 0;
  // With the count unknown (a CSV read from its head), a full page means there may be more.
  const more = table ? (table.totalRows === null ? shown >= limit : table.totalRows > shown) : false;
  const foot = table && (table.totalRows === null ? shown >= FIRST : table.totalRows > FIRST);

  return (
    <dialog
      ref={ref}
      className="sx-dm"
      aria-labelledby="dm-h"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself.
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="sx-dm-head">
        <div className="min-w-0">
          <h2 id="dm-h" className="sx-dm-title">
            {file}
          </h2>
          <p className="sx-dm-sub">
            {table ? (
              <>
                First <span className="ffx-num">{fmtNum(shown)}</span>
                {table.totalRows !== null && (
                  <>
                    {" "}
                    of <span className="ffx-num">{fmtNum(table.totalRows)}</span>
                  </>
                )}{" "}
                {shown === 1 && table.totalRows === 1 ? "row" : "rows"} · <span className="ffx-num">{fmtNum(table.columns.length)}</span>{" "}
                columns · {fmtBytes(table.byteLength)}
              </>
            ) : doc ? (
              <>
                {describe(doc.value)} · {fmtBytes(doc.byteLength)}
              </>
            ) : state.status === "error" ? (
              "Couldn't read the file."
            ) : (
              "Reading…"
            )}
          </p>
        </div>
        <div className="sx-dm-acts">
          {doc && <CopyButton text={JSON.stringify(doc.value, null, 2)} label="Copy JSON" />}
          {actions}
          <button type="button" className="sx-sheet-btn" aria-label="Close" onClick={() => ref.current?.close()}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div className="sx-dm-scroll">
        {state.status === "error" ? (
          <p className="sx-dm-note sx-form-error">Couldn&apos;t read the file: {state.error}</p>
        ) : table ? (
          table.totalRows === 0 || shown === 0 ? (
            <p className="sx-dm-note">The file has no rows.</p>
          ) : (
            <DataTable data={table} />
          )
        ) : doc ? (
          <JsonTree value={doc.value} />
        ) : (
          <Loading>{mode === "json" ? "Reading the document…" : "Reading the first rows…"}</Loading>
        )}
      </div>
      {foot && (
        <div className="sx-dm-foot">
          {more && limit < MORE ? (
            <button type="button" className="ffx-btn ffx-btn-sm" onClick={() => setLimit(MORE)} disabled={fetching}>
              {fetching ? (
                <>
                  <Spinner /> Reading…
                </>
              ) : (
                `Show ${MORE} rows`
              )}
            </button>
          ) : (
            <span className="sx-dm-note">{more ? "The rest is in the file. Download it to see every row." : "That's every row."}</span>
          )}
        </div>
      )}
    </dialog>
  );
}

/** "12 fields", "3 items", or the type of a scalar. */
function describe(v: unknown): string {
  if (Array.isArray(v)) return `${fmtNum(v.length)} ${v.length === 1 ? "item" : "items"}`;
  if (v && typeof v === "object") {
    const n = Object.keys(v).length;
    return `${fmtNum(n)} ${n === 1 ? "field" : "fields"}`;
  }
  return typeof v;
}
