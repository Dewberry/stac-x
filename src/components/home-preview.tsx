"use client";

import Link from "next/link";
import { AREA_KIND_TIME } from "@/lib/kinds";
import { fmtNum, fmtYears } from "@/lib/format";
import { versionName } from "@/lib/versions";
import { QcChip } from "./qc-chip";
import { stateOf } from "./qc-mark";
import type { HomeArea, Member } from "./home";

/**
 * What a selected collection shows: enough to decide whether to open it.
 * Its description, its counts and dates, where its QC stands, the last
 * reviewer's note when it was sent back, and the way in. On a wide screen
 * this opens inside the collection's row in the rail; on a phone it's a
 * sheet at the bottom of the map (HomePreview).
 */
/** The members line: "2 models", "5 shapes", or "5 items on 2 shapes" when some share one. */
export function membersHead(area: HomeArea): string | null {
  const m = area.members;
  if (!m?.length) return null;
  const shapes = new Set(m.map((x) => x.key)).size;
  const noun = area.kind === "models" ? "model" : "shape";
  if (shapes === m.length) return `${fmtNum(m.length)} ${noun}${m.length === 1 ? "" : "s"}`;
  return `${fmtNum(m.length)} items on ${fmtNum(shapes)} ${noun}${shapes === 1 ? "" : "s"}`;
}

type HoverProps = {
  /** The shapes under the cursor, on the map or here; their rows light up. */
  hoverKeys: string[];
  onHoverKeys: (keys: string[]) => void;
};

/**
 * The items behind the footprint, when there are only a few: a calibration
 * collection's HMS and RAS models of one basin draw as one shape, and this
 * is where it says there are two. Pointing at a row lights its shape up on
 * the map, and pointing at the map lights up its row.
 */
function Members({ area, hoverKeys, onHoverKeys }: { area: HomeArea } & HoverProps) {
  const members = area.members;
  if (!members?.length) return null;
  const shared = new Map<string, number>();
  for (const m of members) shared.set(m.key, (shared.get(m.key) ?? 0) + 1);
  return (
    <div className="sx-pv-members">
      <div className="sx-pv-members-head">{membersHead(area)}</div>
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
      <Members area={area} hoverKeys={hoverKeys} onHoverKeys={onHoverKeys} />
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
export function HomePreview({ area, hoverKeys, onHoverKeys, onClose }: { area: HomeArea; onClose: () => void } & HoverProps) {
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
      <PreviewBody area={area} hoverKeys={hoverKeys} onHoverKeys={onHoverKeys} />
    </div>
  );
}
