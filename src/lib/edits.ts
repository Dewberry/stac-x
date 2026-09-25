import "server-only";

import { isQcStatus, type ItemEdit, type QcStatus } from "./stac";
import { NotFound, PreconditionFailed, readJson, write } from "./storage";

/**
 * Where the edits live.
 *
 * QC status and the approval date are the only things this app writes, and
 * they go to a JSON sidecar beside each parquet file rather than into the
 * parquet itself:
 *
 *   s3://bucket/path/gages_all_items_geopq.parquet
 *   s3://bucket/path/gages_all_items_geopq.edits.json
 *
 * Rewriting a parquet file to change two cells means re-encoding every column
 * and reproducing the geo metadata byte for byte, and any pipeline run that
 * regenerates the file would drop the edits anyway. A sidecar is one small
 * object, it can't corrupt the source, every write is a full audit record,
 * and the pipeline can fold it in on its next run with a dozen lines of
 * pandas. The viewer merges it on read, so to a reader the item simply has a
 * qc and a date_approved.
 *
 * The file is keyed by item id within its collection, and written with an
 * If-Match on the ETag it was read at, so two reviewers can't overwrite each
 * other. See storage.ts.
 */

export type EditsFile = {
  version: 1;
  items: Record<string, ItemEdit>;
};

export function editsUri(parquetUri: string): string {
  return parquetUri.replace(/\.(geo)?parquet$|\.pq$/i, "") + ".edits.json";
}

export function editKey(collection: string, id: string) {
  return `${collection}/${id}`;
}

export async function readEdits(parquetUri: string): Promise<{ edits: EditsFile; etag: string | null }> {
  try {
    const { value, etag } = await readJson<EditsFile>(editsUri(parquetUri));
    if (!value || value.version !== 1 || typeof value.items !== "object") {
      return { edits: { version: 1, items: {} }, etag };
    }
    return { edits: value, etag };
  } catch (e) {
    if (e instanceof NotFound) return { edits: { version: 1, items: {} }, etag: null };
    throw e;
  }
}

export type EditInput = {
  qc: QcStatus;
  date_approved: string | null;
  note?: string | null;
};

export function validateEdit(input: unknown): EditInput {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!isQcStatus(o.qc)) throw new Error("qc must be one of the known statuses");
  let date: string | null = null;
  if (o.date_approved !== null && o.date_approved !== undefined && o.date_approved !== "") {
    if (typeof o.date_approved !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date_approved)) {
      throw new Error("date_approved must be a YYYY-MM-DD date");
    }
    date = o.date_approved;
  }
  const note = typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 2000) : null;
  return { qc: o.qc, date_approved: date, note };
}

/**
 * Read-modify-write with a retry on a lost race. Three tries is plenty for a
 * review queue; if it still fails, something other than a colleague is
 * writing that file.
 */
export async function saveEdit(
  parquetUri: string,
  collection: string,
  id: string,
  input: EditInput,
): Promise<ItemEdit> {
  const edit: ItemEdit = { ...input, updated_at: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { edits, etag } = await readEdits(parquetUri);
    edits.items[editKey(collection, id)] = edit;
    try {
      await write(editsUri(parquetUri), JSON.stringify(edits, null, 2) + "\n", {
        contentType: "application/json",
        ifMatch: etag,
      });
      return edit;
    } catch (e) {
      if (!(e instanceof PreconditionFailed) || attempt === 2) throw e;
    }
  }
  throw new PreconditionFailed(editsUri(parquetUri));
}
