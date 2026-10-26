import { NextResponse } from "next/server";
import { getCollection } from "@/lib/catalog";
import { isEnv } from "@/lib/env";
import { attachment, collectionJsonHref, withBase, withEnvHome } from "@/lib/utils";
import { qcFields, VERSION_SCHEMA } from "@/lib/stac";
import { versionName } from "@/lib/versions";

/** The collection as STAC JSON, with its items' links. */
export async function GET(req: Request, { params }: { params: Promise<{ env: string; collection: string }> }) {
  const { env, collection } = await params;
  if (!isEnv(env)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const c = await getCollection(env, decodeURIComponent(collection));
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const base = collectionJsonHref(env, c.id);
  // ?download=1 saves the file instead of showing it in the tab.
  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers = download ? { "content-disposition": attachment(`${c.id}.collection.json`) } : undefined;

  // The Version extension, from the series rather than the source links, so
  // the links point at this app and work for versions told apart by id alone.
  const { versions, latest } = c.series;
  const at = versions.findIndex((v) => v.id === c.id);
  const here = versions[at];
  const versioned = versions.length > 1 || c.version !== null || c.deprecated;
  const link = (rel: string, id: string) => {
    const v = versions.find((x) => x.id === id);
    return { rel, href: collectionJsonHref(env, id), type: "application/json", title: versionName(v?.label ?? null) };
  };
  const versionLinks =
    versions.length > 1
      ? [
          ...(latest !== c.id ? [link("latest-version", latest)] : []),
          ...(at > 0 ? [link("predecessor-version", versions[at - 1].id)] : []),
          ...(at >= 0 && at < versions.length - 1 ? [link("successor-version", versions[at + 1].id)] : []),
        ]
      : [];

  return NextResponse.json({
    type: c.type,
    stac_version: "1.0.0",
    ...(versioned ? { stac_extensions: [VERSION_SCHEMA] } : {}),
    id: c.stacId,
    title: c.sourceTitle ?? c.stacId,
    description: c.description ?? `Items of ${c.title}`,
    license: c.license ?? "proprietary",
    keywords: c.keywords,
    providers: c.providers,
    // A catalog's extent is the generator's placeholder; it's never passed on.
    ...(c.kind === "dataset" ? { extent: { spatial: { bbox: c.bbox ? [c.bbox] : [] }, temporal: { interval: [c.temporal] } } } : {}),
    ...c.extra,
    ...(versioned ? { version: here?.label ?? c.version, deprecated: c.deprecated } : {}),
    ...(c.experimental ? { experimental: true } : {}),
    // A catalog has no review state; a pending one would say it waits for review.
    ...(c.kind === "dataset" ? qcFields(c.qc) : {}),
    "stac-x:environment": env,
    "stac-x:sources": c.sources,
    "stac-x:item_count": c.itemCount,
    links: [
      { rel: "self", href: base, type: "application/json" },
      { rel: "root", href: withBase(withEnvHome(env)), type: "text/html" },
      ...versionLinks,
      ...c.items.map((i) => ({ rel: "item", href: `${base}/items/${encodeURIComponent(i.id)}`, type: "application/geo+json" })),
    ],
    ...(Object.keys(c.assets).length ? { assets: c.assets } : {}),
  }, { headers });
}
