import { NextResponse } from "next/server";
import { getCollection } from "@/lib/catalog";
import { isEnv } from "@/lib/env";
import { listItemRows } from "@/lib/item-rows";
import { jsonRoute } from "@/lib/json-route";

/**
 * A collection's items as the home page lists them: id, name, kind, swatch
 * and dates, nothing more. This is the app's own list for the home console,
 * which fetches it when a collection is picked, not STAC; the STAC JSON is
 * one level up.
 *
 * Items whose geometry can't be sorted into shapes (a kind the reader let
 * through) are still listed, without swatches; see listItemRows.
 */
export const GET = jsonRoute("rows", async (_req: Request, { params }: { params: Promise<{ env: string; collection: string }> }) => {
  const { env, collection } = await params;
  if (!isEnv(env)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const c = await getCollection(env, collection);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ id: c.id, rows: listItemRows(c).rows });
});
