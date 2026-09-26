import { NextResponse } from "next/server";
import { getCollection } from "@/lib/catalog";

/** The collection as STAC JSON, with its items' links. */
export async function GET(req: Request, { params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  const c = await getCollection(decodeURIComponent(collection));
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const base = `/api/collections/${encodeURIComponent(c.id)}`;
  // ?download=1 saves the file instead of showing it in the tab.
  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers = download ? { "content-disposition": `attachment; filename="${c.id}.collection.json"` } : undefined;
  return NextResponse.json({
    type: "Collection",
    stac_version: "1.0.0",
    id: c.id,
    title: c.title,
    description: c.description ?? `Items of ${c.title}`,
    license: c.license ?? "proprietary",
    keywords: c.keywords,
    providers: c.providers,
    extent: {
      spatial: { bbox: c.bbox ? [c.bbox] : [] },
      temporal: { interval: [c.temporal] },
    },
    ...c.extra,
    "stac-x:sources": c.sources,
    "stac-x:item_count": c.itemCount,
    links: [
      { rel: "self", href: base, type: "application/json" },
      { rel: "root", href: "/", type: "text/html" },
      ...c.items.map((i) => ({ rel: "item", href: `${base}/items/${encodeURIComponent(i.id)}`, type: "application/geo+json" })),
    ],
  }, { headers });
}
