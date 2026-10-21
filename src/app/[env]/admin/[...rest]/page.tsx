import type { Metadata } from "next";
import Link from "next/link";
import { homeCrumb, PageHead } from "@/components/shell";
import { withEnv } from "@/lib/env";
import { pageEnv } from "@/lib/page-env";

export const metadata: Metadata = { title: "Coming soon" };

/**
 * Any Admin address that isn't built yet. The app is in front of clients,
 * so a link to a part of Admin that doesn't exist yet says so and points
 * back to the review queue, rather than landing on a 404.
 */
export default async function AdminComingSoon({ params }: { params: Promise<{ env: string }> }) {
  const env = await pageEnv(params);
  const admin = withEnv(env, "/admin");
  return (
    <div className="sx-page">
      <PageHead crumbs={[homeCrumb(env), { label: "Admin", href: admin }, { label: "Coming soon" }]} title="Coming soon" />
      <div className="ffx-panel p-[var(--ffx-panel-pad)] max-w-xl">
        <p className="text-small text-ink-sec">
          This part of Admin isn&apos;t built yet. Reviewing and approving collections works today from the review queue.
        </p>
        <Link href={admin} className="ffx-btn ffx-btn-sm mt-3">
          Back to the review queue
        </Link>
      </div>
    </div>
  );
}
