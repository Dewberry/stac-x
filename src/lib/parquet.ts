import "server-only";

import { fork } from "node:child_process";
import { join } from "node:path";
import { parquetSchema, toJson } from "hyparquet";
import type { FileMetaData, SchemaElement, SchemaTree } from "hyparquet";
import { wkbToGeojson } from "hyparquet/src/wkb.js";
import type { Geometry } from "geojson";
import { parquetLimits } from "./config";
import type { ColumnKind, TablePreview } from "./data-preview";
import { fmtBytes, fmtNum } from "./format";
import { tidyAsset, type StacAsset, type StacItem, type StacLink } from "./stac";
import { head, NotFound, read, readRange } from "./storage";

/**
 * stac-geoparquet in, STAC items out.
 *
 * hyparquet reads the file in pure JS, decodes the WKB geometry column into
 * GeoJSON on its own once it sees the "geo" metadata, and hands back one object
 * per row. The mapping back to STAC follows the stac-geoparquet spec: the
 * fields STAC defines at the top level stay there, bbox comes back from a
 * struct to an array, and every other column is an item property.
 *
 * Not every file follows the spec. One written from a pandas frame of items
 * keeps bbox, links, assets and properties as JSON text, and its geometry as
 * WKB bytes with no "geo" metadata to say so. Those are read too: JSON text
 * in a STAC column is parsed, a `properties` column is unpacked into the
 * properties, and bare WKB is decoded here. A geometry that still isn't
 * GeoJSON after that is dropped (the item keeps its bbox) rather than handed
 * to the map, where it would take the page down.
 *
 * The decoding itself happens in another process (decode, below), because
 * what a file costs to decode can't be told from its size, and running out
 * of memory isn't an error a server can catch.
 */

const TOP_LEVEL = new Set([
  "type",
  "stac_version",
  "stac_extensions",
  "id",
  "collection",
  "geometry",
  "bbox",
  "links",
  "assets",
]);

export type ParquetStac = {
  items: StacItem[];
  /** Collection objects the file carries in its own metadata, by id. */
  collections: Record<string, Record<string, unknown>>;
  etag: string;
};

/**
 * A parquet file that isn't stac-geoparquet: a data table an asset points
 * at, sitting under a prefix that's listed as a source. It has no `id`
 * column, so its rows aren't items.
 */
export class NotStac extends Error {
  constructor(uri: string) {
    super(`${uri} isn't stac-geoparquet (it has no id column)`);
    this.name = "NotStac";
  }
}

/**
 * A parquet file that's there but can't be read: too big to load, more
 * than a decode is allowed to cost, or not valid parquet. The message is
 * in this app's own words (or the parquet reader's), so unlike an S3
 * error it's safe to show on a page.
 */
export class ParquetUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParquetUnreadable";
  }
}

/* ------------------------------------------------------- decoding */

/** What the worker says about a file before it decodes any rows. */
type Shape = { rows: number; columns: number; widest: { name: string; fields: number; columns: number } | null };

type Decoded = {
  schema: SchemaElement[];
  keyValue: { geo?: string; "stac-geoparquet"?: string };
  totalRows: number;
  rows: Record<string, unknown>[];
  /** The file lacks the column that was required, so no rows were read. */
  missing: boolean;
};

type FromWorker =
  | { type: "range"; id: number; start: number; end: number }
  | ({ type: "shape" } & Shape)
  | ({ type: "done" } & Decoded)
  | { type: "error"; message: string };

type DecodeJob = {
  uri: string;
  byteLength: number;
  /** The whole file, when it's already in hand; otherwise it's read by byte range as the worker asks. */
  bytes?: Uint8Array;
  /** Stop after this many rows. Zero reads the schema alone. */
  rowEnd?: number;
  requireColumn?: string;
};

// Run as a file, not bundled; next.config.ts copies it into the standalone build.
const WORKER = join(/*turbopackIgnore: true*/ process.cwd(), "src", "lib", "parquet-worker.mjs");

/** Two decodes at a time; the rest wait their turn (see parquetLimits). */
const CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running < CONCURRENT) running++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    // A waiting decode takes this one's place; the count only drops when nothing is waiting.
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

