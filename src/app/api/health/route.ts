import { NextResponse } from "next/server";

/**
 * Whether the server is up, for a container health check or a load
 * balancer. It answers without touching the catalog or S3: a slow bucket
 * is a reason for pages to wait, not for the server to be restarted.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
