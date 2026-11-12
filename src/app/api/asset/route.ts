import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { isCatalogDownload } from "@/lib/catalog";
import { jsonRoute } from "@/lib/json-route";
import { awsAvailable, isUnderCwd, parseRef, presign } from "@/lib/storage";

/**
 * Turns an asset href into something a browser can open. An s3:// href
 * becomes a redirect to a presigned GET, good for an hour; a local file is
 * served directly. Only hrefs some catalog's assets carry are served, and
 * those of the links its pages list as additional resources: the presign
 * uses the server's credentials, so anything else would hand out whatever
 * those credentials can read.
 *
 * A local file is streamed from the disk, never read whole: an asset can be
 * a terrain model of several gigabytes, which would be held in the server's
 * memory for every download at once, and past 2 GB couldn't be read that
 * way at all. Whatever stops the file being opened is answered in JSON,
 * like every other refusal here.
 */
export const GET = jsonRoute("asset", async (request: Request) => {
  const href = new URL(request.url).searchParams.get("href");
  if (!href) return NextResponse.json({ error: "href is required" }, { status: 400 });
  if (!(await isCatalogDownload(href))) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
  // Opened before anything is sent, so a file that's gone or can't be read
  // is still an answer with a status and a reason. Once the stream starts
  // the headers are out, and a read that fails after that ends the download.
  let file: FileHandle | null = null;
  try {
    file = await open(/*turbopackIgnore: true*/ ref.path, "r");
    const s = await file.stat();
    if (!s.isFile()) {
      await file.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const type = contentType(ref.path);
    // The stream closes the file when it ends, fails, or the browser goes away.
    const body = Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>;
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
  } catch (e) {
    await file?.close().catch(() => {});
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "Not found" }, { status: 404 });
    // The disk's own text names server paths, so it stays in the log.
    console.error(`asset: couldn't read ${href}`, e);
    return NextResponse.json({ error: "Couldn't read this asset." }, { status: 500 });
  }
});

function contentType(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return (
    { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json", parquet: "application/x-parquet", pq: "application/x-parquet", csv: "text/csv" }[
      ext ?? ""
    ] ?? "application/octet-stream"
  );
}
