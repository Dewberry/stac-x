/**
 * Decodes one parquet file in a process of its own (see decode in
 * lib/parquet.ts, which starts it and says why).
 *
 * This file is run by Node as it is, not bundled, so it's plain JavaScript
 * and imports only Node and the two parquet packages. next.config.ts copies
 * it into the standalone build. It decodes and hands back rows; turning
 * rows into STAC items or a preview stays in parquet.ts.
 *
 * What it's told, as JSON in its one argument:
 *   byteLength     the file's size
 *   rowEnd         stop after this many rows (a preview); all of them if
 *                  unset, and none, just the schema, if zero
 *   requireColumn  a column the file must have; without it no rows are read
 *
 * It never opens the file. It asks its parent for the byte ranges it needs,
 * so it needs no credentials and no S3 client of its own.
 *
 * What it says to its parent:
 *   { type: "range", id, start, end }   send these bytes, please; the
 *       answer is { id, bytes } or { id, error }
 *   { type: "shape", rows, columns, widest }   how big the file is, sent
 *       before any row is decoded, so that if the decode runs out of memory
 *       the parent can still say what the file looked like
 *   { type: "done", schema, keyValue, totalRows, rows, missing }
 *   { type: "error", message }
 */
import { parquetMetadataAsync, parquetReadObjects, parquetSchema } from "hyparquet";
import { compressors } from "hyparquet-compressors";

/** A column and everything under it, counted as the columns parquet stores. */
function leaves(node) {
  return node.children.length ? node.children.reduce((n, child) => n + leaves(child), 0) : 1;
}

async function run(say, { byteLength, rowEnd, requireColumn }) {
  let nextId = 0;
  const waiting = new Map();
  process.on("message", (m) => {
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.error) w.reject(new Error(m.error));
    // Its own buffer, exactly the range: what arrives is a view onto the message.
    else w.resolve(m.bytes.buffer.slice(m.bytes.byteOffset, m.bytes.byteOffset + m.bytes.byteLength));
  });
  const file = {
    byteLength,
    slice: (start, end = byteLength) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        say({ type: "range", id, start, end });
      }),
  };

  const metadata = await parquetMetadataAsync(file);
  const schema = parquetSchema(metadata);
  const totalRows = Number(metadata.num_rows);
  const widest = schema.children
    .filter((c) => c.children.length)
    .map((c) => ({ name: c.element.name, fields: c.children.length, columns: leaves(c) }))
    .sort((a, b) => b.columns - a.columns)[0];
  say({ type: "shape", rows: totalRows, columns: leaves(schema), widest: widest ?? null });

  const keyValue = {};
  for (const kv of metadata.key_value_metadata ?? []) {
    if ((kv.key === "geo" || kv.key === "stac-geoparquet") && typeof kv.value === "string") keyValue[kv.key] = kv.value;
  }
  const done = { type: "done", schema: metadata.schema, keyValue, totalRows, rows: [], missing: false };
  if (requireColumn && !schema.children.some((c) => c.element.name === requireColumn)) return { ...done, missing: true };
  // Asked for the schema alone.
  if (rowEnd === 0) return done;

  // Bytes stay bytes (utf8: false) so a geometry column the "geo" metadata
  // doesn't mark can be decoded as WKB instead of read as text.
  done.rows = await parquetReadObjects({
    file,
    metadata,
    compressors,
    rowFormat: "object",
    utf8: false,
    ...(rowEnd === undefined ? {} : { rowStart: 0, rowEnd: Math.min(rowEnd, totalRows) }),
  });
  // A file whose items each name their assets differently has every name
  // on every row, nearly all of them null. Only a row's own are assets, so
  // the rest aren't sent back.
  if (requireColumn === "id") {
    for (const row of done.rows) {
      const assets = row.assets;
      if (!assets || typeof assets !== "object" || ArrayBuffer.isView(assets)) continue;
      for (const name of Object.keys(assets)) if (assets[name] === null || assets[name] === undefined) delete assets[name];
    }
  }
  return done;
}

// Run on its own, with no parent to talk to, it does nothing. The Docker
// build does that to check the file and its packages made it into the image.
if (process.send) {
  const say = (message) => process.send(message);
  run(say, JSON.parse(process.argv[2]))
    .catch((e) => ({ type: "error", message: e instanceof Error ? e.message : String(e) }))
    // Disconnecting once the last message is out lets the process end.
    .then((last) => process.send(last, () => process.disconnect()));
}
