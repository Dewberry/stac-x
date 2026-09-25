import { NextResponse } from "next/server";
import { previewParquet } from "@/lib/parquet";
import { awsLooksConfigured, parseRef } from "@/lib/storage";

/** The first rows of a parquet asset, for the preview under an asset card. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const href = url.searchParams.get("href");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  if (!href) return NextResponse.json({ error: "href is required" }, { status: 400 });
  const ref = parseRef(href);
  if (ref.kind === "s3" && !awsLooksConfigured()) {
    return NextResponse.json({ error: "No AWS credentials on the server." }, { status: 503 });
  }
  if (ref.kind === "file" && !ref.path.startsWith(process.cwd())) {
    return NextResponse.json({ error: "Local paths outside the app are not served." }, { status: 403 });
  }
  try {
    return NextResponse.json(await previewParquet(href, limit));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
