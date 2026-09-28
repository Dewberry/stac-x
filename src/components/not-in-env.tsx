import Link from "next/link";
import { getCollection } from "@/lib/catalog";
import { ENVS, envMeta, type EnvKey } from "@/lib/env";
import { collectionHref, withEnvHome } from "@/lib/utils";

/**
 * A collection that isn't in this environment. Usually it just hasn't been
 * sent here yet, which is what the switcher lands on when you change
 * environments from a collection page, so say where it is instead of a bare
 * 404.
 */
export async function NotInEnv({ env, collection }: { env: EnvKey; collection: string }) {
  const found = (
    await Promise.all(ENVS.filter((e) => e.key !== env).map(async (e) => ((await getCollection(e.key, collection)) ? e.key : null)))
  ).filter((k): k is EnvKey => k !== null);
  const here = envMeta(env).label;

  return (
    <div className="sx-page">
      <div className="ffx-panel p-[var(--ffx-panel-pad)] max-w-xl">
        <h1 className="text-head font-semibold">
          {found.length ? `${collection} isn't in ${here} yet` : "Not found"}
        </h1>
        <p className="mt-1 text-small text-ink-mut">
          {found.length
            ? `It's in ${found.map((k) => envMeta(k).label).join(" and ")}. A collection reaches ${here} when it's approved in the environment before it.`
            : "No collection by that id is in any environment. It may have been renamed in the bucket, or the file that held it may no longer be listed."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
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
