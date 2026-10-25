"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

/** Desktop pane resizing, with keyboard and single-click alternatives to dragging. */
const KEY = "sx-home-rail-width";
const DEFAULT = 372;
const MIN = 320;
let remembered = DEFAULT;
function readWidth() {
  try {
    const width = Number(localStorage.getItem(KEY));
    return Number.isFinite(width) && width >= MIN ? width : remembered;
  } catch { return remembered; }
}
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(KEY, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(KEY, onChange);
  };
}
function saveWidth(width: number) {
  remembered = width;
  try { localStorage.setItem(KEY, String(width)); } catch {}
  window.dispatchEvent(new Event(KEY));
}

export function HomeSplit({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [available, setAvailable] = useState(1024);
  const preferred = useSyncExternalStore(subscribe, readWidth, () => DEFAULT);
  const instructions = useId();
  const max = Math.max(MIN, Math.floor(Math.min(available * 0.7, available - 344)));
  const width = Math.max(MIN, Math.min(max, preferred));
  const resize = (value: number) => saveWidth(Math.round(Math.max(MIN, Math.min(max, value))));

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={host} className="sx-console" data-resizing={dragging || undefined} style={{ "--sx-rail-width": `${width}px` } as CSSProperties}>
      {children}
      <div className="sx-rail-resizer">
        <button type="button" aria-label="Narrow collections pane" aria-disabled={width <= MIN} onClick={() => resize(width - 40)}>‹</button>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- ARIA window splitters are focusable separators with arrow-key resizing. */}
        <div tabIndex={0}
          role="separator"
          aria-label="Collections pane width"
          aria-orientation="vertical"
          aria-controls="collections-pane"
          aria-describedby={instructions}
          aria-valuemin={MIN}
          aria-valuemax={max}
          aria-valuenow={width}
          aria-valuetext={`${width} pixels`}
          className="sx-rail-grip"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, width };
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (drag.current) resize(drag.current.width + e.clientX - drag.current.x);
          }}
          onPointerUp={(e) => {
            drag.current = null;
            setDragging(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
          onPointerCancel={() => { drag.current = null; setDragging(false); }}
          onDoubleClick={() => resize(DEFAULT)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 40 : 10;
            const next = e.key === "ArrowLeft" ? width - step : e.key === "ArrowRight" ? width + step
              : e.key === "Home" ? MIN : e.key === "End" ? max : e.key === "Enter" ? DEFAULT : null;
            if (next === null) return;
            e.preventDefault();
            resize(next);
          }}
        ><span aria-hidden="true" /></div>
        <button type="button" aria-label="Widen collections pane" aria-disabled={width >= max} onClick={() => resize(width + 40)}>›</button>
        <p id={instructions} className="sr-only">Drag or use Left and Right arrows to resize. Home and End set the limits. Enter resets the width.</p>
      </div>
    </div>
  );
}