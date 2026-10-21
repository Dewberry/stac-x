import Link from "next/link";
import { connection } from "next/server";
import { QcMark } from "./qc-mark";
import { getCatalog, getCollection } from "@/lib/catalog";
import { ENVS, envMeta, type EnvKey } from "@/lib/env";
import { fmtAge } from "@/lib/format";
import { qcMeta } from "@/lib/stac";
import { collectionHref, withEnvHome } from "@/lib/utils";
import { splitVersion, versionName } from "@/lib/versions";

/**
 * A collection that isn't in this environment. Usually it just hasn't been
 * sent here yet, which is what the switcher lands on when you change
 * environments from a collection page, so say where it is instead of a bare
 * 404. When another version of it is here, offer that too: Development can
 * be a version ahead of Production. The card says where the collection
 * stands in the furthest environment it has reached, so you know whether
 * it's on its way.
 */
export async function NotInEnv({ env, collection }: { env: EnvKey; collection: string }) {
  const elsewhere = await Promise.all(
    ENVS.filter((e) => e.key !== env).map(async (e) => ({ env: e.key, c: await getCollection(e.key, collection) })),
  );
  const found = elsewhere.filter((x) => x.c).map((x) => x.env);
  const seriesId = elsewhere.find((x) => x.c)?.c?.series.id ?? splitVersion(collection)?.base ?? collection;
  const sibling = (await getCatalog(env)).collections.find((c) => c.series.id === seriesId && c.series.latest === c.id);
  const siblingLabel = sibling?.series.versions.find((v) => v.id === sibling.id)?.label ?? null;
  const siblingName = siblingLabel ? versionName(siblingLabel) : "Another version";
  const here = envMeta(env).label;
  const now = await requestTime();
  // The furthest environment it has reached is the one that says how close it is.
  const furthest = [...elsewhere].reverse().find((x) => x.c);
  const stand = furthest?.c
    ? {
        env: envMeta(furthest.env).label,
        qc: furthest.c.qc?.qc ?? "pending",
        since: furthest.c.history[0]?.at ?? furthest.c.qc?.updated_at ?? null,
      }
    : null;

  return (
    <div className="sx-page sx-notin">
      <div className="ffx-panel sx-notin-card">
        <h1 className="font-display text-head font-semibold tracking-[-0.015em]">
          {found.length ? `${collection} isn't in ${here} yet` : "Not found"}
        </h1>
        {stand && (
          <p className="sx-notin-state">
            <span>In {stand.env}</span>
            <span className="inline-flex items-center gap-1.5">
              <QcMark state={stand.qc} />
              {qcMeta(stand.qc).label}
            </span>
            {stand.since && <span className="ffx-num">{fmtAge(stand.since, now)}</span>}
          </p>
        )}
        <p className="mt-2 text-small text-ink-mut">
          {found.length
            ? `It's in ${new Intl.ListFormat("en-US").format(found.map((k) => envMeta(k).label))}. ${
                envMeta(env).onPath
                  ? `A collection reaches ${here} when it's approved in the environment before it.`
                  : `Nothing is promoted into ${here}. It only holds what its own catalog lists.`
              }`
            : "No collection by that id is in any environment. It may have been renamed in the bucket, or the file that held it may no longer be listed."}
          {sibling && ` ${siblingName} of it is in ${here}.`}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {sibling && (
            <Link href={collectionHref(env, sibling.id)} className="ffx-btn ffx-btn-sm">
              Open {sibling.id} here
            </Link>
          )}
          {found.map((k) => (
            <Link key={k} href={collectionHref(k, collection)} className="ffx-btn ffx-btn-sm">
              Open in {envMeta(k).label}
            </Link>
          ))}
          <Link href={withEnvHome(env)} className="ffx-btn ffx-btn-sm">
            Back to the map
          </Link>
        </div>
      </div>
    </div>
  );
}

/** The time of this request, so the age on the card is measured from it. */
async function requestTime(): Promise<number> {
  await connection();
  return Date.now();
}
