import Link from "next/link";
import { getCatalog, getCollection } from "@/lib/catalog";
import { ENVS, envMeta, type EnvKey } from "@/lib/env";
import { collectionHref, withEnvHome } from "@/lib/utils";
import { splitVersion, versionName } from "@/lib/versions";

/**
 * A collection that isn't in this environment. Usually it just hasn't been
 * sent here yet, which is what the switcher lands on when you change
 * environments from a collection page, so say where it is instead of a bare
 * 404. When another version of it is here, offer that too: Development can
 * be a version ahead of Production.
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

  return (
    <div className="sx-page">
      <div className="ffx-panel p-[var(--ffx-panel-pad)] max-w-xl">
        <h1 className="font-display text-head font-semibold tracking-[-0.015em]">
          {found.length ? `${collection} isn't in ${here} yet` : "Not found"}
        </h1>
        <p className="mt-1 text-small text-ink-mut">
          {found.length
            ? `It's in ${found.map((k) => envMeta(k).label).join(" and ")}. A collection reaches ${here} when it's approved in the environment before it.`
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
