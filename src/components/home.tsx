"use client";

import Link from "next/link";
import nextDynamic from "next/dynamic";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import { AREA_KIND_LABEL, type AreaKind } from "@/lib/fixtures/areas";
import { fmtNum, fmtRange } from "@/lib/format";

/**
 * The landing page, after Alaska Ground Watch: a hero row that runs the
 * full width (the question on the left, three figures on the right), then
 * one console card holding the list of model areas beside the map. One
 * shared hover joins the list and the pins, so pointing at a name finds its
 * mark and pointing at a mark finds its name.
 *
 * On a phone the hero stacks, the map becomes a card, and the list flows
 * under it. The map is first in the DOM because that is the phone's order;
 * on a wide screen the row is reversed so the rail sits on the left.
 */

const HomeMap = nextDynamic(() => import("./home-map").then((m) => m.HomeMap), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-inset" style={{ position: "absolute", inset: 0 }} />,
});

export type HomeArea = {
  slug: string;
  name: string;
  kind: AreaKind;
  basin: string;
  bbox: [number, number, number, number];
  live: boolean;
  href: string | null;
  itemCount: number | null;
  temporal: [string | null, string | null] | null;
  reviewed: number | null;
  blurb?: string;
  pin?: [number, number];
  anchor?: "left" | "right" | "top" | "bottom";
};

export function HomeConsole({
  areas,
  items,
  title,
  lead,
  totals,
}: {
  areas: HomeArea[];
  items: FeatureCollection;
  title: string;
  lead: string;
  totals: { live: number; items: number; reviewed: number };
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const shown = useMemo(
    () =>
      q
        ? areas.filter((a) => `${a.name} ${a.basin} ${AREA_KIND_LABEL[a.kind]}`.toLowerCase().includes(q))
        : areas,
    [areas, q],
  );

  return (
    <div className="sx-home">
      <section className="sx-hero">
        <div className="sx-hero-text">
          <p className="sx-eyebrow">FFRD · Colorado pilot</p>
          <h1 className="sx-hero-title">{title}</h1>
          <p className="sx-hero-lead">{lead}</p>
        </div>
        <dl className="sx-stats">
          <div className="sx-stat" data-tone="verified">
            <dd className="ffx-num">{totals.live}</dd>
            <dt>Published</dt>
          </div>
          <div className="sx-stat">
            <dd className="ffx-num">{fmtNum(totals.items)}</dd>
            <dt>Items</dt>
          </div>
          <div className="sx-stat">
            <dd className="ffx-num">{fmtNum(totals.reviewed)}</dd>
            <dt>Reviewed</dt>
          </div>
        </dl>
      </section>

      <div className="sx-console">
        <div className="sx-console-map">
          <HomeMap areas={areas} items={items} highlight={hovered} onHover={setHovered} />
        </div>
        <aside className="sx-rail" aria-label="Model areas">
          <div className="sx-rail-head">
            <div className="sx-rail-title">
              <h2>Model areas</h2>
              <span className="ffx-num">
                {totals.live} published · {areas.length} total
              </span>
            </div>
            <label className="ffx-field">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search model areas</span>
              <input
                type="search"
                placeholder="Search areas"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <ul className="sx-rail-list ffx-scroll">
            {shown.length === 0 && <li className="sx-empty">No areas match.</li>}
            {shown.map((a) => (
              <AreaRow key={a.slug} area={a} active={hovered === a.slug} onHover={setHovered} />
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function AreaRow({
  area,
  active,
  onHover,
}: {
  area: HomeArea;
  active: boolean;
  onHover: (slug: string | null) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    if (!window.matchMedia("(min-width: 64rem)").matches) return;
    ref.current.scrollIntoView({ block: "nearest" });
  }, [active]);

  const body = (
    <>
      <div className="sx-row-main">
        <div className="sx-row-title">{area.name}</div>
        <div className="sx-row-sub">
          <span>
            {AREA_KIND_LABEL[area.kind]} · {area.basin}
          </span>
          {area.live && area.temporal && (area.temporal[0] || area.temporal[1]) && (
            <span className="ffx-num">{fmtRange(area.temporal[0], area.temporal[1])}</span>
          )}
        </div>
      </div>
      <div className="sx-row-aside">
        {area.live ? <span className="ffx-num">{fmtNum(area.itemCount ?? 0)}</span> : <span>planned</span>}
      </div>
    </>
  );

  const hover = {
    onMouseEnter: () => onHover(area.slug),
    onMouseLeave: () => onHover(null),
    onFocus: () => onHover(area.slug),
    onBlur: () => onHover(null),
  };

  return (
    <li ref={ref} className="sx-rail-item" data-active={active} data-live={area.live}>
      {area.live && area.href ? (
        <Link href={area.href} className="sx-row" {...hover}>
          {body}
        </Link>
      ) : (
        <div className="sx-row" tabIndex={0} aria-disabled="true" {...hover}>
          {body}
        </div>
      )}
    </li>
  );
}
