import type { Metadata } from "next";
import { connection } from "next/server";
import { AdminConsole, type QueueRow } from "@/components/admin-console";
import { homeCrumb, PageHead } from "@/components/shell";
import { getCatalog } from "@/lib/catalog";
import { ENVS, PATH, nextEnv } from "@/lib/env";
import { pageEnv } from "@/lib/page-env";
import { canPromote } from "@/lib/promote";
import { baseName } from "@/lib/storage";
import { collectionHref } from "@/lib/utils";
import { versionName } from "@/lib/versions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin" };

type Props = {
  params: Promise<{ env: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Review for everything in one environment on one page: a few counts, a
 * queue of every collection with its QC state, and what happened lately.
 * Deciding here goes through the same server action as the collection page's
 * QC form, so approving still sends the collection on, and Production still
 * needs a note.
 *
 * Anyone who can reach the app can use this page, the same as the QC form.
 * When there's an identity provider, this is the page to gate by role first.
 */
export default async function AdminPage({ params, searchParams }: Props) {
  const env = await pageEnv(params);
  const sp = await searchParams;
  const now = await requestTime();
  const catalogs = await Promise.all(ENVS.map(async (e) => ({ env: e.key, catalog: await getCatalog(e.key) })));
  const here = catalogs.find((c) => c.env === env)!.catalog;
  // Each collection's state and decision date in every environment, for the stepper.
  const statusIn = new Map(
    catalogs.map(({ env: e, catalog }) => [
      e,
      new Map(
        catalog.collections.map((c) => [c.id, { qc: c.qc?.qc ?? "pending", at: c.qc?.date_approved ?? c.qc?.updated_at ?? null }]),
      ),
    ]),
  );

  const rows: QueueRow[] = here.collections.map((c) => ({
    id: c.id,
    title: c.title,
    href: collectionHref(env, c.id),
    version:
      c.series.versions.length > 1 || c.version
        ? versionName(c.series.versions.find((v) => v.id === c.id)?.label ?? c.version)
        : null,
    older: c.series.latest !== c.id,
    itemCount: c.itemCount,
    files: c.sources.map(baseName),
    sendable: canPromote(c),
    qc: c.qc,
    since: c.history[0]?.at ?? c.qc?.updated_at ?? null,
    stages: PATH.map((e) => {
      const s = statusIn.get(e.key)?.get(c.id);
      return { env: e.key, qc: s?.qc ?? null, at: s?.at ?? null };
    }),
    history: c.history,
  }));

  const next = nextEnv(env);
  return (
    <div className="sx-page">
      <PageHead
        crumbs={[homeCrumb(env), { label: "Admin" }]}
        title="Admin"
        subtitle={
          <span>
            Review queue for {ENVS.find((e) => e.key === env)!.label}.
            {next && rows.some((r) => r.sendable) && (
              <span className="sx-wide-only"> Approving sends a collection to {next.label}.</span>
            )}
          </span>
        }
      />
      {here.errors.length > 0 && (
        <p className="sx-callout" role="status">
          Some source files couldn&apos;t be read, so collections may be missing from this list. The details are in the
          server log.
        </p>
      )}
      <AdminConsole
        env={env}
        rows={rows}
        now={now}
        initial={{ status: one(sp.status), q: one(sp.q), sort: one(sp.sort) }}
      />
    </div>
  );
}

/** The time of this request, so every age on the page is measured from one moment. */
async function requestTime(): Promise<number> {
  await connection();
  return Date.now();
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
