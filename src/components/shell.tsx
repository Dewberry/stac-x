import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme";
import { catalogTitle } from "@/lib/config";
export { Icon, ICONS } from "./icons";

/**
 * The page chrome: a white header bar with the wordmark, and a quiet footer
 * with the palette control. Navigation is the map and the breadcrumbs, the
 * way every STAC viewer works.
 */

export function SiteHeader() {
  return (
    <header className="sx-header">
      <a href="#main" className="ffx-skip">
        Skip to content
      </a>
      <div className="ffx-shell sx-header-inner">
        <Link href="/" className="sx-brand">
          stac-x
        </Link>
        <nav className="sx-nav" aria-label="Primary">
          <Link href="/">Model areas</Link>
        </nav>
        <span className="ml-auto hidden text-small text-ink-mut sm:inline">{catalogTitle}</span>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="ffx-shell sx-footer">
      <span>stac-x reads stac-geoparquet from S3. QC edits are written back beside the source file.</span>
      <ThemeToggle />
    </footer>
  );
}

export type Crumb = { label: string; href?: string };

/**
 * The top of a collection or item page: the trail, then the title with the
 * page's actions at its right end. Sits on the canvas; the map card below
 * is the first thing with an edge.
 */
export function PageHead({
  trail,
  kicker,
  title,
  subtitle,
  actions,
}: {
  trail: Crumb[];
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sx-head">
      <nav aria-label="Breadcrumb" className="sx-crumbs">
        {trail.map((c, i) => (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && (
              <span className="text-ink-dim" aria-hidden="true">
                /
              </span>
            )}
            {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </span>
        ))}
      </nav>
      <div className="sx-title-row">
        <div className="min-w-0">
          {kicker && <div className="sx-kicker">{kicker}</div>}
          <h1 className="sx-title">{title}</h1>
          {subtitle && <div className="sx-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="sx-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Panel({
  title,
  note,
  actions,
  children,
  bodyClass = "",
  id,
}: {
  title?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section className="ffx-panel" aria-labelledby={headingId} id={id}>
      {title && (
        <div className="ffx-panel-head">
          <h2 id={headingId} className="ffx-panel-title">
            {title}
          </h2>
          {actions ?? (note ? <p className="ffx-panel-note">{note}</p> : null)}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}
