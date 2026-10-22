"use client";

import { useEffect, useState } from "react";
import { Icon, ICONS } from "./icons";

/**
 * Copies a string and says so for a moment. Used for asset URIs and page
 * links, the two things on this app people paste into somewhere else.
 */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  small = true,
  icon = ICONS.copy,
  currentUrl = false,
  ariaLabel,
  className = "",
}: {
  text?: string;
  label?: string;
  copiedLabel?: string;
  small?: boolean;
  icon?: string;
  /** Copy the page's own URL, which only the browser knows. */
  currentUrl?: boolean;
  /** The accessible name, when the label on the button is shorter ("S3 URI" for "Copy S3 URI"). */
  ariaLabel?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);

  async function copy() {
    const value = currentUrl ? window.location.href : (text ?? "");
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
    } catch {
      window.prompt("Copy this", value);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`ffx-btn ${small ? "ffx-btn-sm" : ""} ${className}`.trim()}
      aria-label={ariaLabel}
      title={ariaLabel}
      aria-live="polite"
    >
      <Icon d={icon} size={small ? 12 : 14} />
      {done ? copiedLabel : label}
    </button>
  );
}
