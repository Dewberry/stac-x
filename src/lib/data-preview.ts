/**
 * The shape of a file preview, shared by the server that reads the file
 * (lib/parquet.ts, lib/text-preview.ts) and the dialog that shows it
 * (components/data-modal.tsx). A file with rows (parquet, CSV, a GeoJSON
 * feature collection, a JSON array of like objects) previews as a table;
 * any other JSON previews as a tree. No server imports here.
 */

import { isCsvType, isParquetType } from "./format";

/** What a column holds, in the words the table shows under its name. */
export type ColumnKind =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "timestamp"
  | "time"
  | "binary"
  | "geometry"
  | "list"
  | "map"
  | "struct";

export type TablePreview = {
  kind: "table";
  columns: string[];
  kinds: Record<string, ColumnKind>;
  rows: Record<string, unknown>[];
  /** Null when only the head of the file was read and the rest wasn't counted. */
  totalRows: number | null;
  byteLength: number;
};

export type JsonPreview = {
  kind: "json";
  value: unknown;
  byteLength: number;
};

export type Preview = TablePreview | JsonPreview;

/** The tag beside a file's name in the preview dialog: what kind of file it is. */
export function formatTag(type: string | null | undefined, href: string): string {
  if (isParquetType(type, href)) return "parquet";
  if (isCsvType(type, href)) return "csv";
  if (/geo\+json/i.test(type ?? "") || /\.geojson$/i.test(href.split("?")[0])) return "geojson";
  return "json";
}

/** The columns worth reading first, in this order; a name column of any spelling goes second. */
const FIRST = ["id", "title", "name", "label", "datetime", "start_datetime", "end_datetime"];
const NAME = /name|title|label/i;
/** Columns that are always a structure, however they're serialized. */
const FOLDED = new Set(["geometry", "bbox", "assets", "links", "stac_extensions"]);
const STRUCTURED = new Set<ColumnKind>(["list", "map", "struct", "geometry", "binary"]);

/** Whether a column holds a structure, from its kind or, failing that, its values. */
export function isFolded(p: TablePreview, column: string): boolean {
  if (FOLDED.has(column)) return true;
  const kind = p.kinds[column];
  if (kind) return STRUCTURED.has(kind);
  return p.rows.some((r) => r[column] !== null && typeof r[column] === "object");
}

/**
 * The columns in reading order: the ones that name a row (id, title, dates)
 * first, then the plain values, then the structures (the geometry, the
 * assets, the links) last, since a cell of nested JSON says nothing at a
 * glance and is better folded at the edge.
 */
export function orderColumns(p: TablePreview): string[] {
  const rest = p.columns.filter((c) => !FIRST.includes(c));
  const named = rest.filter((c) => NAME.test(c) && !isFolded(p, c));
  return [
    ...FIRST.filter((c) => p.columns.includes(c)),
    ...named,
    ...rest.filter((c) => !named.includes(c) && !isFolded(p, c)),
    ...rest.filter((c) => isFolded(p, c)),
  ];
}
