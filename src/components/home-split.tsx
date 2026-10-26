"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RAIL_COOKIE, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN } from "@/lib/rail-share";

/** Neither pane gets narrower than this, whatever the share says. */
const RAIL_MIN_PX = 320;
const MAP_MIN_PX = 360;

/** How far an arrow key moves the divider, in percent. */
const STEP = 5;

/**
 * The console's two panes and the divider between them, which drags (or
 * takes the arrow keys) to give the dataset list or the map more room. It
 * follows the window splitter pattern: a focusable separator whose value
 * is the list's share of the width. Double-click puts it back at the
 * default. Only on a wide screen; a phone has the map over the list.
 */
export function HomeSplit({ initial, children }: { initial: number; children: ReactNode }) {
  const [share, setShare] = useState(initial);
  const root = useRef<HTMLDivElement>(null);

  // Keep both panes at their minimum widths, which in percent depends on
  // how wide the console is right now.
  const fit = (n: number) => {
    const width = root.current?.clientWidth || 0;
    const lo = width ? Math.max(RAIL_MIN, (RAIL_MIN_PX / width) * 100) : RAIL_MIN;
    const hi = width ? Math.min(RAIL_MAX, 100 - (MAP_MIN_PX / width) * 100) : RAIL_MAX;
    return Math.round(Math.min(Math.max(n, lo), Math.max(lo, hi)));
  };
  const commit = (n: number) => {
    const next = fit(n);
    setShare(next);
    document.cookie = `${RAIL_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div ref={root} className="sx-console" style={{ "--rail": `${share}%` } as CSSProperties}>
      {children}
      {/* A focusable separator is a widget (it moves with the keys), which
          the lint rules don't know. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="sx-seam"
        role="separator"
        aria-orientation="vertical"
        aria-controls="dataset-list"
        aria-label="Dataset list width"
        aria-valuenow={share}
        aria-valuemin={RAIL_MIN}
        aria-valuemax={RAIL_MAX}
        aria-valuetext={`${share}% of the width`}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.dataset.dragging = "";
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const box = root.current?.getBoundingClientRect();
          if (box) setShare(fit(((e.clientX - box.left) / box.width) * 100));
        }}
        onPointerUp={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          delete e.currentTarget.dataset.dragging;
          commit(share);
        }}
        onLostPointerCapture={(e) => {
          delete e.currentTarget.dataset.dragging;
        }}
        onDoubleClick={() => commit(RAIL_DEFAULT)}
        onKeyDown={(e) => {
          const to = { ArrowLeft: share - STEP, ArrowRight: share + STEP, Home: RAIL_MIN, End: RAIL_MAX }[e.key];
          if (to === undefined) return;
          e.preventDefault();
          commit(to);
        }}
      />
    </div>
  );
}
