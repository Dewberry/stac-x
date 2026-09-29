import type { ReactNode } from "react";
import { BrandLink } from "./brand-link";
import { HeaderControls } from "./env-switcher";
export { EnvBand } from "./env-switcher";
import { ThemeToggle } from "./theme";
import type { Session } from "@/lib/session";
export { Icon, ICONS } from "./icons";

/**
 * The page chrome, kept identical to ffrd-x's so the two consoles read as one
 * program: a navy header bar with the wordmark alone on one line, and a
 * footer band with the app's note on the left and the palette control at its
 * right end. Both sit on the same 96rem shell and the same edge gutter.
 * Navigation is the map and the Collection and Up actions, as in STAC Browser.
 * Signed in, the header's right end holds the environment switcher and the
 * account badge.
 */

export function SiteHeader({ session }: { session: Session | null }) {
  return (
    <header className="sx-header">
      <a href="#main" className="ffx-skip">
        Skip to content
      </a>
      <div className="ffx-shell sx-header-inner">
        <BrandLink className="sx-brand" />
        <div className="ml-auto flex items-center gap-2">
          <HeaderControls session={session} home="/" homeLabel="Home" signOut="/signin" />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="sx-footer">
      <div className="ffx-shell sx-footer-inner">
        <span>stac-x reads stac-geoparquet from S3. QC edits are written back beside the source file.</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}

/**
 * The top of a collection or item page, laid out like STAC Browser's: the
 * title (with the page's facts beside it) on the left, and at the right end
 * the navigation group followed by the source group. There's no breadcrumb,
 * since STAC Browser has none; Collection and Up are the way back.
 */
export function PageHead({
  kicker,
  title,
  subtitle,
  nav,
  actions,
}: {
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  nav?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sx-head">
      <div className="sx-title-line">
        {kicker && <span className="sx-kicker">{kicker}</span>}
        <h1 className="sx-title">{title}</h1>
        {subtitle && <div className="sx-subtitle">{subtitle}</div>}
      </div>
      {(nav || actions) && (
        <div className="sx-actions">
          {nav && (
            <nav className="sx-action-group" aria-label="Go to">
              {nav}
            </nav>
          )}
          {actions && <div className="sx-action-group">{actions}</div>}
        </div>
      )}
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
