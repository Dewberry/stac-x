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

/**
 * The top of a collection or item page, one line so the map starts high:
 * the title with the page's facts beside it, the page's actions at the
 * right end. There is no breadcrumb trail; the Up action is the way back.
 */
export function PageHead({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sx-head">
      <div className="sx-title-line">
        {kicker && <span className="sx-kicker">{kicker}</span>}
        <h1 className="sx-title">{title}</h1>
        {subtitle && <div className="sx-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="sx-actions">{actions}</div>}
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
