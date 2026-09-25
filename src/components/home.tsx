"use client";

import Link from "next/link";
import nextDynamic from "next/dynamic";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import { AREA_KIND_LABEL, type AreaKind } from "@/lib/fixtures/areas";
import { fmtNum, fmtRange } from "@/lib/format";

/**
 * The landing page: the map is the page, and a panel floats over it with
 * the question, three figures, a search box and the list of model areas.
 * One shared hover joins the list and the pins, so pointing at a name finds
 * its mark and pointing at a mark finds its name.
 *
 * On a phone the map is a band at the top and the panel flows under it.
 */

const HomeMap = nextDynamic(() => import("./home-map").then((m) => m.HomeMap), {
  ssr: false,
  loading: () => <div className="sx-home-canvas animate-pulse bg-inset" style={{ position: "absolute", inset: 0 }} />,
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
    <div className="sx-stage">
      <div className="sx-stage-map">
        <HomeMap areas={areas} items={items} highlight={hovered} onHover={setHovered} />
      </div>
      <aside className="sx-panel" aria-label="Model areas">
        <div className="sx-panel-head">
          <h1 className="sx-panel-title">{title}</h1>
          <p className="sx-panel-lead">{lead}</p>
          <div className="sx-chips">
            <span className="sx-chip" data-tone="verified">
              <span className="ffx-num">{totals.live}</span> published
            </span>
            <span className="sx-chip">
              <span className="ffx-num">{fmtNum(totals.items)}</span> items
            </span>
            <span className="sx-chip">
              <span className="ffx-num">{fmtNum(totals.reviewed)}</span> reviewed
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
              placeholder="Search an area, a basin, a model type"
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
