"use client";

import { useEffect, useRef, useState } from "react";
import { Grid } from "./meta-table";
import { Icon, ICONS } from "./icons";
import { fmtBytes, fmtNum } from "@/lib/format";

/**
 * An image asset inline, with an honest fallback: the assets live in a
 * private bucket, so the image fails when the server has no credentials or
 * when the catalog points at a file that was never uploaded. Either way it
 * reads as a missing preview, not as a broken page.
 */
export function Thumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // The page is server rendered, so the image can fail before React attaches
  // onError. Check the element's own state once mounted.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) {
    return (
      <div className="sx-thumb-missing">
        {"Preview unavailable. The file isn't at this path in the bucket, or the server can't read it."}
      </div>
    );
  }
  // A plain img: the source is a redirect to a presigned URL of unknown size.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt={alt} className="sx-thumb" loading="lazy" onError={() => setFailed(true)} />;
}

type Preview = {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  byteLength: number;
};

/** The first rows of a parquet asset, on demand. */
export function AssetPreview({ href }: { href: string }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; data?: Preview; error?: string }>({
    status: "idle",
  });

  async function load() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/preview?href=${encodeURIComponent(href)}&limit=50`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setState({ status: "done", data: body as Preview });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (state.status === "idle" || state.status === "loading") {
    return (
      <button type="button" className="ffx-btn ffx-btn-sm" onClick={load} disabled={state.status === "loading"}>
        <Icon d={ICONS.table} size={12} /> {state.status === "loading" ? "Loading rows" : "Preview rows"}
      </button>
    );
  }
  if (state.status === "error") {
    return <span className="sx-form-error basis-full">Could not read the file: {state.error}</span>;
  }
  const d = state.data!;
  return (
    <div className="basis-full">
      <p className="mb-1.5 text-micro text-ink-mut">
        First <span className="ffx-num">{fmtNum(Math.min(50, d.totalRows))}</span> of{" "}
        <span className="ffx-num">{fmtNum(d.totalRows)}</span> rows, {fmtBytes(d.byteLength)}.
      </p>
      <div className="ffx-data-pane">
        <Grid rows={d.rows} />
      </div>
    </div>
  );
}
