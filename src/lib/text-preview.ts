import "server-only";

import type { ColumnKind, JsonPreview, Preview, TablePreview } from "./data-preview";
import { isIsoDate } from "./format";
import { head, NotFound, read, readRange } from "./storage";

/**
 * Previews of the text files an item carries: CSV and JSON. A CSV is read
 * from its head, so a large one costs a few hundred kB however big it is;
 * when the whole file fits in that read its rows are counted, otherwise
 * the count is left unknown. A JSON file is read whole, since it can't be
 * parsed any other way, up to a size a browser can take; a GeoJSON feature
 * collection or an array of like objects comes back as rows, anything else
 * as the document itself.
 */

/** How much of a CSV to read, and the biggest JSON to read at all. */
const CSV_HEAD = 512 * 1024;
const JSON_MAX = 8 * 1024 * 1024;

export class TooBig extends Error {
  constructor(public readonly byteLength: number) {
    super("too big to preview");
  }
}

export async function previewCsv(uri: string, limit: number): Promise<TablePreview> {
  const h = await head(uri);
  if (!h) throw new NotFound(uri);
  const whole = h.size <= CSV_HEAD;
  const bytes = whole ? (await read(uri)).bytes : new Uint8Array(await readRange(uri, 0, CSV_HEAD));
  let text = new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes);
  // A cut-off read ends mid-line; that line isn't a row.
  if (!whole) text = text.slice(0, text.lastIndexOf("\n") + 1);
  const delimiter = delimiterOf(text);
  const table = parseDelimited(text, delimiter, whole ? Infinity : limit + 1);
  const header = table.shift() ?? [];
  const columns = header.map((c, i) => c.trim() || `column_${i + 1}`);
  const rows = table.slice(0, limit).map((cells) => Object.fromEntries(columns.map((c, i) => [c, cellValue(cells[i])])));
  return {
    kind: "table",
    columns,
    kinds: inferKinds(columns, rows),
    rows,
    totalRows: whole ? table.length : null,
    byteLength: h.size,
  };
}

export async function previewJson(uri: string, limit: number): Promise<Preview> {
  const h = await head(uri);
  if (!h) throw new NotFound(uri);
  if (h.size > JSON_MAX) throw new TooBig(h.size);
  const { bytes } = await read(uri);
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return jsonPreview(value, h.size, limit);
}

/** Rows out of a value with rows in it; otherwise the value as it is. */
export function jsonPreview(value: unknown, byteLength: number, limit: number): Preview {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (o.type === "FeatureCollection" && Array.isArray(o.features)) {
      const features = o.features.filter(isRecord);
      const rows = features.slice(0, limit).map((f) => ({
        id: f.id ?? null,
        ...(isRecord(f.properties) ? f.properties : {}),
        geometry: f.geometry ?? null,
        bbox: f.bbox ?? null,
      }));
      const columns = unionKeys(rows);
      return { kind: "table", columns, kinds: { ...inferKinds(columns, rows), geometry: "geometry" }, rows, totalRows: features.length, byteLength };
    }
  }
  if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) {
    const rows = value.slice(0, limit);
    const columns = unionKeys(rows);
    return { kind: "table", columns, kinds: inferKinds(columns, rows), rows, totalRows: value.length, byteLength };
  }
  return { kind: "json", value, byteLength } satisfies JsonPreview;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Every key any row has, in the order they first appear, at most 60 of them. */
function unionKeys(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return keys.slice(0, 60);
}

/* ------------------------------------------------------------------ csv */

/** Comma unless a tab or a semicolon splits the first line into more fields. */
function delimiterOf(text: string): string {
  const line = text.slice(0, text.indexOf("\n") < 0 ? undefined : text.indexOf("\n"));
  const count = (d: string) => line.split(d).length;
  return [",", "\t", ";"].reduce((best, d) => (count(d) > count(best) ? d : best), ",");
}

/** RFC 4180 fields: quotes wrap a field, a doubled quote is a quote, and a newline inside quotes is kept. */
function parseDelimited(text: string, delimiter: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** A CSV cell as a value: a number when it reads as one, null when empty. */
function cellValue(s: string | undefined): unknown {
  if (s === undefined || s === "") return null;
  return NUMBER.test(s) ? Number(s) : s;
}

/** What each column holds, from the rows on hand. */
function inferKinds(columns: string[], rows: Record<string, unknown>[]): Record<string, ColumnKind> {
  const kinds: Record<string, ColumnKind> = {};
  for (const c of columns) {
    const vals = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== "");
    if (!vals.length) {
      kinds[c] = "text";
      continue;
    }
    if (vals.every((v) => typeof v === "number")) kinds[c] = "number";
    else if (vals.every((v) => typeof v === "boolean")) kinds[c] = "boolean";
    else if (vals.every(isIsoDate)) kinds[c] = vals.every((v) => (v as string).length > 10) ? "timestamp" : "date";
    else if (vals.every(Array.isArray)) kinds[c] = "list";
    else if (vals.every((v) => typeof v === "object")) kinds[c] = "struct";
    else kinds[c] = "text";
  }
  return kinds;
}
