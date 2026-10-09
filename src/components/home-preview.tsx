"use client";

import Link from "next/link";
import { AREA_KIND_TIME } from "@/lib/kinds";
import { fmtNum, fmtYears } from "@/lib/format";
import { versionName } from "@/lib/versions";
import { QcChip } from "./qc-chip";
import { stateOf } from "./qc-mark";
import type { HomeArea } from "./home";

/**
 * What a selected collection shows: enough to decide whether to open it.
 * Its description, its counts and dates, where its QC stands, the last
 * reviewer's note when it was sent back, and the way in. On a wide screen
 * this opens inside the collection's row in the rail; on a phone it's a
 * sheet at the bottom of the map (HomePreview).
 */
export function PreviewBody({ area }: { area: HomeArea }) {
  const state = stateOf(area);
  const note = (state === "needs_revision" || state === "rejected") && area.qc?.note ? area.qc.note : null;
  return (
    <div className="sx-pv">
      {area.blurb && <p className="sx-pv-desc">{area.blurb}</p>}
      <div className="sx-pv-figs">
        <div>
          <b className="ffx-num">{fmtNum(area.itemCount)}</b>
          <span>items</span>
        </div>
        <div>
          <b className="ffx-num">{fmtYears(area.temporal) ?? "No dates"}</b>
          <span>{AREA_KIND_TIME[area.kind]}</span>
        </div>
      </div>
      {area.drawn === "basin" && <p className="sx-pv-cover">Covers the whole South Platte.</p>}
      <dl className="sx-pv-facts">
        <div>
          <dt>Quality control</dt>
          <dd>
            <QcChip status={state} />
            {area.qc?.date_approved && <span className="ffx-num">{area.qc.date_approved}</span>}
          </dd>
        </div>
        {area.version && (
          <div>
            <dt>Version</dt>
            <dd>
              <span className="text-ink">{versionName(area.version)}</span>
              {area.earlier ? (
                <span>
                  · {area.earlier} earlier {area.earlier === 1 ? "version" : "versions"}
                </span>
              ) : null}
            </dd>
          </div>
        )}
      </dl>
      {note && (
        <figure className="sx-pv-note">
          <figcaption>Last review note</figcaption>
          <blockquote>{note}</blockquote>
        </figure>
      )}
      <div className="sx-pv-btns">
        <a href={area.jsonHref} className="ffx-btn" target="_blank" rel="noreferrer">
          JSON
        </a>
        <Link href={area.href} className="ffx-btn ffx-btn-primary">
          Open collection →
        </Link>
      </div>
    </div>
  );
}

/** The phone's sheet over the map. Hidden on a wide screen, where the row opens instead. */
export function HomePreview({ area, onClose }: { area: HomeArea; onClose: () => void }) {
  return (
    <div className="sx-preview" role="dialog" aria-label={area.name}>
      <div className="sx-preview-top">
        <div className="sx-preview-title">{area.name}</div>
        <button type="button" className="sx-preview-x" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <PreviewBody area={area} />
    </div>
  );
}
