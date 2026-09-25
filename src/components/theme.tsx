"use client";

import { useSyncExternalStore } from "react";

/**
 * Theme handling, as in ffrd-x. The script runs before paint and sets
 * data-theme on <html> from localStorage so there is no flash of the wrong
 * palette. With no stored preference the attribute stays absent and the OS
 * decides through the media query in globals.css.
 */
const SCRIPT = `(function(){try{var t=localStorage.getItem("sx-theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

type Choice = "system" | "light" | "dark";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readChoice(): Choice {
  try {
    const stored = localStorage.getItem("sx-theme");
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

const readServerChoice = (): Choice => "system";

export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, readChoice, readServerChoice);

  function apply(next: Choice) {
    const root = document.documentElement;
    root.setAttribute("data-theme-switching", "");
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      if (next === "system") localStorage.removeItem("sx-theme");
      else localStorage.setItem("sx-theme", next);
    } catch {
      // Blocked storage is not a reason to refuse the change.
    }
    listeners.forEach((l) => l());
    window.requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
  }

  return (
    <label className="ffx-select-wrap flex items-center gap-1.5">
      <span className="sr-only">Color palette</span>
      <select
        value={choice}
        onChange={(e) => apply(e.target.value as Choice)}
        className="ffx-theme-select bg-transparent py-0.5 pl-0 pr-4 text-micro text-ink-mut hover:text-ink"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
