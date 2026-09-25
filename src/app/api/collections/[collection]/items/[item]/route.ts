import { NextResponse } from "next/server";
import { getItem } from "@/lib/catalog";
import { toStacJson } from "@/lib/stac";

/** The item as STAC JSON, with the QC edit folded into its properties. */
export async function GET(_req: Request, { params }: { params: Promise<{ collection: string; item: string }> }) {
  const { collection, item } = await params;
  const i = await getItem(decodeURIComponent(collection), decodeURIComponent(item));
  if (!i) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toStacJson(i), { headers: { "content-type": "application/geo+json" } });
}
