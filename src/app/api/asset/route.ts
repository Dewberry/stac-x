import { readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { awsLooksConfigured, parseRef, presign } from "@/lib/storage";

/**
 * Turns an asset href into something a browser can open. An s3:// href
 * becomes a redirect to a presigned GET, good for an hour; a local file is
 * served directly. Anything else is refused: the app only hands out what
 * the catalog points at.
 */
export async function GET(request: Request) {
  const href = new URL(request.url).searchParams.get("href");
  if (!href) return NextResponse.json({ error: "href is required" }, { status: 400 });

  const ref = parseRef(href);
  if (ref.kind === "s3") {
    if (!awsLooksConfigured()) {
      return NextResponse.json(
        { error: "No AWS credentials on the server, so private S3 objects cannot be fetched." },
        { status: 503 },
      );
    }
    try {
      return NextResponse.redirect(await presign(href), { status: 302 });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

  // Local files: only ones under the working directory, so a crafted href
  // can't read the rest of the disk.
  if (!ref.path.startsWith(process.cwd())) {
    return NextResponse.json({ error: "Local paths outside the app are not served." }, { status: 403 });
  }
  const s = await stat(/*turbopackIgnore: true*/ ref.path).catch(() => null);
  if (!s?.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readFile(/*turbopackIgnore: true*/ ref.path);
  return new NextResponse(body, {
    headers: { "content-type": contentType(ref.path), "content-length": String(s.size) },
  });
}

function contentType(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return (
    { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json", parquet: "application/x-parquet", pq: "application/x-parquet", csv: "text/csv" }[
      ext ?? ""
    ] ?? "application/octet-stream"
  );
}
