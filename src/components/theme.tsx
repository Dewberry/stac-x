"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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

/**
 * The stored theme as a data-theme value, for global-error. It renders its
 * own <html> as a client component, where ThemeScript's <script> wouldn't
 * run, so it sets the attribute through React instead.
 */
export function useStoredTheme(): "light" | "dark" | undefined {
  const choice = useSyncExternalStore(subscribe, readChoice, readServerChoice);
  return choice === "system" ? undefined : choice;
}

const CHOICES: { value: Choice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * The theme as a radio group in the account menu, so it's reachable on
 * every page, including the home page, which has no footer on a wide
 * screen. Picking one keeps the menu open, so the change can be seen.
 */
export function ThemeMenuItems() {
  const choice = useSyncExternalStore(subscribe, readChoice, readServerChoice);
  return (
    <>
      <DropdownMenu.Label className="px-2.5 pb-1.5 pt-1 text-micro text-ink-mut">Theme</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={choice} onValueChange={(v) => apply(v as Choice)}>
        {CHOICES.map((c) => (
          <DropdownMenu.RadioItem
            key={c.value}
            value={c.value}
            className="ffx-menu-item ffx-theme-item"
            onSelect={(e) => e.preventDefault()}
          >
            <span className="ffx-theme-check" aria-hidden="true">
              <DropdownMenu.ItemIndicator>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </DropdownMenu.ItemIndicator>
            </span>
            {c.label}
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    </>
  );
}
