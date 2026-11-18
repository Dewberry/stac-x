import { NextResponse } from "next/server";
import { BUILD } from "@/lib/build";

/**
 * The build the server is running right now (lib/build.ts). An open tab
 * asks this to find out whether the app has been deployed since the tab
 * loaded, and after a deployment it's the quickest check of what's live:
 *
 *   curl https://<host>/stac/api/version
 *
 * Like the health check it sits outside the environments and needs no
 * session, so src/proxy.ts leaves it alone.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: BUILD.version, commit: BUILD.commit || null, builtAt: BUILD.builtAt || null },
    { headers: { "cache-control": "no-store" } },
  );
}
