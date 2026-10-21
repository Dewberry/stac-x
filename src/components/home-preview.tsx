"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { EnvKey } from "@/lib/env";
import { AREA_KIND_LABEL } from "@/lib/kinds";
import { fmtNum, fmtYears } from "@/lib/format";
import { versionName } from "@/lib/versions";
import type { HomeArea, Rows } from "./home";
import { ItemsList } from "./items-list";
import { QcChip } from "./qc-chip";
import { stateOf } from "./qc-mark";

/**
 * What a selected collection shows: enough to decide whether to open it,
 * and its items. Its description, where its QC stands, the last reviewer's
 * note when it was sent back, the way in (View collection), then the items
 * by name with a search and a sort. The summary line (kind, dates,
 * version) sits above it, in the row on a wide screen and in the sheet's
 * header on a phone, so the body doesn't repeat it. On a wide screen this
 * opens inside the collection's row in the rail (OpenRow); on a phone it's
 * a sheet over the page (HomePreview).
 */

/** The line under a collection's name: kind, dates, where it is, and its version chip when asked for. */
export function AreaSub({ area, showKind, version }: { area: HomeArea; showKind: boolean; version?: boolean }) {
  const meta = [
    showKind ? AREA_KIND_LABEL[area.kind] : null,
    fmtYears(area.temporal) ?? "No dates",
    area.wide ? "Whole area" : area.place,
  ].filter(Boolean);
  return (
    <span className="sx-row-sub">
      <span className="ffx-num">{meta.join(" · ")}</span>
      {version && area.version && <span className="sx-tag">{versionName(area.version)}</span>}
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

/** The description, the QC line and the last note; the count as a figure only where the row head doesn't carry it. */
export function PreviewBody({ area, figures }: { area: HomeArea; figures?: boolean }) {
  const state = stateOf(area);
  const note = (state === "needs_revision" || state === "rejected") && area.qc?.note ? area.qc.note : null;
  const count = countOf(area);
  return (
    <div className="sx-pv">
      {area.blurb && <p className="sx-pv-desc">{area.blurb}</p>}
      <div className="sx-pv-facts" data-figures={figures || undefined}>
        {figures && (
          <div className="sx-pv-figs">
            <b className="ffx-num">{count.n}</b>
            <span>{count.noun}</span>
          </div>
        )}
        <dl>
          <div>
            <dt>Quality control</dt>
            <dd>
              <QcChip status={state} />
              {area.qc?.date_approved && <span className="ffx-num">{area.qc.date_approved}</span>}
            </dd>
          </div>
          {!figures && area.earlier ? (
            <div>
              <dt>Earlier versions</dt>
              <dd>
                <span className="text-ink ffx-num">{fmtNum(area.earlier)}</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      {note && (
        <figure className="sx-pv-note">
          <figcaption>Last review note</figcaption>
          <blockquote>{note}</blockquote>
        </figure>
      )}
    </div>
  );
}

/** The one action, across the row: the collection page, where the JSON, the data and the full table are. */
function WayIn({ area }: { area: HomeArea }) {
  return (
    <div className="sx-pv-btns">
      <Link href={area.href} className="ffx-btn ffx-btn-primary sx-pv-go">
        View collection
      </Link>
    </div>
  );
}

/** The collection's items, or where they are while they load. */
function Items({
  env,
  area,
  rows,
  total,
  query,
  activeIds,
  fill,
}: {
  env: EnvKey;
  area: HomeArea;
  rows: Rows;
  total: number;
  query: string | null;
  activeIds?: ReadonlySet<string>;
  fill?: boolean;
}) {
  if (rows === null)
    return (
      <ul className="sx-loading-rows sx-loading-items" aria-label="Loading the items">
        {[58, 44, 66].map((w, i) => (
          <li key={i} style={{ "--w": `${w}%` } as React.CSSProperties}>
            <b />
          </li>
        ))}
      </ul>
    );
  if (rows === "error") return <p className="sx-pv-cover">The items couldn&apos;t be loaded. Open the collection to see them.</p>;
  return (
    <ItemsList env={env} collection={area.id} rows={rows} total={total} compact fill={fill} query={query} openHref={area.href} activeIds={activeIds} />
  );
}

/** The open row in the rail, under its head. */
export function OpenRow({
  env,
  area,
  rows,
  total,
  query,
  activeIds,
}: {
  env: EnvKey;
  area: HomeArea;
  rows: Rows;
  /** How many items the collection has, when `rows` is only the ones a search matched. */
  total: number;
  /** The search the rows were matched on, to mark in them. */
  query: string | null;
  activeIds?: ReadonlySet<string>;
}) {
  return (
    <div className="sx-row-more">
      <PreviewBody area={area} />
      <WayIn area={area} />
      <Items env={env} area={area} rows={rows} total={total} query={query} activeIds={activeIds} />
    </div>
  );
}

/** How far a drag on the handle has to go to count. */
const DRAG = 40;

/**
 * The phone's sheet over the page, with the same in it as the open row:
 * opens at two thirds of the window and is dragged up to the top by its
 * handle, or down to close. Hidden on a wide screen, where the row opens
 * instead.
 */
export function HomePreview({
  env,
  area,
  rows,
  query,
  activeIds,
  onClose,
}: {
  env: EnvKey;
  area: HomeArea;
  rows: Rows;
  query: string | null;
  activeIds?: ReadonlySet<string>;
  onClose: () => void;
}) {
  const [full, setFull] = useState(false);
  const drag = useRef<{ y: number; full: boolean; moved: boolean } | null>(null);
  // A new collection opens at the usual height.
  const [shownSlug, setShownSlug] = useState(area.slug);
  if (area.slug !== shownSlug) {
    setShownSlug(area.slug);
    setFull(false);
  }
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, full, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (dy < -DRAG) setFull(true);
    else if (dy > DRAG) {
      if (d.full) setFull(false);
      else onClose();
    } else setFull((v) => !v);
  };
  return (
    <section className="sx-preview" role="dialog" aria-label={area.name} data-full={full || undefined}>
      <button
        type="button"
        className="sx-preview-handle"
        aria-label={full ? "Shrink" : "Expand"}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      >
        <i aria-hidden="true" />
      </button>
      <div className="sx-preview-top">
        <div className="sx-preview-head">
          <div className="sx-preview-title">{area.name}</div>
          <AreaSub area={area} showKind version />
        </div>
        <button type="button" className="sx-preview-x" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="sx-preview-body">
        <PreviewBody area={area} figures />
        <WayIn area={area} />
      </div>
      <Items env={env} area={area} rows={rows} total={area.itemCount} query={query} activeIds={activeIds} fill />
    </section>
  );
}
