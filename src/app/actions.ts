"use server";

import { revalidatePath } from "next/cache";
import { getCollection, invalidate } from "@/lib/catalog";
import { saveEdit, validateEdit } from "@/lib/edits";
import { isEnv, nextEnv, type EnvKey } from "@/lib/env";
import { canPromote, promote } from "@/lib/promote";
import { Refused } from "@/lib/refused";
import type { QcEdit } from "@/lib/stac";
import { PreconditionFailed } from "@/lib/storage";

export type SaveState =
  | { ok: true; edit: QcEdit; promotedTo: EnvKey | null }
  | { ok: false; error: string; edit?: undefined }
  | { ok: null; edit?: undefined };

/**
 * Save QC for a collection in one environment, and move it forward when the
 * save is an approval: Development to Test, Test to Production.
 * Approving into Production needs a note, which becomes the record of why it
 * went live.
 *
 * There is no identity provider yet, so anyone who can reach the app can
 * write; put the app behind the deployment's auth (an ALB with OIDC, or a VPN)
 * until a real one is wired in. The records carry no author for the same
 * reason.
 *
 * What went wrong is only said when the app worded it (see whyNot). S3's
 * own errors stay in the server log, as they do in the API routes.
 */
export async function saveQcAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  const env = form.get("env");
  const collection = String(form.get("collection") ?? "");
  try {
    if (!isEnv(env)) return { ok: false, error: "Unknown environment." };
    const c = await getCollection(env, collection);
    if (!c) return { ok: false, error: "Collection not found." };
    // A catalog is a folder; there's nothing of its own to decide on.
    if (c.kind === "catalog") return { ok: false, error: "A catalog isn't reviewed. Review the datasets inside it." };
    const source = c.sources[0];
    if (!source) return { ok: false, error: "This collection has no source file to save beside." };
    const input = validateEdit({
      qc: form.get("qc"),
      date_approved: form.get("date_approved"),
      note: form.get("note"),
    });
    const to = input.qc === "approved" ? nextEnv(env) : null;
    if (to?.key === "prod" && !input.note) {
      return { ok: false, error: "Add a note saying what was checked. It's the record of why this went to Production." };
    }
    // The sidecar is keyed by the id the file's own metadata gives the
    // collection, which an older version shares with the current one.
    const edit = await saveEdit(source, c.stacId, input);
    invalidate(env, source);
    let promotedTo: EnvKey | null = null;
    // A collection that can't be copied on yet keeps its approval and stays
    // put; the review sheet already said so.
    if (to && canPromote(c)) {
      try {
        promotedTo = await promote(env, { ...c, qc: edit });
      } catch (e) {
        revalidatePath("/", "layout");
        return {
          ok: false,
          error: `The approval was saved, but the collection couldn't be sent to ${to.label}: ${whyNot(e, `sending ${collection} from ${env} to ${to.key}`)} Save again to retry.`,
        };
      }
    }
    revalidatePath("/", "layout");
    return { ok: true, edit, promotedTo };
  } catch (e) {
    return { ok: false, error: `Could not save: ${whyNot(e, `saving QC for ${collection} in ${String(env)}`)}` };
  }
}

/**
 * Why a save or a promotion failed, as a sentence that's safe to show. A
 * Refused is the app's own wording and is said as it is. Two reviewers
 * saving at once is said plainly. Anything else is S3's or the disk's text,
 * which can name the account, the role or a server path: it's logged here
 * and the reviewer is pointed at the log.
 */
function whyNot(e: unknown, doing: string): string {
  if (e instanceof Refused) return e.message;
  if (e instanceof PreconditionFailed) {
    return "Someone else saved a review beside the same file at the same moment, and theirs was kept.";
  }
  console.error(`stac-x: ${doing} failed:`, e);
  return "Something went wrong on the server, and its log has the details.";
}
