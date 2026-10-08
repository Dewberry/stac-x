import "server-only";

import { isQcStatus, type QcEdit, type QcEvent, type QcStatus } from "./stac";
import { NotFound, PreconditionFailed, readJson, write } from "./storage";

/**
 * Where the edits live.
 *
 * QC is recorded per collection: one status, approval date and note for the
 * whole collection. That record is the only thing this app writes, and it
 * goes to a JSON sidecar beside the collection's parquet file rather than
 * into the parquet itself:
 *
 *   s3://bucket/path/gages_all_items_geopq.parquet
 *   s3://bucket/path/gages_all_items_geopq.edits.json
 *
 * Rewriting a parquet file to change two cells means re-encoding every column
 * and reproducing the geo metadata byte for byte, and any pipeline run that
 * regenerates the file would drop the edits anyway. A sidecar is one small
 * object, it can't corrupt the source, every write is a full audit record,
 * and the pipeline can fold it in on its next run with a dozen lines of
 * pandas. The viewer merges it on read, so to a reader the collection simply
 * has a qc and a date_approved.
 *
 * The file is keyed by collection id, and written with an If-Match on the
 * ETag it was read at, so two reviewers can't overwrite each other. See
 * storage.ts. A collection whose items span several parquet files keeps its
 * record beside the first of them; on read the newest record across its
 * files wins.
 *
 * Beside the current record, `history` keeps every QC save and every move
 * between environments for the collection, so the page can show how it got
 * where it is.
 *
 * Sidecars written before QC moved to the collection have an `items` map of
 * per-item records. It's left in the file untouched and no longer read.
 */

export type EditsFile = {
  version: 1;
  collections: Record<string, QcEdit>;
  history: Record<string, QcEvent[]>;
  items?: Record<string, unknown>;
};

const empty = (): EditsFile => ({ version: 1, collections: {}, history: {} });

export function editsUri(parquetUri: string): string {
  return parquetUri.replace(/\.(geo)?parquet$|\.pq$|\.json$/i, "") + ".edits.json";
}

export async function readEdits(parquetUri: string): Promise<{ edits: EditsFile; etag: string | null }> {
  try {
    const { value, etag } = await readJson<EditsFile>(editsUri(parquetUri));
    if (!value || value.version !== 1) return { edits: empty(), etag };
    const collections = value.collections && typeof value.collections === "object" ? value.collections : {};
    const history = value.history && typeof value.history === "object" ? value.history : {};
    return { edits: { ...value, collections, history }, etag };
  } catch (e) {
    if (e instanceof NotFound) return { edits: empty(), etag: null };
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
export async function updateEdits(parquetUri: string, change: (edits: EditsFile) => void): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { edits, etag } = await readEdits(parquetUri);
    change(edits);
    try {
      await write(editsUri(parquetUri), JSON.stringify(edits, null, 2) + "\n", {
        contentType: "application/json",
        ifMatch: etag,
      });
      return;
    } catch (e) {
      if (!(e instanceof PreconditionFailed) || attempt === 2) throw e;
    }
  }
  throw new PreconditionFailed(editsUri(parquetUri));
}

export function logEvent(edits: EditsFile, collection: string, event: QcEvent) {
  (edits.history[collection] ??= []).push(event);
}

/** Save a collection's QC record and log it. */
export async function saveEdit(parquetUri: string, collection: string, input: EditInput): Promise<QcEdit> {
  const edit: QcEdit = { ...input, updated_at: new Date().toISOString() };
  await updateEdits(parquetUri, (edits) => {
    edits.collections[collection] = edit;
    logEvent(edits, collection, { kind: "qc", at: edit.updated_at, ...input });
  });
  return edit;
}
