import { NextResponse } from "next/server";
import { getCollection } from "@/lib/catalog";
import { isEnv } from "@/lib/env";
import { dataFileOf } from "@/lib/data-file";
import { jsonRoute } from "@/lib/json-route";
import { ParquetUnreadable, previewParquet } from "@/lib/parquet";
import { baseName } from "@/lib/storage";

/**
 * The first rows of a collection's stac-geoparquet (lib/data-file.ts), for
 * the Data panel on its page and the dialog it opens: the file as it is,
 * one row per item, so a reviewer can see the columns the pipeline wrote
 * without opening it. Only the collection's own file is read, never a
 * caller's href; the asset preview route is for that.
 */
export const GET = jsonRoute("data", async (req: Request, { params }: { params: Promise<{ env: string; collection: string }> }) => {
  const { env, collection } = await params;
  if (!isEnv(env)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The id comes from Next already decoded.
  const c = await getCollection(env, collection);
  const source = c && dataFileOf(c);
  if (!c || !source) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 5) || 5));
  try {
    const preview = await previewParquet(source, limit);
    return NextResponse.json({ ...preview, source: baseName(source) });
  } catch (e) {
    // The panel puts "Couldn't read the file:" in front of this. Why a
    // parquet file can't be read is in this app's own words, so it's said.
    // S3's own text stays in the log, since an access error names the
    // account and role.
    if (e instanceof ParquetUnreadable) {
      return NextResponse.json({ error: e.message.charAt(0).toLowerCase() + e.message.slice(1) }, { status: 422 });
    }
    console.error(`data: couldn't read ${source}`, e);
    return NextResponse.json({ error: "the server log has the details." }, { status: 502 });
  }
});
