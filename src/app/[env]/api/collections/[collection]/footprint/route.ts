import { NextResponse } from "next/server";
import { getCollection } from "@/lib/catalog";
import { isEnv } from "@/lib/env";
import { footprintOf } from "@/lib/footprint";
import { mapArea } from "@/lib/map-area";

/**
 * A collection's footprint for the home map (lib/footprint.ts), for the
 * ones too heavy to send with the page. The console fetches it when the
 * collection is first picked or pointed at. The app's own, not STAC.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ env: string; collection: string }> }) {
  const { env, collection } = await params;
  if (!isEnv(env)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const c = await getCollection(env, decodeURIComponent(collection));
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const f = footprintOf(c, mapArea());
    return NextResponse.json({ type: "FeatureCollection", slug: f.slug, features: f.features });
  } catch (e) {
    console.error(`stac-x: ${c.id} couldn't be drawn on the home page:`, e);
    return NextResponse.json({ error: "the server log has the details." }, { status: 500 });
  }
}
