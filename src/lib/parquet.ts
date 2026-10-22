import "server-only";

import { parquetMetadataAsync, parquetReadObjects, parquetSchema, toJson } from "hyparquet";
import type { AsyncBuffer, FileMetaData, SchemaTree } from "hyparquet";
import { wkbToGeojson } from "hyparquet/src/wkb.js";
import { compressors } from "hyparquet-compressors";
import type { Geometry } from "geojson";
import type { ColumnKind, TablePreview } from "./data-preview";
import type { StacAsset, StacItem, StacLink } from "./stac";
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

export async function readItems(uri: string): Promise<ParquetStac> {
  const { bytes, etag } = await read(uri);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file: AsyncBuffer = { byteLength: ab.byteLength, slice: (a, b) => ab.slice(a, b) };
  const metadata = await parquetMetadataAsync(file);
  const schema = parquetSchema(metadata);
  if (!schema.children.some((c) => c.element.name === "id")) throw new NotStac(uri);
  // Byte columns with no type are left as bytes, so a geometry column the
  // "geo" metadata doesn't mark can be decoded instead of read as text.
  // Any other such column is text, as hyparquet would have read it.
  const rows = await parquetReadObjects({ file, metadata, compressors, rowFormat: "object", utf8: false });
  const bytesAsText = new Set(
    schema.children
      .filter((c) => c.element.type === "BYTE_ARRAY" && !c.element.logical_type && !c.element.converted_type && c.element.name !== "geometry")
      .map((c) => c.element.name),
  );
  const fallbackCollection = uri.split("/").pop()?.replace(/\.(geo)?parquet$|\.pq$/i, "") ?? "items";
  return {
    items: rows.map((row) => rowToItem(row as Record<string, unknown>, fallbackCollection, bytesAsText)),
    collections: embeddedCollections(metadata),
    etag,
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
  return {
    type: "Feature",
    stac_version: String(row.stac_version ?? "1.0.0"),
    stac_extensions: Array.isArray(extensions) ? extensions.filter((x): x is string => typeof x === "string") : [],
    id: String(row.id),
    collection: typeof row.collection === "string" && row.collection ? row.collection : fallbackCollection,
    geometry: toGeometry(row.geometry),
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
 * file didn't label, or GeoJSON text. Anything else is no geometry.
 */
function toGeometry(v: unknown): Geometry | null {
  if (v instanceof Uint8Array) {
    try {
      v = wkbToGeojson({ view: new DataView(v.buffer, v.byteOffset, v.byteLength), offset: 0 });
    } catch {
      return null;
    }
  } else if (typeof v === "string") {
    v = unpack(v);
  }
  if (!v || typeof v !== "object") return null;
  const g = v as { type?: unknown; coordinates?: unknown; geometries?: unknown };
  if (typeof g.type !== "string" || !GEOMETRY_TYPES.has(g.type)) return null;
  if (g.type === "GeometryCollection") {
    if (!Array.isArray(g.geometries)) return null;
    const geometries = g.geometries.map(toGeometry).filter((x): x is Geometry => x !== null);
    return { type: "GeometryCollection", geometries };
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

/**
 * The first rows of any parquet file, for the data table on a collection
 * page and the preview behind an asset row. Reads by byte range so a large
 * file costs only its footer and first pages.
 */
export async function previewParquet(uri: string, limit = 50): Promise<TablePreview> {
  const h = await head(uri);
  if (!h) throw new NotFound(uri);
  const file: AsyncBuffer = {
    byteLength: h.size,
    slice: (start, end) => readRange(uri, start, end ?? h.size),
  };
  const metadata: FileMetaData = await parquetMetadataAsync(file);
  const schema = parquetSchema(metadata);
  const columns = schema.children.map((c) => c.element.name);
  const geo = geometryColumns(metadata);
  const kinds = Object.fromEntries(schema.children.map((c) => [c.element.name, geo.has(c.element.name) ? "geometry" : kindOf(c)]));
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
    kind: "table",
    columns,
    kinds,
    rows: rows.map((r) => toJson(plain(r)) as Record<string, unknown>),
    totalRows,
    byteLength: h.size,
  };
}

/** The columns the GeoParquet "geo" metadata names as geometry. */
function geometryColumns(metadata: FileMetaData): Set<string> {
  const raw = metadata.key_value_metadata?.find((kv) => kv.key === "geo")?.value;
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
