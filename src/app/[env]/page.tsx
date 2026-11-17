import { cookies } from "next/headers";
import { HomeConsole } from "@/components/home";
import type { EnvKey } from "@/lib/env";
import { homeData } from "@/lib/home-data";
import { mapArea } from "@/lib/map-area";
import { pageEnv } from "@/lib/page-env";
import { RAIL_COOKIE, railShare } from "@/lib/rail-share";

export const dynamic = "force-dynamic";

/**
 * The landing page: where the catalog's collections are, on one map that
 * opens on the deployment's area (lib/map-area.ts) or, with none set, on
 * everything the collections cover. lib/home-data.ts works out what it
 * shows.
 *
 * The page never waits on that. The console goes out at once with the map
 * on the area and the rail saying its collections are loading, and the
 * collections follow in the same response when they're ready, which from
 * S3, or after a refresh found new files, can be seconds. When they're
 * already in memory they go out with the page and there's no loading
 * state at all.
 */

/** What the rail says when an environment has nothing in it yet. */
const EMPTY: Record<EnvKey, string> = {
  sandbox: "Collections show up here once they land in the Sandbox catalog.",
  dev: "Collections show up here once they land in the Development catalog.",
  test: "Collections show up here once they're approved in Development.",
  prod: "Collections show up here once they're approved in Test.",
};

export default async function Home({ params }: { params: Promise<{ env: string }> }) {
  const env = await pageEnv(params);
  const rail = railShare((await cookies()).get(RAIL_COOKIE)?.value);
  const area = mapArea();
  const { ready, pending } = homeData(env);
  return (
    <HomeConsole
      env={env}
      data={ready ?? pending}
      area={area && { name: area.name, geometry: area.geometry }}
      // With an area set the map opens on it, whatever the catalog holds.
      // Without one, where it opens depends on the collections.
      frame={area?.bbox ?? null}
      emptyText={EMPTY[env]}
      railShare={rail}
    />
  );
}
