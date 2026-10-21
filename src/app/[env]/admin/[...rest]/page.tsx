import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, homeCrumb } from "@/components/shell";
import { getCatalog } from "@/lib/catalog";
import { envMeta, withEnv } from "@/lib/env";
import { fmtNum } from "@/lib/format";
import { pageEnv } from "@/lib/page-env";

export const metadata: Metadata = { title: "Coming soon" };

type Props = { params: Promise<{ env: string; rest: string[] }> };

/**
 * Any Admin address that isn't built yet. The app is in front of clients,
 * so a link to a part of Admin that doesn't exist yet says so, names what
 * was asked for, and points at what Admin can do today, with the queue's
 * real counts, rather than landing on a 404.
 */
export default async function AdminComingSoon({ params }: Props) {
  const env = await pageEnv(params);
  const { rest } = await params;
  const admin = withEnv(env, "/admin");
  const asked = `/admin/${rest.map(decodeURIComponent).join("/")}`;
  const name = humanize(decodeURIComponent(rest[0] ?? ""));

  const { collections } = await getCatalog(env);
  const waiting = collections.filter((c) => (c.qc?.qc ?? "pending") === "pending").length;
  const here = envMeta(env).label;

  return (
    <div className="sx-page sx-soon">
      <Breadcrumbs crumbs={[homeCrumb(env), { label: "Admin", href: admin }, { label: name || "Coming soon" }]} />
      <div className="sx-soon-stage">
        <div className="ffx-panel sx-soon-card">
          <div className="sx-soon-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </div>
          <p className="sx-soon-kicker">{name ? `Admin · ${name}` : "Admin"}</p>
          <h1 className="sx-soon-title">Coming soon</h1>
          <p className="sx-soon-text">
            <code className="ffx-id">{asked}</code> isn&apos;t built yet. Reviewing and approving collections works today.
          </p>

          <Link href={admin} className="sx-soon-now">
            <span>
              <span className="sx-soon-now-title">Review queue</span>
              <span className="sx-soon-now-sub">
                {waiting > 0
                  ? `${fmtNum(waiting)} ${waiting === 1 ? "collection" : "collections"} waiting for review in ${here}`
                  : `Nothing waiting for review in ${here}`}
              </span>
            </span>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 4 4 4-4 4" />
            </svg>
          </Link>

          <div className="sx-soon-actions">
            <Link href={withEnv(env, "/")} className="ffx-btn">
              Back to the map
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "user-roles" or "user_roles" to "User roles". */
function humanize(segment: string): string {
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}
