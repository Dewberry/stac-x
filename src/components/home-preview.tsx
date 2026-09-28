"use client";

import Link from "next/link";
import { AREA_KIND_LABEL } from "@/lib/fixtures/areas";
import { basinName } from "@/lib/basins";
import { fmtNum } from "@/lib/format";
import { QcChip } from "./qc-chip";
import type { HomeArea } from "./home";

/**
 * The card that opens over the map when a collection is selected. It says
 * enough to decide whether to open the collection: what it is, its basin,
 * its counts and dates, and where its QC stands. "Open
 * collection" is the only way into a collection from the landing page.
 * On a phone it sits at the bottom of the map as a sheet.
 */
/** "1900–2026" from a temporal extent; one year when both ends match. */
function years(t: HomeArea["temporal"]): string {
  if (!t) return "n/a";
  const a = t[0]?.slice(0, 4);
  const b = t[1]?.slice(0, 4);
  if (a && b) return a === b ? a : `${a}–${b}`;
  return a ?? b ?? "n/a";
}

export function HomePreview({
  area,
  onClose,
}: {
  area: HomeArea;
  onClose: () => void;
}) {
  const total = area.itemCount ?? 0;
  return (
    <div className="sx-preview" role="dialog" aria-label={area.name}>
      <div className="sx-preview-head">
        <div className="sx-preview-top">
          {area.live ? (
            <span className="sx-chip" data-tone="verified">Published</span>
          ) : (
            <span className="sx-chip">In progress</span>
          )}
          <button type="button" className="sx-preview-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="sx-preview-title">{area.name}</div>
        <div className="sx-preview-basin">
          <i aria-hidden="true" data-live={area.live} />
          {basinName(area.huc4)} basin · HUC {area.huc4} · {AREA_KIND_LABEL[area.kind]}
        </div>
        <p className="sx-preview-sub">
          {area.blurb ?? (area.live ? "" : "This collection is in progress and hasn't been published yet.")}
        </p>
      </div>
      {area.live && (
        <>
          <div className="sx-preview-figs">
            <div>
              <b className="ffx-num">{fmtNum(total)}</b>
              <span>items</span>
            </div>
            <div>
              <b className="ffx-num">{years(area.temporal)}</b>
              <span>period of record</span>
            </div>
          </div>
          <div className="sx-preview-rev">
            <span className="sx-preview-l">Quality control</span>
            <span className="sx-preview-qc">
              <QcChip status={area.qc?.qc} />
              {area.qc?.date_approved && <span className="ffx-num">{area.qc.date_approved}</span>}
            </span>
          </div>
        </>
      )}
      <div className="sx-preview-btns">
        {area.live && area.jsonHref && (
          <a href={area.jsonHref} className="ffx-btn" target="_blank" rel="noreferrer">
            JSON
          </a>
        )}
        {area.live && area.href ? (
          <Link href={area.href} className="ffx-btn ffx-btn-primary">
            Open collection →
          </Link>
        ) : (
          <button type="button" className="ffx-btn ffx-btn-primary" disabled>
            Not available yet
          </button>
        )}
      </div>
    </div>
  );
}
