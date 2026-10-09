import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLink } from "./brand-link";
import { Icon, ICONS } from "./icons";
import { HeaderControls } from "./env-switcher";
import { MoreMenu } from "./more-menu";
export { EnvBand } from "./env-switcher";
import { ThemeMenuItems } from "./theme";
import { withEnv, type EnvKey } from "@/lib/env";
import type { Session } from "@/lib/session";
export { Icon, ICONS } from "./icons";

/**
 * The page chrome, kept identical to ffrd-x's so the two consoles read as one
 * program: a navy header bar with the wordmark alone on one line, and a
 * footer band with the app's note. Both sit on the same 96rem shell and the
 * same edge gutter. The theme is in the account menu, so it's on every page.
 * Navigation is the map and the breadcrumb trail at the top of each page,
 * which starts at the home page so there's always a plain way back.
 * Signed in, the header's right end holds the environment switcher and the
 * account badge, whose menu is the way to Admin.
 */

/** What the home page is called wherever it's linked: the trail and the account menu. */
const HOME_LABEL = "All collections";

/** Pages reached from the account menu rather than the bar. */
const ACCOUNT_LINKS = [{ href: "/admin", label: "Admin" }];

export function SiteHeader({ session }: { session: Session | null }) {
  return (
    <header className="sx-header">
      <a href="#main" className="ffx-skip">
        Skip to content
      </a>
      <div className="ffx-shell sx-header-inner">
        <BrandLink className="sx-brand" />
        <div className="ml-auto flex items-center gap-2">
          <HeaderControls
            session={session}
            home="/"
            homeLabel={HOME_LABEL}
            signOut="/signin"
            links={ACCOUNT_LINKS}
            menuItems={<ThemeMenuItems />}
          />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="sx-footer">
      <div className="ffx-shell sx-footer-inner">
        <span>Collections are read from stac-geoparquet in S3. QC edits are saved beside the source file.</span>
      </div>
    </footer>
  );
}

/** One step of the trail. The last crumb is the page itself and has no href. */
export type Crumb = { label: string; href?: string };

/** The first crumb of every trail: the home page of the environment you're in. */
export function homeCrumb(env: EnvKey): Crumb {
  return { label: HOME_LABEL, href: withEnv(env, "/") };
}

/**
 * The trail down to this page: the home page, then on an item its collection
 * and then the item. It starts at home because people reading a collection
 * couldn't find their way back: the wordmark doesn't look like a link and
 * the account menu is two clicks away. The last crumb is the page itself:
 * plain text, marked as the current page but no louder than the links, since
 * the title sits right under it. Long names clip so the trail stays readable
 * on a phone.
 */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="sx-crumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${i}-${c.label}`}>
              {i > 0 && <Icon d={ICONS.chevronRight} size={10} />}
              {c.href && !last ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span aria-current={last ? "page" : undefined}>{c.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The top of a collection or item page: a breadcrumb trail across the top,
 * home and then on an item its collection, then, as in STAC Browser, the title
 * (with the page's facts beside it) on the left and at the right end the
 * navigation group followed by the source group. The breadcrumb is ours;
 * STAC Browser has Collection and Up buttons instead, which people found
 * less familiar. The kind of thing the page is about sits above the title.
 * Below 64rem the source group folds into one ⋯ pill so the actions stay on
 * one row.
 */
export function PageHead({
  crumbs,
  kicker,
  title,
  subtitle,
  nav,
  actions,
}: {
  crumbs?: Crumb[];
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  nav?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sx-head">
      {crumbs && crumbs.length > 0 && <Breadcrumbs crumbs={crumbs} />}
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
          {actions && (
            <>
              <div className="sx-action-group sx-actions-wide">{actions}</div>
              <MoreMenu>{actions}</MoreMenu>
            </>
          )}
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
