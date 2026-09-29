import "server-only";

import { parquetMetadataAsync, parquetReadObjects, parquetSchema, toJson } from "hyparquet";
import type { AsyncBuffer, FileMetaData } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import type { Geometry } from "geojson";
import type { StacAsset, StacItem, StacLink } from "./stac";
import { read, readRange, head } from "./storage";

/**
 * stac-geoparquet in, STAC items out.
 *
 * hyparquet reads the file in pure JS, decodes the WKB geometry column into
 * GeoJSON on its own once it sees the "geo" metadata, and hands back one object
 * per row. The mapping back to STAC follows the stac-geoparquet spec: the
 * fields STAC defines at the top level stay there, bbox comes back from a
 * struct to an array, and every other column is an item property.
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
};

export async function readItems(uri: string): Promise<ParquetStac> {
  const { bytes } = await read(uri);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file: AsyncBuffer = { byteLength: ab.byteLength, slice: (a, b) => ab.slice(a, b) };
  const metadata = await parquetMetadataAsync(file);
  const rows = await parquetReadObjects({ file, metadata, compressors, rowFormat: "object" });
  const fallbackCollection = uri.split("/").pop()?.replace(/\.(geo)?parquet$|\.pq$/i, "") ?? "items";
  return {
    items: rows.map((row) => rowToItem(row as Record<string, unknown>, fallbackCollection)),
    collections: embeddedCollections(metadata),
  };
}

/**
 * stac-geoparquet 1.1 keeps the collections a file holds in its key-value
 * metadata, under "stac-geoparquet": a map of id to Collection, or a single
 * "collection" in files written before 1.1. Most files don't have either.
 */
function embeddedCollections(metadata: FileMetaData): ParquetStac["collections"] {
  const raw = metadata.key_value_metadata?.find((kv) => kv.key === "stac-geoparquet")?.value;
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

function rowToItem(row: Record<string, unknown>, fallbackCollection: string): StacItem {
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (TOP_LEVEL.has(k)) continue;
    properties[k] = plain(v);
  }
  const bbox = toBbox(row.bbox);
  return {
    type: "Feature",
    stac_version: String(row.stac_version ?? "1.0.0"),
    stac_extensions: Array.isArray(row.stac_extensions)
      ? row.stac_extensions.filter((x): x is string => typeof x === "string")
      : [],
    id: String(row.id),
    collection: typeof row.collection === "string" && row.collection ? row.collection : fallbackCollection,
    geometry: (row.geometry as Geometry | null | undefined) ?? null,
    bbox,
    properties,
    links: Array.isArray(row.links) ? (row.links as StacLink[]).map(dropNulls) : [],
    assets: toAssets(row.assets),
  };
}

function toBbox(v: unknown): StacItem["bbox"] {
  if (Array.isArray(v) && v.length >= 4) return [v[0], v[1], v[2], v[3]].map(Number) as StacItem["bbox"];
  if (v && typeof v === "object" && "xmin" in v) {
    const b = v as Record<string, number>;
    return [b.xmin, b.ymin, b.xmax, b.ymax];
  }
  return null;
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
    out[name] = dropNulls(plain(asset) as Record<string, unknown>) as StacAsset;
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

export type Preview = {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  byteLength: number;
};

/**
 * The first rows of any parquet file, for the data preview under an asset.
 * Reads by byte range so a large file costs only its footer and first pages.
 */
export async function previewParquet(uri: string, limit = 50): Promise<Preview> {
  const h = await head(uri);
  if (!h) throw new Error(`No such object: ${uri}`);
  const file: AsyncBuffer = {
    byteLength: h.size,
    slice: (start, end) => readRange(uri, start, end ?? h.size),
  };
  const metadata: FileMetaData = await parquetMetadataAsync(file);
  const schema = parquetSchema(metadata);
  const columns = schema.children.map((c) => c.element.name);
  const totalRows = Number(metadata.num_rows);
  const rows = await parquetReadObjects({
    file,
    metadata,
    compressors,
    rowFormat: "object",
    rowStart: 0,
    rowEnd: Math.min(limit, totalRows),
  });
  return {
    columns,
    rows: rows.map((r) => toJson(plain(r)) as Record<string, unknown>),
    totalRows,
    byteLength: h.size,
  };
}
