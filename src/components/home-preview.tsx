"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { EnvKey } from "@/lib/env";
import { fmtNum } from "@/lib/format";
import { versionName } from "@/lib/versions";
import type { HomeArea, Rows } from "./home";
import { ItemsList } from "./items-list";
import { QC_LABEL, QcMark, stateOf } from "./qc-mark";

/**
 * What a selected collection shows: enough to decide whether to open it,
 * and its items. Its description, where its QC stands, the last reviewer's
 * note when it was sent back, the way in (Browse collection), then the items
 * by name with a search and a sort. The summary line (dates, place,
 * version) sits above it, in the row on a wide screen and in the sheet's
 * header on a phone, so the body doesn't repeat it. On a wide screen this
 * opens inside the collection's row in the rail (OpenRow); on a phone it's
 * a sheet over the page (HomePreview).
 */

/** Where a collection's extent sits against the deployment's area. */
export const COVERAGE_LABEL: Record<NonNullable<HomeArea["coverage"]>, string> = {
  whole: "Whole area",
  part: "Part of the area",
  larger: "Larger than the area",
};

/**
 * The line under a collection's name in the rail: its review state once
 * someone has decided it, the years it covers, where it is against the
 * area, and its version when there are earlier ones (an open row has that
 * in its facts instead). Each part shows only when it says something, so a
 * row can be just "Whole area".
 */
export function AreaSub({ area, open }: { area: HomeArea; open?: boolean }) {
  const state = stateOf(area);
  const parts: ReactNode[] = [];
  if (state !== "pending")
    parts.push(
      <span className="sx-row-qc" data-qc={state}>
        <QcMark state={state} />
        {QC_LABEL[state]}
      </span>,
    );
  if (area.years) parts.push(<span className="ffx-num">{area.years}</span>);
  if (area.coverage) parts.push(COVERAGE_LABEL[area.coverage]);
  return (
    <span className="sx-row-sub">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {p}
        </Fragment>
      ))}
      {!open && area.version && area.earlier ? <span className="sx-tag">{versionName(area.version)}</span> : null}
    </span>
  );
}

/**
 * The line under the name in the phone's sheet: the review state once it's
 * decided, where the collection is against the area, and its full dates,
 * since the sheet has the room the rail row doesn't.
 */
function SheetSub({ area }: { area: HomeArea }) {
  const state = stateOf(area);
  const dates = fmtSpan(area.temporal);
  const parts: ReactNode[] = [];
  if (state !== "pending")
    parts.push(
      <span className="sx-row-qc" data-qc={state}>
        <QcMark state={state} />
        {QC_LABEL[state]}
      </span>,
    );
  if (area.coverage) parts.push(COVERAGE_LABEL[area.coverage]);
  if (dates) parts.push(<span className="ffx-num">{dates}</span>);
  return (
    <span className="sx-row-sub">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {p}
        </Fragment>
      ))}
    </span>
  );
}

const UNIT_ONE: Record<HomeArea["unit"], string> = { points: "point", shapes: "shape", items: "item" };

/** How many items a collection has, as a figure and its noun: "450 points", "1 shape", "3 items". */
export function countOf(area: HomeArea): { n: string; noun: string } {
  return { n: fmtNum(area.itemCount), noun: area.itemCount === 1 ? UNIT_ONE[area.unit] : area.unit };
}

/** A small picture of the unit beside it: three dots for points, an outline for shapes, nothing for items. */
export function UnitGlyph({ unit }: { unit: HomeArea["unit"] }) {
  if (unit === "points")
    return (
      <svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor" aria-hidden="true">
        <circle cx="2.5" cy="3" r="1.6" />
        <circle cx="7.2" cy="2.4" r="1.6" />
        <circle cx="4.8" cy="7.4" r="1.6" />
      </svg>
    );
  if (unit === "shapes")
    return (
      <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
        <path d="M1.5 3.5 5 1.5l3.5 1.5-.5 5.5-5.5-.5z" />
      </svg>
    );
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A collection's extent as dates a person reads: "Aug 25 to 28, 2026",
 * "Mar 27, 1980 to Dec 20, 2025", or "Jan 1, 2026 to now" when it's open
 * at the end. In UTC, as the catalog writes them. Null with no extent.
 */
export function fmtSpan(t: HomeArea["temporal"]): string | null {
  const at = (v: string | null | undefined) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() } : null;
  };
  const s = at(t?.[0]);
  const e = at(t?.[1]);
  const day = (p: { m: number; d: number }) => `${MONTHS[p.m]} ${p.d}`;
  if (s && e) {
    if (s.y !== e.y) return `${day(s)}, ${s.y} to ${day(e)}, ${e.y}`;
    if (s.m !== e.m) return `${day(s)} to ${day(e)}, ${s.y}`;
    return s.d === e.d ? `${day(s)}, ${s.y}` : `${day(s)} to ${e.d}, ${s.y}`;
  }
  if (s) return `${day(s)}, ${s.y} to now`;
  if (e) return `Until ${day(e)}, ${e.y}`;
  return null;
}

