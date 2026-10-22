import { readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { isCatalogAsset } from "@/lib/catalog";
import { awsAvailable, isUnderCwd, parseRef, presign } from "@/lib/storage";

/**
 * Turns an asset href into something a browser can open. An s3:// href
 * becomes a redirect to a presigned GET, good for an hour; a local file is
 * served directly. Only hrefs some catalog's assets carry are served: the
 * presign uses the server's credentials, so anything else would hand out
 * whatever those credentials can read.
 */
export async function GET(request: Request) {
  const href = new URL(request.url).searchParams.get("href");
  if (!href) return NextResponse.json({ error: "href is required" }, { status: 400 });
  if (!(await isCatalogAsset(href))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ref = parseRef(href);
  if (ref.kind === "s3") {
    if (!(await awsAvailable())) {
      return NextResponse.json(
        { error: "No AWS credentials on the server, so private S3 objects cannot be fetched." },
        { status: 503 },
      );
    }
    try {
      return NextResponse.redirect(await presign(href), { status: 302 });
    } catch (e) {
      console.error(`asset: couldn't presign ${href}`, e);
      return NextResponse.json({ error: "Couldn't fetch this asset." }, { status: 502 });
    }
  }

  // Local files: only ones under the working directory, even if a catalog
  // points elsewhere.
  if (!isUnderCwd(ref.path)) {
    return NextResponse.json({ error: "Local paths outside the app are not served." }, { status: 403 });
  }
  const s = await stat(/*turbopackIgnore: true*/ ref.path).catch(() => null);
  if (!s?.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readFile(/*turbopackIgnore: true*/ ref.path);
  const type = contentType(ref.path);
  return new NextResponse(body, {
    headers: {
      "content-type": type,
      "content-length": String(s.size),
      "x-content-type-options": "nosniff",
      // Images show in the page; everything else downloads, so a stray HTML
      // or SVG file can't run on this origin.
      ...(type.startsWith("image/") ? {} : { "content-disposition": "attachment" }),
    },
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
