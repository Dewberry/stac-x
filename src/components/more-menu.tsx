"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The page's source actions (JSON, Download, Copy link) behind one ⋯ pill,
 * for widths where they'd wrap the header onto a second row. A plain
 * <details>, closed again by a click outside or Escape.
 */
export function MoreMenu({ children, label = "More actions" }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = (e: Event) => {
      if (!el.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className="sx-more">
      <summary className="ffx-btn ffx-btn-sm" aria-label={label} title={label}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.5" cy="8" r="1.25" />
        </svg>
      </summary>
      <div className="sx-more-menu">{children}</div>
    </details>
  );
}
