import { NextResponse } from "next/server";
import { getItem } from "@/lib/catalog";
import { isEnv } from "@/lib/env";
import { toStacJson } from "@/lib/stac";
import { attachment } from "@/lib/utils";

/** The item as STAC JSON. */
export async function GET(req: Request, { params }: { params: Promise<{ env: string; collection: string; item: string }> }) {
  const { env, collection, item } = await params;
  if (!isEnv(env)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const i = await getItem(env, decodeURIComponent(collection), decodeURIComponent(item));
  if (!i) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // ?download=1 saves the file instead of showing it in the tab.
  const download = new URL(req.url).searchParams.get("download") === "1";
  return NextResponse.json(toStacJson(i), {
    headers: {
      "content-type": "application/geo+json",
      ...(download ? { "content-disposition": attachment(`${i.id}.json`) } : {}),
    },
  });
}