type Fact = { label: string; value: ReactNode; wide?: boolean };

/**
 * What the open row says about a collection besides its description, each
 * only when the catalog has it. `brief` is the phone's sheet, whose header
 * already carries the dates: just the version and the id.
 */
function factsOf(area: HomeArea, brief?: boolean): Fact[] {
  const facts: Fact[] = [];
  if (area.version)
    facts.push({
      label: "Version",
      value: (
        <>
          <span className="ffx-id">{area.version}</span>
          {area.earlier ? <> · {fmtNum(area.earlier)} earlier</> : null}
        </>
      ),
    });
  const dates = fmtSpan(area.temporal);
  if (dates && !brief) facts.push({ label: "Dates", value: <span className="ffx-num">{dates}</span> });
  facts.push({ label: "Id", value: <span className="ffx-id">{area.id}</span> });
  if (brief) return facts;
  if (area.license) facts.push({ label: "License", value: area.license });
  const approved = area.qc?.date_approved;
  if (approved) facts.push({ label: "Approved on", value: <span className="ffx-num">{fmtSpan([approved, approved])}</span> });
  if (area.assetCount) facts.push({ label: "Assets", value: <span className="ffx-num">{fmtNum(area.assetCount)}</span> });
  if (area.providers.length) facts.push({ label: "Providers", value: area.providers.join(", "), wide: true });
  if (area.keywords.length) facts.push({ label: "Keywords", value: area.keywords.join(", "), wide: true });
  return facts;
}

/** The description, the facts, the QC line and the last note. `brief` is the phone's sheet, with the short facts. */
export function PreviewBody({ area, brief }: { area: HomeArea; brief?: boolean }) {
  const state = stateOf(area);
  const note = (state === "needs_revision" || state === "rejected") && area.qc?.note ? area.qc.note : null;
  const facts = factsOf(area, brief);
  return (
    <div className="sx-pv">
      {area.blurb && <p className="sx-pv-desc">{area.blurb}</p>}
      <dl className="sx-pv-grid">
        {facts.map((f) => (
          <div key={f.label} data-wide={f.wide || undefined}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="sx-pv-facts">
        <dl>
          <div>
            <dt>Quality control</dt>
            <dd>
              <QcMark state={state} />
              {QC_LABEL[state]}
            </dd>
          </div>
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
      <Link href={area.href} className="ffx-btn sx-pv-go">
        Browse collection
      </Link>
    </div>
  );
}

/** The collection's items, or where they are while they load. */
function Items({
  env,
  area,
  rows,
  activeIds,
  fill,
}: {
  env: EnvKey;
  area: HomeArea;
  rows: Rows;
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
    <ItemsList env={env} collection={area.id} rows={rows} compact fill={fill} openHref={area.href} activeIds={activeIds} />
  );
}

/** The open row in the rail, under its head. */
export function OpenRow({
  env,
  area,
  rows,
  activeIds,
}: {
  env: EnvKey;
  area: HomeArea;
  rows: Rows;
  activeIds?: ReadonlySet<string>;
}) {
  return (
    <div className="sx-row-more">
      <PreviewBody area={area} />
      <WayIn area={area} />
      <Items env={env} area={area} rows={rows} activeIds={activeIds} />
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
  activeIds,
  onClose,
}: {
  env: EnvKey;
  area: HomeArea;
  rows: Rows;
  activeIds?: ReadonlySet<string>;
  onClose: () => void;
}) {
  const count = countOf(area);
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
  // The sheet covers the rail, so focus goes to its heading when it opens
  // or changes collection. It's only shown on a narrow screen.
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!matchMedia("(min-width: 64rem)").matches) headRef.current?.focus({ preventScroll: true });
  }, [area.slug]);
  return (
    <section className="sx-preview" role="dialog" aria-label={area.name} data-full={full || undefined}>
      <button
        type="button"
        className="sx-preview-handle"
        aria-label={full ? "Shrink" : "Expand"}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        // Enter and Space on the handle (detail 0) grow or shrink the sheet; a pointer is handled above.
        onClick={(e) => {
          if (e.detail === 0) setFull((v) => !v);
        }}
      >
        <i aria-hidden="true" />
      </button>
      <div className="sx-preview-top">
        <div className="sx-preview-head">
          <h2 ref={headRef} tabIndex={-1} className="sx-preview-title">
            {area.name}
          </h2>
          <SheetSub area={area} />
          <div className="sx-pv-figs">
            <b className="ffx-num">{count.n}</b>
            <span>
              <UnitGlyph unit={area.unit} />
              {count.noun}
            </span>
          </div>
        </div>
        <button type="button" className="sx-preview-x" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="sx-preview-body">
        <PreviewBody area={area} brief />
        <WayIn area={area} />
      </div>
      <Items env={env} area={area} rows={rows} activeIds={activeIds} fill />
    </section>
  );
}
