"use client";

import { AREA_KIND_LABEL } from "@/lib/kinds";
import { fmtNum, fmtYears } from "@/lib/format";
import { versionName } from "@/lib/versions";
import { QcChip } from "./qc-chip";
import { stateOf } from "./qc-mark";
import type { HomeArea } from "./home";

/**
 * What a selected collection shows above its items: its description, how
 * many things it is, where its QC stands, and the last reviewer's note when
 * it was sent back. The summary line (kind, dates, version) sits above it,
 * in the row in the rail and at the top of the collection card, so the body
 * doesn't repeat it. The way in (JSON, Open collection) is in the
 * collection header.
 */

/** The line under a collection's name: kind, dates, whole-basin note, and its version chip. */
export function AreaSub({ area, showKind }: { area: HomeArea; showKind: boolean }) {
  const meta = [
    showKind ? AREA_KIND_LABEL[area.kind] : null,
    fmtYears(area.temporal) ?? "No dates",
    area.wide ? "Whole basin" : null,
  ].filter(Boolean);
  return (
    <span className="sx-row-sub">
      <span className="ffx-num">{meta.join(" · ")}</span>
      {area.version && <span className="sx-tag">{versionName(area.version)}</span>}
    </span>
  );
}

/**
 * How many things a collection is, as a number and its noun: "2 models",
 * "5 shapes", "5 items on 2 shapes" when some share one, or "300 items" when
 * there's no member list.
 */
export function countOf(area: HomeArea): { n: string; noun: string } {
  const m = area.members;
  if (!m?.length) return { n: fmtNum(area.itemCount), noun: area.itemCount === 1 ? "item" : "items" };
  const shapes = new Set(m.map((x) => x.key)).size;
  const noun = area.kind === "models" ? "model" : "shape";
  if (shapes === m.length) return { n: fmtNum(m.length), noun: `${noun}${m.length === 1 ? "" : "s"}` };
  return { n: fmtNum(m.length), noun: `items on ${fmtNum(shapes)} ${noun}${shapes === 1 ? "" : "s"}` };
}

export function PreviewBody({ area }: { area: HomeArea }) {
  const state = stateOf(area);
  const note = (state === "needs_revision" || state === "rejected") && area.qc?.note ? area.qc.note : null;
  const count = countOf(area);
  return (
    <div className="sx-pv">
      {area.blurb && <p className="sx-pv-desc">{area.blurb}</p>}
      <div className="sx-pv-figs">
        <div>
          <b className="ffx-num">{count.n}</b>
          <span>{count.noun}</span>
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
        {area.earlier ? (
          <div>
            <dt>Earlier versions</dt>
            <dd>
              <span className="text-ink ffx-num">{fmtNum(area.earlier)}</span>
            </dd>
          </div>
        ) : null}
      </dl>
      {note && (
        <figure className="sx-pv-note">
          <figcaption>Last review note</figcaption>
          <blockquote>{note}</blockquote>
        </figure>
      )}
    </div>
  );
}
