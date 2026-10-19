import { NextResponse } from "next/server";
import { getCollection } from "@/lib/catalog";
import { isEnv } from "@/lib/env";
import { itemRowsOf } from "@/lib/item-rows";

/**
 * A collection's items as the home page lists them: id, name, kind, swatch
 * and dates, nothing more. This is the app's own list for the home console,
 * which fetches it when a collection is picked, not STAC; the STAC JSON is
 * one level up.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ env: string; collection: string }> }) {
  const { env, collection } = await params;
  if (!isEnv(env)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const c = await getCollection(env, decodeURIComponent(collection));
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ id: c.id, rows: itemRowsOf(c) });
}
