import type { Metadata } from "next";
import Link from "next/link";
import { MessageCard, MessageRow } from "@/components/message-card";
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
    <div className="sx-page sx-msg">
      <Breadcrumbs crumbs={[homeCrumb(env), { label: "Admin", href: admin }, { label: name || "Coming soon" }]} />
      <div className="sx-msg-stage">
        <MessageCard
          mark="soon"
          kicker={name ? `Admin · ${name}` : "Admin"}
          title="Coming soon"
          aside={
            <MessageRow
              href={admin}
              title="Review queue"
              sub={
                waiting > 0
                  ? `${fmtNum(waiting)} ${waiting === 1 ? "collection" : "collections"} waiting for review in ${here}`
                  : `Nothing waiting for review in ${here}`
              }
            />
          }
          actions={
            <Link href={withEnv(env, "/")} className="ffx-btn">
              Back to the map
            </Link>
          }
        >
          <p>
            <code className="ffx-id">{asked}</code> isn&apos;t built yet. Reviewing and approving collections works today.
          </p>
        </MessageCard>
      </div>
    </div>
  );
}

/** "user-roles" or "user_roles" to "User roles". */
function humanize(segment: string): string {
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}
