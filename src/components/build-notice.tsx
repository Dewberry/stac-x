"use client";

import { useEffect, useState } from "react";
import { BUILD } from "@/lib/build";
import { withBase } from "@/lib/utils";

/** How often an open, visible tab asks which build is live. */
const EVERY_MS = 5 * 60_000;

/**
 * Tells someone their tab is from a build that's no longer the one
 * deployed. A tab left open keeps running the code it loaded, so after a
 * deployment it would go on showing the old app until reloaded, with
 * nothing to say so. This asks /api/version when the tab comes back into
 * view and every few minutes while it's showing, and compares the commit
 * with its own.
 *
 * It only offers the reload. Doing it unasked could throw away a QC note
 * someone is halfway through writing. The wording covers a rollback too:
 * the live build is the current one whether it's newer or not.
 *
 * The status element is always mounted and only its text changes, so
 * screen readers announce it. A build that doesn't know its commit has
 * nothing to compare and never asks.
 */
export function BuildNotice() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!BUILD.commit || stale) return;
    let gone = false;
    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(withBase("/api/version"), { cache: "no-store" });
        if (!res.ok) return;
        const live: { commit?: string | null } = await res.json();
        if (!gone && live.commit && live.commit !== BUILD.commit) setStale(true);
      } catch {
        // Offline, or the server is mid-restart. The next check will tell.
      }
    }
    const timer = window.setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      gone = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [stale]);

  return (
    <div className="sx-build-notice" data-stale={stale || undefined}>
      <div className="ffx-shell sx-build-notice-inner">
        <p role="status">{stale ? "The app has been updated since this page loaded. Reload to get the current version." : ""}</p>
        {stale && (
          <button type="button" className="ffx-btn ffx-btn-sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        )}
      </div>
    </div>
  );
}
