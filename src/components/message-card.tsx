import type { ReactNode } from "react";
import Link from "next/link";

/**
 * The one card a page shows when it has nothing else to show: a page that
 * isn't there, a collection that isn't in this environment, an Admin page
 * that isn't built, or an error. A round mark, a small kicker, the title,
 * a line saying what happened, then the ways on. It has no hooks, so server
 * pages and the client error boundaries both use it.
 */
export function MessageCard({
  mark,
  kicker,
  title,
  children,
  aside,
  actions,
}: {
  mark: keyof typeof MARKS;
  kicker: ReactNode;
  title: ReactNode;
  children: ReactNode;
  /** Anything between the text and the buttons, like the queue row on Admin. */
  aside?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="ffx-panel sx-msg-card">
      <div className={`sx-msg-mark sx-msg-mark-${mark}`} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {MARKS[mark]}
        </svg>
      </div>
      <p className="sx-msg-kicker">{kicker}</p>
      <h1 className="sx-msg-title">{title}</h1>
      <div className="sx-msg-text">{children}</div>
      {aside}
      <div className="sx-msg-actions">{actions}</div>
    </div>
  );
}

/** The place you probably wanted instead, as a row you can click. */
export function MessageRow({ href, title, sub }: { href: string; title: ReactNode; sub: ReactNode }) {
  return (
    <Link href={href} className="sx-msg-now">
      <span>
        <span className="sx-msg-now-title">{title}</span>
        <span className="sx-msg-now-sub">{sub}</span>
      </span>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 4 4 4-4 4" />
      </svg>
    </Link>
  );
}

const MARKS = {
  // A clock: not built yet.
  soon: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  // A map pin with nothing at it: the address doesn't lead anywhere.
  missing: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <path d="m10 8 4 4M14 8l-4 4" />
    </>
  ),
  // A pin with an arrow: it's somewhere else.
  elsewhere: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <path d="M9.5 10h5M12.5 8l2 2-2 2" />
    </>
  ),
  // An exclamation in a circle: something failed.
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </>
  ),
};
