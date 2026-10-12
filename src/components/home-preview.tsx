"use client";

import Link from "next/link";
import { AREA_KIND_LABEL } from "@/lib/kinds";
import { fmtNum, fmtYears } from "@/lib/format";
import { versionName } from "@/lib/versions";
import { QcChip } from "./qc-chip";
import { stateOf } from "./qc-mark";
import type { HomeArea, Member } from "./home";

/**
 * What a selected collection shows: enough to decide whether to open it.
 * Its description, what its items are, where its QC stands, the last
 * reviewer's note when it was sent back, and the way in. The summary line
 * (kind, dates, version) sits above it, in the row on a wide screen and in
 * the sheet's header on a phone, so the body doesn't repeat it. On a wide
 * screen this opens inside the collection's row in the rail; on a phone
 * it's a sheet at the bottom of the map (HomePreview).
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

/** The same as one string, for the note under the map. */
export function membersHead(area: HomeArea): string | null {
  if (!area.members?.length) return null;
  const { n, noun } = countOf(area);
  return `${n} ${noun}`;
}

type HoverProps = {
  /** The shapes under the cursor, on the map or here; their rows light up. */
  hoverKeys: string[];
  onHoverKeys: (keys: string[]) => void;
};

/**
 * The items behind the footprint, when there are only a few: a calibration
 * collection's HMS and RAS models of one basin draw as one shape, and this
 * is where it lists both. The count tile above is its heading. Pointing at
 * a row lights its shape up on the map, and pointing at the map lights up
 * its row.
 */
function Members({ area, hoverKeys, onHoverKeys }: { area: HomeArea } & HoverProps) {
  const members = area.members;
  if (!members?.length) return null;
  const shared = new Map<string, number>();
  for (const m of members) shared.set(m.key, (shared.get(m.key) ?? 0) + 1);
  return (
    <div className="sx-pv-members">
      <ul>
        {members.map((m: Member) => (
          <li
            key={m.id}
            className="sx-pv-member"
            data-active={hoverKeys.includes(m.key) || undefined}
            onMouseEnter={() => onHoverKeys([m.key])}
            onMouseLeave={() => onHoverKeys([])}
          >
            {m.tint && <i className="sx-swatch" data-step={m.tint} aria-hidden="true" />}
            {m.kind && (
              <span className="sx-tag" data-tone="muted">
                {m.kind}
              </span>
            )}
            <span className="sx-pv-member-name">{m.label}</span>
            {!m.hideId && <span className="ffx-id">{m.id}</span>}
            {(shared.get(m.key) ?? 0) > 1 && <span className="sx-pv-member-note">same footprint</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PreviewBody({ area, hoverKeys, onHoverKeys }: { area: HomeArea } & HoverProps) {
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
      <Members area={area} hoverKeys={hoverKeys} onHoverKeys={onHoverKeys} />
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
export function HomePreview({ area, hoverKeys, onHoverKeys, onClose }: { area: HomeArea; onClose: () => void } & HoverProps) {
  return (
    <div className="sx-preview" role="dialog" aria-label={area.name}>
      <div className="sx-preview-top">
        <div className="sx-preview-head">
          <div className="sx-preview-title">{area.name}</div>
          <AreaSub area={area} showKind />
        </div>
        <button type="button" className="sx-preview-x" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <PreviewBody area={area} hoverKeys={hoverKeys} onHoverKeys={onHoverKeys} />
    </div>
  );
}