/**
 * Decode a parquet file in a process of its own, with a cap on its memory
 * and its time.
 *
 * What a parquet file costs to decode can't be told from its size. One
 * 2.7 MB items file, whose 898 items each named their one asset
 * differently, had 6,549 columns and took more than a gigabyte to decode.
 * Decoded in the server's own process, a file like that runs it out of
 * memory, and that isn't an error that can be caught: the server dies, and
 * since the catalog is read at boot it dies again on every restart. In a
 * process of its own the same file ends that process, the dataset says
 * why, and every other page carries on.
 *
 * A worker thread with a memory limit looks like the lighter way to do
 * this and isn't one: past its limit Node usually ends the thread, but
 * some allocations end the whole process instead (this same file did, at
 * a 512 MB limit). A process is the boundary the operating system keeps.
 */
function decode(job: DecodeJob): Promise<Decoded> {
  const { memoryMb, timeoutMs } = parquetLimits;
  return inTurn(
    () =>
      new Promise<Decoded>((resolve, reject) => {
        let shape: Shape | null = null;
        // A byte range that couldn't be read (S3 said no, the file went
        // away) is what the caller should hear about, as the error it was.
        let rangeError: unknown = null;
        let stderr = "";
        let settled = false;
        // The worker needs nothing from the environment, and mustn't pick
        // up Node options meant for the server (a debugger port, a heap size).
        const env = { ...process.env };
        delete env.NODE_OPTIONS;
        const worker = fork(
          /*turbopackIgnore: true*/ WORKER,
          [JSON.stringify({ byteLength: job.byteLength, rowEnd: job.rowEnd, requireColumn: job.requireColumn })],
          // "advanced" carries bytes, dates and big integers across as what they are.
          { execArgv: [`--max-old-space-size=${memoryMb}`], serialization: "advanced", stdio: ["ignore", "ignore", "pipe", "ipc"], env },
        );
        const settle = (done: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          done();
        };
        const timer = setTimeout(() => {
          settle(() => reject(new ParquetUnreadable(`Reading it took longer than the ${fmtNum(timeoutMs / 1000)} seconds a file is allowed (STAC_PARQUET_TIMEOUT_SECONDS).`)));
          worker.kill("SIGKILL");
        }, timeoutMs);
        worker.stderr?.on("data", (chunk: Buffer) => {
          if (stderr.length < 65536) stderr += chunk.toString();
        });
        worker.on("message", (m: FromWorker) => {
          if (m.type === "range") {
            const sent = job.bytes
              ? Promise.resolve(job.bytes.subarray(m.start, m.end))
              : readRange(job.uri, m.start, m.end).then((buffer) => new Uint8Array(buffer));
            sent.then(
              (bytes) => worker.connected && worker.send({ id: m.id, bytes }),
              (e) => {
                rangeError = e;
                if (worker.connected) worker.send({ id: m.id, error: "a byte range couldn't be read" });
              },
            );
          } else if (m.type === "shape") {
            shape = { rows: m.rows, columns: m.columns, widest: m.widest };
          } else if (m.type === "done") {
            settle(() => resolve(m));
          } else {
            settle(() => reject(rangeError ?? new ParquetUnreadable(`It isn't parquet this app can read: ${m.message}.`)));
          }
        });
        worker.on("error", (e) => {
          settle(() => reject(new ParquetUnreadable(`The parquet reader couldn't be started: ${e.message}.`)));
        });
        worker.on("exit", (code, signal) => {
          settle(() => {
            // Out of memory, by its own account or the kernel's (which just kills it).
            if (/out of memory|heap limit|allocation failed/i.test(stderr) || signal === "SIGKILL") {
              reject(new ParquetUnreadable(outOfMemory(shape, memoryMb)));
              return;
            }
            // Anything else is this app's fault, not the file's: the log gets what the worker said.
            console.error(`stac-x: the parquet reader stopped on ${job.uri} (${signal ?? `exit code ${code}`}):\n${stderr.trim()}`);
            reject(new ParquetUnreadable(`The parquet reader stopped before it finished (${signal ?? `exit code ${code}`}). The server log has the details.`));
          });
        });
      }),
  );
}

