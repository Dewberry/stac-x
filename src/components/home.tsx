"use client";

import nextDynamic from "next/dynamic";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import { AREA_KIND_LABEL, type AreaKind } from "@/lib/fixtures/areas";
import { basinName } from "@/lib/basins";
import { fmtNum, fmtRange } from "@/lib/format";
import { HomePreview } from "./home-preview";
import type { BasinState } from "./home-map";

/**
 * The landing page, after Alaska Ground Watch: a hero row that runs the
 * full width (the question on the left, three figures on the right), then
 * one console card holding the list of collections beside the map. One
 * shared hover joins the list and the pins, so pointing at a name finds its
 * mark and pointing at a mark finds its name. Clicking either selects the
 * collection, which opens a preview card over the map; the card is the way
 * in. The rail groups collections by USGS basin, with a flat list one click
 * away, and clicking a basin on the map zooms to it and scrolls the rail.
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
  huc4: string;
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
  const [selected, setSelected] = useState<string | null>(null);
  const [basin, setBasin] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(true);
  const [focus, setFocus] = useState<{ bbox: [number, number, number, number]; key: number } | null>(null);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const shown = useMemo(
    () =>
      q
        ? areas.filter((a) => `${a.name} ${a.basin} ${basinName(a.huc4)} ${AREA_KIND_LABEL[a.kind]}`.toLowerCase().includes(q))
        : areas,
    [areas, q],
  );
  const bySlug = useMemo(() => new Map(areas.map((a) => [a.slug, a])), [areas]);
  const current = selected ? bySlug.get(selected) ?? null : null;

  // Which basins carry work, for the map tint. Published wins over planned.
  const basinState = useMemo<BasinState>(() => {
    const out: BasinState = {};
    for (const a of areas) {
      if (a.live) out[a.huc4] = "live";
      else if (!out[a.huc4]) out[a.huc4] = "planned";
    }
    return out;
  }, [areas]);

  // Rail groups: basins in the order of most published, then most planned.
  const groups = useMemo(() => {
    const m = new Map<string, HomeArea[]>();
    for (const a of shown) (m.get(a.huc4) ?? m.set(a.huc4, []).get(a.huc4)!).push(a);
    return Array.from(m.entries())
      .map(([huc4, list]) => ({
        huc4,
        name: basinName(huc4),
        live: list.filter((a) => a.live).length,
        planned: list.filter((a) => !a.live).length,
        list,
      }))
      .sort((x, y) => y.live - x.live || y.planned - x.planned || x.name.localeCompare(y.name));
  }, [shown]);

  const select = useCallback(
    (slug: string | null) => {
      setSelected(slug);
      const a = slug ? bySlug.get(slug) : null;
      if (!a) return;
      // Selecting a collection zooms to it, the same as selecting a basin.
      setBasin(a.huc4);
      setFocus({ bbox: a.bbox, key: Date.now() });
    },
    [bySlug],
  );

  const selectBasin = useCallback(
    (huc4: string) => {
      setBasin(huc4);
      setSelected(null);
      // Zoom to the union of the basin's areas, which is what the catalog has there.
      const list = areas.filter((a) => a.huc4 === huc4);
      if (list.length) {
        const bbox: [number, number, number, number] = [
          Math.min(...list.map((a) => a.bbox[0])),
          Math.min(...list.map((a) => a.bbox[1])),
          Math.max(...list.map((a) => a.bbox[2])),
          Math.max(...list.map((a) => a.bbox[3])),
        ];
        setFocus({ bbox, key: Date.now() });
      }
      // Scroll the rail, not the page: the hero above must stay put.
      const el = document.getElementById(`basin-${huc4}`);
      const rail = el?.closest(".sx-rail-list");
      if (el && rail instanceof HTMLElement) rail.scrollTo({ top: el.offsetTop - rail.offsetTop, behavior: "smooth" });
    },
    [areas],
  );

  const highlightedBasin = basin ?? (hovered ? bySlug.get(hovered)?.huc4 ?? null : null);

  return (
    <div className="sx-home">
      <section className="sx-hero">
        <div className="sx-hero-text">
          <p className="sx-eyebrow">FFRD · Colorado</p>
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
          <HomeMap
            areas={areas}
            items={items}
            basinState={basinState}
            highlight={selected ?? hovered}
            basinHighlight={highlightedBasin}
            focus={focus}
            onHover={setHovered}
            onSelect={select}
            onBasinSelect={selectBasin}
          />
          {current && (
            <HomePreview area={current} onClose={() => select(null)} />
          )}
        </div>
        <aside className="sx-rail" aria-label="Collections">
          <div className="sx-rail-head">
            <div className="sx-rail-title">
              <h2>Collections</h2>
              <span className="ffx-num">
                {totals.live} published · {areas.length - totals.live} in progress
              </span>
              <span className="sx-seg" role="group" aria-label="Group the list">
                <button type="button" aria-pressed={grouped} onClick={() => setGrouped(true)}>
                  Basins
                </button>
                <button type="button" aria-pressed={!grouped} onClick={() => setGrouped(false)}>
                  Flat list
                </button>
              </span>
            </div>
            <label className="ffx-field">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search collections</span>
              <input
                type="search"
                placeholder="Search collections"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <ul className="sx-rail-list ffx-scroll">
            {shown.length === 0 && <li className="sx-empty">No collections match.</li>}
            {grouped
              ? groups.map((g) => (
                  <li key={g.huc4} className="sx-basin-group" id={`basin-${g.huc4}`}>
                    <button
                      type="button"
                      className="sx-group"
                      data-active={basin === g.huc4}
                      onClick={() => selectBasin(g.huc4)}
                      onMouseEnter={() => setBasin(g.huc4)}
                      onMouseLeave={() => !selected && setBasin(null)}
                    >
                      <b>{g.name}</b>
                      <span className="ffx-num">
                        {[g.live && `${g.live} published`, g.planned && `${g.planned} in progress`].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    <ul>
                      {g.list.map((a) => (
                        <AreaRow key={a.slug} area={a} active={(selected ?? hovered) === a.slug} grouped onHover={setHovered} onSelect={select} />
                      ))}
                    </ul>
                  </li>
                ))
              : shown.map((a) => (
                  <AreaRow key={a.slug} area={a} active={(selected ?? hovered) === a.slug} onHover={setHovered} onSelect={select} />
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
  grouped = false,
  onHover,
  onSelect,
}: {
  area: HomeArea;
  active: boolean;
  grouped?: boolean;
  onHover: (slug: string | null) => void;
  onSelect: (slug: string) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    if (!window.matchMedia("(min-width: 64rem)").matches) return;
    ref.current.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <li ref={ref} className="sx-rail-item" data-active={active} data-live={area.live}>
      <button
        type="button"
        className="sx-row"
        onClick={() => onSelect(area.slug)}
        onMouseEnter={() => onHover(area.slug)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(area.slug)}
        onBlur={() => onHover(null)}
      >
        <div className="sx-row-main">
          <div className="sx-row-title">{area.name}</div>
          <div className="sx-row-sub">
            <span>{grouped ? AREA_KIND_LABEL[area.kind] : `${AREA_KIND_LABEL[area.kind]} · ${basinName(area.huc4)}`}</span>
            {area.live && area.temporal && (area.temporal[0] || area.temporal[1]) && (
              <span className="ffx-num">{fmtRange(area.temporal[0], area.temporal[1])}</span>
            )}
          </div>
        </div>
        <div className="sx-row-aside">
          {area.live ? <span className="ffx-num">{fmtNum(area.itemCount ?? 0)}</span> : <span>in progress</span>}
        </div>
      </button>
    </li>
  );
}
