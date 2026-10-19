"use client";

import Link from "next/link";
import type { ReactNode, Ref } from "react";
import type { EnvKey } from "@/lib/env";
import { ColHead } from "./col-head";
import type { HomeArea } from "./home";
import { AreaSub, PreviewBody } from "./home-preview";
import { Icon, ICONS } from "./icons";
import { ItemsList, type ItemRow } from "./items-list";

/**
 * The selected collection, beside the rail: the collection on the left and
 * its map, wider, on the right. Each has a one-line header above its card
 * (col-head.tsx), and the cards start on one line. The pane is a grid of
 * the console's own columns (subgrid, globals.css): headers in the first
 * row, cards in the second.
 *
 * The collection card opens with what the row used to open with (the
 * description, the count, where its QC stands, the last review note) and
 * goes on to its items: a search, a sort and pages of rows, the same list
 * as the collection page, with the way in (JSON, Open collection) between
 * the two. Until a row is picked the card says so and the
 * map holds the bare basin; the map is rendered here either way, so a pick
 * doesn't rebuild it.
 */
export function HomePane({
  env,
  area,
  rows,
  railToggle,
  activeIds,
  map,
  paneRef,
}: {
  env: EnvKey;
  /** The selected collection; null until one is picked. */
  area: HomeArea | null;
  /** The collection's items, null while they're fetched, "error" when they couldn't be. */
  rows: ItemRow[] | "error" | null;
  /** The rail's toggle, while the rail is folded away: it leads the collection header. */
  railToggle?: ReactNode;
  /** Item ids whose shape is under the cursor on the map, for the rows to light up. */
  activeIds?: ReadonlySet<string>;
  map: ReactNode;
  paneRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className="sx-pane" ref={paneRef}>
      <ColHead
        className="sx-pane-head"
        id="col-items-h"
        title={area ? area.name : "Collection"}
        lead={railToggle}
      />
      <ColHead className="sx-map-head" title="Map" />
      <div className="sx-pane-side">{map}</div>
      <section id="col-items" className="ffx-panel sx-items" aria-labelledby="col-items-h">
        {!area ? (
          <p className="sx-empty">Select a collection to see what&apos;s in it and where it is.</p>
        ) : (
          <div className="sx-items-about">
            <AreaSub area={area} showKind={false} />
            <PreviewBody area={area} />
            <div className="sx-pv-btns">
              <a href={area.jsonHref} className="ffx-btn ffx-btn-sm" target="_blank" rel="noreferrer">
                <Icon d={ICONS.json} size={12} /> JSON
              </a>
              <Link href={area.href} className="ffx-btn ffx-btn-sm ffx-btn-primary">
                Open collection
              </Link>
            </div>
          </div>
        )}
        {!area ? null : rows === null ? (
          <ul className="sx-loading-rows" aria-hidden="true">
            {[58, 44, 66, 38, 52].map((w, i) => (
              <li key={i} style={{ "--w": `${w}%` } as React.CSSProperties}>
                <i />
                <b />
                <s />
              </li>
            ))}
          </ul>
        ) : rows === "error" ? (
          <p className="sx-empty">The items couldn&apos;t be loaded. Open the collection to see them.</p>
        ) : (
          <ItemsList env={env} collection={area.id} rows={rows} activeIds={activeIds} />
        )}
      </section>
    </div>
  );
}