/** Why a file ran out of memory, with what it looked like if the worker got far enough to say. */
function outOfMemory(shape: Shape | null, memoryMb: number): string {
  const limit = `Reading it needed more than the ${fmtNum(memoryMb)} MB a file is allowed (STAC_PARQUET_MEMORY_MB).`;
  if (!shape) return limit;
  const size = `It has ${fmtNum(shape.rows)} ${shape.rows === 1 ? "row" : "rows"} and ${fmtNum(shape.columns)} columns`;
  const wide = shape.widest;
  if (!wide || wide.fields <= 100) return `${limit} ${size}.`;
  const under = `${size}, ${fmtNum(wide.columns)} of them under "${wide.name}", which has ${fmtNum(wide.fields)} fields.`;
  // The usual way to a file this wide, and the way out of it.
  const why =
    wide.name === "assets"
      ? " A file gets this wide when each item names its assets differently; using the same asset key on every item keeps it small."
      : "";
  return `${limit} ${under}${why}`;
}

/** The top-level columns, from the schema the worker sent back. */
function columnsOf(schema: SchemaElement[]): SchemaTree[] {
  return parquetSchema({ schema } as FileMetaData).children;
}

/* ------------------------------------------------------- items */

/** An items file up to this size is fetched in one request; past it, by byte range. */
const HELD_WHOLE = 16 * 1024 * 1024;

export async function readItems(uri: string): Promise<ParquetStac> {
  const h = await head(uri);
  if (!h) throw new NotFound(uri);
  const { maxFileMb } = parquetLimits;
  if (h.size > maxFileMb * 1024 * 1024) {
    // Too big to hold. Its schema is still read, by byte range, to tell a
    // data table sitting among the sources (skipped, as ever) from an
    // items file that's too big to load (an error on its dataset).
    const peek = await decode({ uri, byteLength: h.size, rowEnd: 0, requireColumn: "id" });
    if (peek.missing) throw new NotStac(uri);
    throw new ParquetUnreadable(`At ${fmtBytes(h.size)} it's over the ${fmtNum(maxFileMb)} MB an items file may be (STAC_PARQUET_MAX_MB).`);
  }
  // A file of ordinary size is fetched once and handed over from memory;
  // a big one is read by byte range, so it's never held here whole.
  const whole = h.size <= HELD_WHOLE ? await read(uri) : null;
  const decoded = await decode({
    uri,
    byteLength: whole ? whole.bytes.byteLength : h.size,
    bytes: whole?.bytes,
    requireColumn: "id",
  });
  const etag = whole?.etag ?? h.etag;
  if (decoded.missing) throw new NotStac(uri);
  // Byte columns with no type came back as bytes, so a geometry column the
  // "geo" metadata doesn't mark can be decoded instead of read as text.
  // Any other such column is text, as hyparquet would have read it.
  const bytesAsText = new Set(
    columnsOf(decoded.schema)
      .filter((c) => c.element.type === "BYTE_ARRAY" && !c.element.logical_type && !c.element.converted_type && c.element.name !== "geometry")
      .map((c) => c.element.name),
  );
  const fallbackCollection = uri.split("/").pop()?.replace(/\.(geo)?parquet$|\.pq$/i, "") ?? "items";
  return {
    items: decoded.rows.map((row) => rowToItem(row, fallbackCollection, bytesAsText)),
    collections: embeddedCollections(decoded.keyValue["stac-geoparquet"]),
    etag,
  };
}

/**
 * stac-geoparquet 1.1 keeps the collections a file holds in its key-value
 * metadata, under "stac-geoparquet": a map of id to Collection, or a single
 * "collection" in files written before 1.1. Most files don't have either.
 */
function embeddedCollections(raw: string | undefined): ParquetStac["collections"] {
  if (!raw) return {};
  let meta: unknown;
  try {
    meta = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!meta || typeof meta !== "object") return {};
  const { collections, collection } = meta as { collections?: unknown; collection?: unknown };
  const out: ParquetStac["collections"] = {};
  if (collections && typeof collections === "object") {
    for (const [id, doc] of Object.entries(collections)) {
      if (doc && typeof doc === "object") out[id] = doc as Record<string, unknown>;
    }
  }
  if (collection && typeof collection === "object") {
    const doc = collection as Record<string, unknown>;
    if (typeof doc.id === "string" && !out[doc.id]) out[doc.id] = doc;
  }
  return out;
}

