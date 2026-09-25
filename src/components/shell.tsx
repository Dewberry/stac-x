import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme";
export { Icon, ICONS } from "./icons";

/**
 * The page chrome: a white header bar with the wordmark and a one-line
 * tagline, the palette control at its right end, and a quiet footer.
 * Navigation is the map and the breadcrumbs, the way every STAC viewer
 * works, so the header carries no links.
 */

export function SiteHeader() {
  return (
    <header className="sx-header">
      <a href="#main" className="ffx-skip">
        Skip to content
      </a>
      <div className="ffx-shell sx-header-inner">
        <Link href="/" className="sx-brand">
          <span className="sx-brand-name">stac-x</span>
          <span className="sx-brand-tag">STAC catalog · FFRD Colorado pilot</span>
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="ffx-shell sx-footer">
      <span>stac-x reads stac-geoparquet from S3. QC edits are written back beside the source file.</span>
    </footer>
  );
}

export type Crumb = { label: string; href?: string };

/**
 * The top of a collection or item page, kept to two short lines so the map
 * starts high: the trail with the page's actions at its right end, then the
 * title with the page's facts beside it.
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
      <div className="sx-head-row">
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
        {actions && <div className="sx-actions">{actions}</div>}
      </div>
      <div className="sx-title-line">
        {kicker && <span className="sx-kicker">{kicker}</span>}
        <h1 className="sx-title">{title}</h1>
        {subtitle && <div className="sx-subtitle">{subtitle}</div>}
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
