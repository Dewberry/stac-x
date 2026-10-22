import { NextResponse } from "next/server";
import { isCatalogAsset } from "@/lib/catalog";
import { fmtBytes, isCsvType, isJsonType, isParquetType } from "@/lib/format";
import { previewParquet } from "@/lib/parquet";
import { previewCsv, previewJson, TooBig } from "@/lib/text-preview";
import { awsAvailable, isUnderCwd, NotFound, parseRef } from "@/lib/storage";

/**
 * A look inside an asset, for the preview dialog behind an asset row: the
 * first rows of a parquet or CSV file, or a JSON file as rows where it has
 * them and as a document where it doesn't. Like the asset route, it only
 * reads hrefs some catalog's assets carry. At most 100 rows: it's a look at
 * the file, not a way to read it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const href = url.searchParams.get("href");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
  if (!href) return NextResponse.json({ error: "href is required" }, { status: 400 });
  if (!(await isCatalogAsset(href))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ref = parseRef(href);
  if (ref.kind === "s3" && !(await awsAvailable())) {
    return NextResponse.json({ error: "No AWS credentials on the server." }, { status: 503 });
  }
  if (ref.kind === "file" && !isUnderCwd(ref.path)) {
    return NextResponse.json({ error: "Local paths outside the app are not served." }, { status: 403 });
  }
  const reader = isParquetType(null, href) ? previewParquet : isCsvType(null, href) ? previewCsv : isJsonType(null, href) ? previewJson : null;
  if (!reader) return NextResponse.json({ error: "this kind of file has no preview." }, { status: 415 });
  try {
    return NextResponse.json(await reader(href, limit));
  } catch (e) {
    // The dialog puts "Couldn't read the file:" in front of this. S3's own
    // text stays in the log, since an access error names the account and role.
    if (e instanceof NotFound) return NextResponse.json({ error: "it isn't at that address." }, { status: 404 });
    if (e instanceof TooBig) return NextResponse.json({ error: `at ${fmtBytes(e.byteLength)} it's too big to show here. Download it instead.` }, { status: 413 });
    if (e instanceof SyntaxError) return NextResponse.json({ error: "it isn't valid JSON." }, { status: 422 });
    console.error(`preview: couldn't read ${href}`, e);
    return NextResponse.json({ error: "the server log has the details." }, { status: 502 });
  }
}