function rowToItem(row: Record<string, unknown>, fallbackCollection: string, bytesAsText: Set<string>): StacItem {
  const properties: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(row)) {
    if (TOP_LEVEL.has(k)) continue;
    const v = bytesAsText.has(k) && raw instanceof Uint8Array ? text(raw) : raw;
    // A `properties` column holds what the spec flattens into columns.
    if (k === "properties") {
      const nested = unpack(v);
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        for (const [pk, pv] of Object.entries(nested)) properties[pk] = plain(pv);
        continue;
      }
    }
    properties[k] = plain(v);
  }
  const links = unpack(row.links);
  const extensions = unpack(row.stac_extensions);
  const geometry = toGeometry(row.geometry);
  return {
    type: "Feature",
    stac_version: String(row.stac_version ?? "1.0.0"),
    stac_extensions: Array.isArray(extensions) ? extensions.filter((x): x is string => typeof x === "string") : [],
    id: String(row.id),
    collection: typeof row.collection === "string" && row.collection ? row.collection : fallbackCollection,
    geometry: geometry.value,
    ...(geometry.error ? { geometryError: geometry.error } : {}),
    bbox: toBbox(unpack(row.bbox)),
    properties,
    links: Array.isArray(links)
      ? (links as (StacLink | null)[]).filter((l): l is StacLink => !!l && typeof l === "object").map(dropNulls)
      : [],
    assets: toAssets(unpack(row.assets)),
  };
}

/** A STAC field a writer stored as JSON text, parsed; anything else as it was. */
function unpack(v: unknown): unknown {
  if (v instanceof Uint8Array) v = text(v);
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!(s.startsWith("{") || s.startsWith("["))) return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

const GEOMETRY_TYPES = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"]);

/**
 * The row's geometry as GeoJSON: what hyparquet decoded, or WKB bytes the
 * file didn't label, or GeoJSON text. A row with no geometry is fine; one
 * whose geometry is there but can't be read says why, so the collection
 * can say so on its page.
 */
export function toGeometry(v: unknown): { value: Geometry | null; error: string | null } {
  if (v === null || v === undefined) return { value: null, error: null };
  if (v instanceof Uint8Array) {
    try {
      v = wkbToGeojson({ view: new DataView(v.buffer, v.byteOffset, v.byteLength), offset: 0 });
    } catch {
      return { value: null, error: "the WKB couldn't be decoded" };
    }
  } else if (typeof v === "string") {
    v = unpack(v);
    if (typeof v === "string") return { value: null, error: "it's text that isn't GeoJSON" };
  }
  const value = asGeometry(v);
  return value ? { value, error: null } : { value: null, error: "it isn't GeoJSON" };
}

/** A decoded value as GeoJSON geometry, or null when it isn't one. */
function asGeometry(v: unknown): Geometry | null {
  if (!v || typeof v !== "object") return null;
  const g = v as { type?: unknown; coordinates?: unknown; geometries?: unknown };
  if (typeof g.type !== "string" || !GEOMETRY_TYPES.has(g.type)) return null;
  if (g.type === "GeometryCollection") {
    if (!Array.isArray(g.geometries)) return null;
    const geometries = g.geometries.map(asGeometry);
    return geometries.every((x): x is Geometry => x !== null) ? { type: "GeometryCollection", geometries } : null;
  }
  return Array.isArray(g.coordinates) ? (plain(v) as Geometry) : null;
}

const utf8 = new TextDecoder();
function text(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

function toBbox(v: unknown): StacItem["bbox"] {
  const box = Array.isArray(v) && v.length >= 4
    ? [v[0], v[1], v[2], v[3]].map(Number)
    : v && typeof v === "object" && "xmin" in v
      ? [(v as Record<string, number>).xmin, (v as Record<string, number>).ymin, (v as Record<string, number>).xmax, (v as Record<string, number>).ymax]
      : null;
  // A box with a NaN or null in it would poison every extent it's joined to.
  return box && box.every(Number.isFinite) ? (box as StacItem["bbox"]) : null;
}

/**
 * Assets come back as one struct with a field per asset name, and a row that
 * lacks an asset has null there. Only the present ones are assets.
 */
function toAssets(v: unknown): Record<string, StacAsset> {
  const out: Record<string, StacAsset> = {};
  if (!v || typeof v !== "object") return out;
  for (const [name, a] of Object.entries(v as Record<string, unknown>)) {
    if (!a || typeof a !== "object") continue;
    const asset = a as Record<string, unknown>;
    if (typeof asset.href !== "string" || !asset.href) continue;
    out[name] = tidyAsset(dropNulls(plain(asset) as Record<string, unknown>) as StacAsset);
  }
  return out;
}

/** Dates to ISO strings, bigints to numbers, typed arrays to arrays. */
function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (Array.isArray(v)) return v.map(plain);
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = plain(x);
    return out;
  }
  return v;
}

