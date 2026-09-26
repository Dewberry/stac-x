import { NextResponse } from "next/server";
import { getItem } from "@/lib/catalog";
import { toStacJson } from "@/lib/stac";

/** The item as STAC JSON, with the QC edit folded into its properties. */
export async function GET(req: Request, { params }: { params: Promise<{ collection: string; item: string }> }) {
  const { collection, item } = await params;
  const i = await getItem(decodeURIComponent(collection), decodeURIComponent(item));
  if (!i) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // ?download=1 saves the file instead of showing it in the tab.
  const download = new URL(req.url).searchParams.get("download") === "1";
  return NextResponse.json(toStacJson(i), {
    headers: {
      "content-type": "application/geo+json",
      ...(download ? { "content-disposition": `attachment; filename="${i.id}.json"` } : {}),
    },
  });
}
