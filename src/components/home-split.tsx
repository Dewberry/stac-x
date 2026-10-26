"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * The console's two panes, and the one handle on the seam between them
 * that hides the dataset list and brings it back, for a wide look at the
 * map. The handle sits on the map's left edge, so it's in the same place
 * either way and keeps focus when the list goes. Only on a wide screen; a
 * phone has the map over the list and nothing to hide.
 */
export function HomeSplit({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const handle = useRef<HTMLButtonElement>(null);
  return (
    <div className="sx-console" data-rail={hidden ? "hidden" : undefined}>
      {children}
      <button
        ref={handle}
        type="button"
        className="sx-seam"
        aria-controls="dataset-list"
        aria-expanded={!hidden}
        aria-label={hidden ? "Show the dataset list" : "Hide the dataset list"}
        onClick={() => {
          setHidden(!hidden);
          // Focus inside the list would go down with it.
          handle.current?.focus();
        }}
      >
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={hidden ? "M4.5 2.5 8 6l-3.5 3.5" : "M7.5 2.5 4 6l3.5 3.5"} />
        </svg>
      </button>
    </div>
  );
}