function dropNulls<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v;
  return out as T;
}

/* ------------------------------------------------------- previews */

/**
 * The first rows of any parquet file, for the data table on a collection
 * page and the preview behind an asset row. Reads by byte range so a large
 * file costs only its footer and first pages.
 */
export async function previewParquet(uri: string, limit = 50): Promise<TablePreview> {
  const h = await head(uri);
  if (!h) throw new NotFound(uri);
  const decoded = await decode({ uri, byteLength: h.size, rowEnd: limit });
  const top = columnsOf(decoded.schema);
  const columns = top.map((c) => c.element.name);
  // The geometry columns: the ones the "geo" metadata names, the ones typed
  // as geometry, and a bare "geometry" column whatever it holds.
  const geo = geometryColumns(decoded.keyValue.geo);
  for (const c of top) {
    const lt = c.element.logical_type?.type;
    if (lt === "GEOMETRY" || lt === "GEOGRAPHY" || c.element.name === "geometry") geo.add(c.element.name);
  }
  const kinds = Object.fromEntries(top.map((c) => [c.element.name, geo.has(c.element.name) ? "geometry" : kindOf(c)]));
  // Bytes came back as bytes (as readItems reads them), so an unlabeled WKB
  // column can be named for what it is rather than shown as garbled text.
  const bytesAsText = new Set(
    top
      .filter((c) => c.element.type === "BYTE_ARRAY" && !c.element.logical_type && !c.element.converted_type && !geo.has(c.element.name))
      .map((c) => c.element.name),
  );
  return {
    kind: "table",
    columns,
    kinds,
    rows: decoded.rows.map((r) => {
      const row = { ...r };
      for (const k of bytesAsText) if (row[k] instanceof Uint8Array) row[k] = text(row[k] as Uint8Array);
      for (const k of geo) row[k] = geometrySummary(row[k]);
      return toJson(plain(row)) as Record<string, unknown>;
    }),
    totalRows: decoded.totalRows,
    byteLength: h.size,
  };
}

/**
 * What a geometry cell of a preview says: the geometry's type ("Polygon"),
 * or what the value is when it isn't one. Never the coordinates; a preview
 * is for seeing the columns, and the map is for seeing where things are.
 */
export function geometrySummary(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return toGeometry(v).value?.type ?? `binary, ${v.byteLength} bytes`;
  if (typeof v === "string") return toGeometry(v).value?.type ?? "text";
  if (typeof v === "object") {
    const t = (v as { type?: unknown }).type;
    return typeof t === "string" ? t : "geometry";
  }
  return String(v);
}

/** The columns the GeoParquet "geo" metadata names as geometry. */
function geometryColumns(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const geo = JSON.parse(raw) as { columns?: Record<string, unknown> };
    return new Set(Object.keys(geo.columns ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * What a column holds, in a word, from its schema: the logical type when
 * the writer set one, the older converted type when it didn't, else the
 * physical type. A column with children is a list, a map or a struct.
 */
function kindOf(tree: SchemaTree): ColumnKind {
  const el = tree.element;
  const logical = el.logical_type?.type;
  const converted = el.converted_type;
  if (tree.children.length) {
    if (logical === "LIST" || converted === "LIST") return "list";
    if (logical === "MAP" || converted === "MAP" || converted === "MAP_KEY_VALUE") return "map";
    return "struct";
  }
  switch (logical) {
    case "STRING":
    case "ENUM":
    case "JSON":
    case "UUID":
      return "text";
    case "DATE":
      return "date";
    case "TIMESTAMP":
      return "timestamp";
    case "TIME":
      return "time";
    case "INTEGER":
    case "DECIMAL":
    case "FLOAT16":
      return "number";
  }
  if (converted) {
    if (converted === "UTF8" || converted === "ENUM" || converted === "JSON") return "text";
    if (converted === "DATE") return "date";
    if (converted.startsWith("TIMESTAMP")) return "timestamp";
    if (converted.startsWith("TIME_")) return "time";
    if (converted === "DECIMAL" || /^U?INT_/.test(converted)) return "number";
  }
  switch (el.type) {
    case "BOOLEAN":
      return "boolean";
    case "INT32":
    case "INT64":
    case "FLOAT":
    case "DOUBLE":
      return "number";
    case "INT96":
      return "timestamp";
    default:
      return "binary";
  }
}
