import type { Metadata } from "next";
import { connection } from "next/server";
import { AdminConsole, type QueueRow } from "@/components/admin-console";
import { PageHead } from "@/components/shell";
import { getCatalog } from "@/lib/catalog";
import { ENVS, nextEnv, type EnvKey } from "@/lib/env";
import { collectionName } from "@/lib/format";
import { MOCK_REVIEWS, type MockReview } from "@/lib/fixtures/review";
import { guessKind } from "@/lib/kinds";
import { pageEnv } from "@/lib/page-env";
import type { QcEvent } from "@/lib/stac";
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
 * The queue is the real catalog plus the mock rows in fixtures/review.ts,
 * which fill it out until more collections exist.
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

  const real: QueueRow[] = here.collections.map((c) => ({
    id: c.id,
    title: c.title,
    href: collectionHref(env, c.id),
    kind: guessKind(c),
    version:
      c.series.versions.length > 1 || c.version
        ? versionName(c.series.versions.find((v) => v.id === c.id)?.label ?? c.version)
        : null,
    older: c.series.latest !== c.id,
    itemCount: c.itemCount,
    files: c.sources.map(baseName),
    qc: c.qc,
    since: c.history[0]?.at ?? c.qc?.updated_at ?? null,
    stages: ENVS.map((e) => {
      const s = statusIn.get(e.key)?.get(c.id);
      return { env: e.key, qc: s?.qc ?? null, at: s?.at ?? null };
    }),
    history: c.history,
    mock: false,
  }));
  const taken = new Set(real.map((r) => r.id));
  const mock = MOCK_REVIEWS.filter((m) => m.in[env] && !taken.has(m.id)).map((m) => mockRow(m, env, now));

  const next = nextEnv(env);
  return (
    <div className="sx-page">
      <PageHead
        title="Admin"
        subtitle={
          <span>
            Review queue for {ENVS.find((e) => e.key === env)!.label}.
            {next && <span className="sx-wide-only"> Approving sends a collection to {next.label}.</span>}
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
        rows={[...real, ...mock]}
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

/** A fixture as a queue row, with the history it would have: arrivals, saves and moves, newest first. */
function mockRow(m: MockReview, env: EnvKey, now: number): QueueRow {
  const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const state = m.in[env]!;
  const i = ENVS.findIndex((e) => e.key === env);
  const prev = ENVS[i - 1] ? m.in[ENVS[i - 1].key] : undefined;
  const ahead = ENVS[i + 1] ? m.in[ENVS[i + 1].key] : undefined;
  const files = m.files;
  const history: QcEvent[] = [];
  if (ahead) history.push({ kind: "promoted", at: at(state.hoursAgo), to: ENVS[i + 1].key, files });
  if (state.qc !== "pending") {
    history.push({
      kind: "qc",
      at: at(state.hoursAgo),
      qc: state.qc,
      date_approved: state.qc === "approved" ? at(state.hoursAgo).slice(0, 10) : null,
      note: state.note ?? null,
    });
  }
  if (prev) history.push({ kind: "received", at: at(prev.hoursAgo), from: ENVS[i - 1].key, files });
  return {
    id: m.id,
    title: collectionName(m.title, m.id),
    href: null,
    kind: m.kind,
    version: m.version ? versionName(m.version) : null,
    older: !!m.older,
    itemCount: m.itemCount,
    files,
    qc:
      state.qc === "pending" && !prev
        ? null
        : {
            qc: state.qc,
            date_approved: state.qc === "approved" ? at(state.hoursAgo).slice(0, 10) : null,
            note: state.note ?? null,
            updated_at: at(state.hoursAgo),
          },
    since: at(state.hoursAgo),
    stages: ENVS.map((e) => {
      const s = m.in[e.key];
      return { env: e.key, qc: s?.qc ?? null, at: s && s.qc !== "pending" ? at(s.hoursAgo) : null };
    }),
    history,
    mock: true,
  };
}
