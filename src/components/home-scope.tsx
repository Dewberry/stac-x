"use client";

import type { MouseEvent, ReactNode } from "react";
import type { EnvKey } from "@/lib/env";
import { scopeHref as scopePath, withBase } from "@/lib/utils";

/**
 * The home page opened on one catalog: `?in=basin-data`, so the view can
 * be shared and the back button leaves it. The rail and the map read the
 * catalog from the URL (home.tsx).
 *
 * A link here changes the URL through the History API rather than a
 * navigation, which Next keeps in step with useSearchParams. A navigation
 * would ask the server for the whole catalog again for what's only a
 * different view of it. A modified click (new tab, new window) is left to
 * the browser, and the href is a real one for it.
 */

/** The home page on a catalog, or the whole environment for null, with the base path for a plain link. */
function scopeHref(env: EnvKey, slug: string | null) {
  return withBase(scopePath(env, slug));
}

export function goToScope(env: EnvKey, slug: string | null) {
  const href = scopeHref(env, slug);
  // A link to what's already open adds nothing to Back.
  if (`${location.pathname}${location.search}` === href) return;
  window.history.pushState(null, "", href);
}

export function ScopeLink({
  env,
  slug,
  className,
  children,
  ...rest
}: {
  env: EnvKey;
  slug: string | null;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    goToScope(env, slug);
  };
  return (
    <a href={scopeHref(env, slug)} className={className} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
