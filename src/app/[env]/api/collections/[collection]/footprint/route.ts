import { NextResponse } from "next/server";
import { getCollection } from "@/lib/catalog";
import { isEnv } from "@/lib/env";
import { footprintOf } from "@/lib/footprint";
import { itemFeaturesOf } from "@/lib/item-features";
import { listItemRows } from "@/lib/item-rows";
import { jsonRoute } from "@/lib/json-route";
import { mapArea } from "@/lib/map-area";

/**
 * A collection's geometry for a map, for the collections too heavy to send
 * with a page. The app's own, not STAC.
 *
 * Asked plainly, it's the footprint the home map draws (lib/footprint.ts):
 * the console fetches it when the collection is first picked or pointed at.
 * With `?items=1` it's every item as its own feature, the way the
 * collection's own page draws them (lib/item-features.ts), which that page
 * fetches when they're past what it sends along.
 *
 * The id comes from Next already decoded.
 */
export const GET = jsonRoute("footprint", async (req: Request, { params }: { params: Promise<{ env: string; collection: string }> }) => {
  const { env, collection } = await params;
  if (!isEnv(env)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const c = await getCollection(env, collection);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (new URL(req.url).searchParams.get("items") === "1") {
    // Geometry that couldn't be read, or can't be sorted into shapes, isn't
    // drawn at all; the page says why.
    const { rows, shapesFailed } = listItemRows(c);
    const features = c.geometryErrors > 0 || shapesFailed ? [] : itemFeaturesOf(env, c, rows);
    return NextResponse.json({ type: "FeatureCollection", features });
  }
  try {
    const f = footprintOf(c, mapArea());
    return NextResponse.json({ type: "FeatureCollection", slug: f.slug, features: f.features });
  } catch (e) {
    console.error(`stac-x: ${c.id} couldn't be drawn on the home page:`, e);
    return NextResponse.json({ error: "the server log has the details." }, { status: 500 });
  }
});
