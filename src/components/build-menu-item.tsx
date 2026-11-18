"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useState } from "react";
import { Icon, ICONS } from "./icons";
import { BUILD, buildSummary, builtLabel } from "@/lib/build";
import { fmtDate } from "@/lib/format";

/**
 * The app's version in the account menu, where anyone can find it, signed
 * in or not: the version, then the commit and the build date behind it.
 *
 * It's a menu item rather than a line of text so the keyboard and a screen
 * reader reach it like everything else in the menu. Choosing it copies the
 * build on one line, for a bug report, and keeps the menu open so the
 * "Copied" shows.
 */
export function BuildMenuItem() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);

  const built = builtLabel(fmtDate(BUILD.builtAt, { time: false }));
  const summary = buildSummary(builtLabel(fmtDate(BUILD.builtAt)));

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      setDone(true);
    } catch {
      window.prompt("Copy this", summary);
    }
  }

  return (
    <>
      <DropdownMenu.Item
        className="ffx-menu-item sx-build-item"
        onSelect={(e) => {
          e.preventDefault();
          void copy();
        }}
      >
        <span>
          <span className="sx-build-name">Version {BUILD.version}</span>
          <span className="sx-build-sub">
            {BUILD.shortCommit && (
              <>
                <span className="ffx-id">{BUILD.shortCommit}</span> ·{" "}
              </>
            )}
            {built}
          </span>
          <span className="sr-only">. Copy version details</span>
        </span>
        <span className="sx-build-copy" aria-hidden="true">
          {done ? "Copied" : <Icon d={ICONS.copy} size={12} />}
        </span>
      </DropdownMenu.Item>
      <span className="sr-only" role="status">
        {done ? "Copied version details" : ""}
      </span>
    </>
  );
}
