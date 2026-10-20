import { NextResponse } from "next/server";
import { isCatalogAsset } from "@/lib/catalog";
import { previewParquet } from "@/lib/parquet";
import { awsLooksConfigured, isUnderCwd, NotFound, parseRef } from "@/lib/storage";

/**
 * The first rows of a parquet asset, for the preview under an asset card.
 * Like the asset route, it only reads hrefs some catalog's assets carry.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const href = url.searchParams.get("href");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  if (!href) return NextResponse.json({ error: "href is required" }, { status: 400 });
  if (!(await isCatalogAsset(href))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ref = parseRef(href);
  if (ref.kind === "s3" && !awsLooksConfigured()) {
    return NextResponse.json({ error: "No AWS credentials on the server." }, { status: 503 });
  }
  if (ref.kind === "file" && !isUnderCwd(ref.path)) {
    return NextResponse.json({ error: "Local paths outside the app are not served." }, { status: 403 });
  }
  try {
    return NextResponse.json(await previewParquet(href, limit));
  } catch (e) {
    // The card puts "Could not read the file:" in front of this. S3's own
    // text stays in the log, since an access error names the account and role.
    if (e instanceof NotFound) return NextResponse.json({ error: "it isn't at that address." }, { status: 404 });
    console.error(`preview: couldn't read ${href}`, e);
    return NextResponse.json({ error: "the server log has the details." }, { status: 502 });
  }
}
