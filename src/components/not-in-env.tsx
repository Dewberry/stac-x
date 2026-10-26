import Link from "next/link";
import { connection } from "next/server";
import { MessageCard, MessageRow } from "./message-card";
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
 * it's on its way. A catalog isn't reviewed or sent anywhere, so for one
 * the card only says where it is.
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
  const catalog = furthest?.c?.kind === "catalog";
  const stand = furthest?.c && !catalog
    ? {
        env: envMeta(furthest.env).label,
        qc: furthest.c.qc?.qc ?? "pending",
        since: furthest.c.history[0]?.at ?? furthest.c.qc?.updated_at ?? null,
      }
    : null;

  const missing = found.length === 0;

  return (
    <div className="sx-page sx-msg">
      <div className="sx-msg-stage">
        <MessageCard
          mark={missing ? "missing" : "elsewhere"}
          kicker={missing ? "404" : catalog ? "Catalog" : "Collection"}
          title={missing ? "Collection not found" : `Not in ${here} yet`}
          aside={
            sibling && (
              <MessageRow href={collectionHref(env, sibling.id)} title={sibling.id} sub={`${siblingName} of it, in ${here}`} />
            )
          }
          actions={
            <>
              {found.map((k, i) => (
                <Link
                  key={k}
                  href={collectionHref(k, collection)}
                  className={i === 0 && !sibling ? "ffx-btn ffx-btn-primary" : "ffx-btn"}
                >
                  Open in {envMeta(k).label}
                </Link>
              ))}
              <Link href={withEnvHome(env)} className={missing && !sibling ? "ffx-btn ffx-btn-primary" : "ffx-btn"}>
                Back to the map
              </Link>
            </>
          }
        >
          {missing ? (
            <p>
              <code className="ffx-id">{collection}</code> isn&apos;t in any environment. It may have been renamed in
              the bucket, or the file that held it may no longer be listed.
            </p>
          ) : (
            <>
              <p>
                <code className="ffx-id">{collection}</code> is in {new Intl.ListFormat("en-US").format(found.map((k) => envMeta(k).label))}.{" "}
                {catalog
                  ? `A catalog is in ${here} once a dataset inside it is.`
                  : envMeta(env).onPath
                    ? `A dataset reaches ${here} when it's approved in the environment before it.`
                    : `Nothing is promoted into ${here}. It only holds what its own catalog lists.`}
              </p>
              {stand && (
                <p className="sx-msg-state">
                  <span>In {stand.env}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <QcMark state={stand.qc} />
                    {qcMeta(stand.qc).label}
                  </span>
                  {stand.since && <span className="ffx-num">{fmtAge(stand.since, now)}</span>}
                </p>
              )}
            </>
          )}
        </MessageCard>
      </div>
    </div>
  );
}

/** The time of this request, so the age on the card is measured from it. */
async function requestTime(): Promise<number> {
  await connection();
  return Date.now();
}
