import "server-only";

import { Refused } from "./refused";
import { isQcStatus, type QcEdit, type QcEvent, type QcStatus } from "./stac";
import { baseName, NotFound, PreconditionFailed, read, write } from "./storage";

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
 *
 * A sidecar is a plain file in the bucket, so it can be edited by hand or
 * cut short by a failed upload. One that isn't JSON, or isn't the shape
 * this app writes, is read as holding nothing, so its dataset still shows
 * (as not reviewed) and the rest of its file's collections with it. It's
 * never written over, though: what's in it may be the only record of a
 * review, so a save is turned down until someone mends or removes the file.
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

export type ReadEdits = {
  edits: EditsFile;
  /** Null when there's no sidecar yet. */
  etag: string | null;
  /** Why the sidecar that's there couldn't be used, when it couldn't; `edits` is empty then. */
  unreadable: string | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A sidecar's contents as the file this app writes, or what's wrong with them. */
function whyUnreadable(text: string): { value: EditsFile } | { why: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { why: "it isn't valid JSON" };
  }
  if (!isRecord(value) || value.version !== 1) return { why: "it isn't a version 1 edits file" };
  for (const key of ["collections", "history"] as const) {
    if (value[key] !== undefined && !isRecord(value[key])) return { why: `its ${key} aren't keyed by collection id` };
  }
  return { value: value as EditsFile };
}

export async function readEdits(parquetUri: string): Promise<ReadEdits> {
  const uri = editsUri(parquetUri);
  let text: string;
  let etag: string;
  try {
    const got = await read(uri);
    text = new TextDecoder().decode(got.bytes);
    etag = got.etag;
  } catch (e) {
    if (e instanceof NotFound) return { edits: empty(), etag: null, unreadable: null };
    throw e;
  }
  const parsed = whyUnreadable(text);
  if ("why" in parsed) return { edits: empty(), etag, unreadable: parsed.why };
  const { value } = parsed;
  return { edits: { ...value, collections: value.collections ?? {}, history: value.history ?? {} }, etag, unreadable: null };
}

/** What a person is told when a save meets a sidecar that can't be read. */
export function unreadableMessage(parquetUri: string, why: string): string {
  return `${baseName(editsUri(parquetUri))}, the review record beside this dataset's file, can't be read (${why}), so nothing was saved over it. Fix or delete that file, then save again.`;
}

export type EditInput = {
  qc: QcStatus;
  date_approved: string | null;
  note?: string | null;
};

export function validateEdit(input: unknown): EditInput {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!isQcStatus(o.qc)) throw new Refused("qc must be one of the known statuses");
  let date: string | null = null;
  if (o.date_approved !== null && o.date_approved !== undefined && o.date_approved !== "") {
    if (typeof o.date_approved !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date_approved)) {
      throw new Refused("date_approved must be a YYYY-MM-DD date");
    }
    date = o.date_approved;
  }
  const note = typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 2000) : null;
  return { qc: o.qc, date_approved: date, note };
}

/**
 * Read-modify-write with a retry on a lost race. Three tries is plenty for a
 * review queue; if it still fails, something other than a colleague is
 * writing that file. A sidecar that can't be read is left as it is and the
 * save is refused (see the note on that above).
 */
export async function updateEdits(parquetUri: string, change: (edits: EditsFile) => void): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { edits, etag, unreadable } = await readEdits(parquetUri);
    if (unreadable) throw new Refused(unreadableMessage(parquetUri, unreadable));
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

/** Save a collection's QC record and log it, with who saved it (lib/session.ts). */
export async function saveEdit(parquetUri: string, collection: string, input: EditInput, by: string): Promise<QcEdit> {
  const edit: QcEdit = { ...input, by, updated_at: new Date().toISOString() };
  await updateEdits(parquetUri, (edits) => {
    edits.collections[collection] = edit;
    logEvent(edits, collection, { kind: "qc", at: edit.updated_at, ...input, by });
  });
  return edit;
}
