"use server";

import { revalidatePath } from "next/cache";
import { getCollection, invalidate } from "@/lib/catalog";
import { saveEdit, validateEdit } from "@/lib/edits";
import { isEnv, nextEnv, type EnvKey } from "@/lib/env";
import { canPromote, promote } from "@/lib/promote";
import type { QcEdit } from "@/lib/stac";

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
 */
export async function saveQcAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  const env = form.get("env");
  const collection = String(form.get("collection") ?? "");
  try {
    if (!isEnv(env)) return { ok: false, error: "Unknown environment." };
    const c = await getCollection(env, collection);
    if (!c) return { ok: false, error: "Collection not found." };
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
    const edit = await saveEdit(source, collection, input);
    invalidate(env, source);
    let promotedTo: EnvKey | null = null;
    // A collection that can't be copied on yet keeps its approval and stays
    // put; the review sheet already said so.
    if (to && canPromote(c)) {
      try {
        promotedTo = await promote(env, { ...c, qc: edit });
      } catch (e) {
        revalidatePath("/", "layout");
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `The approval was saved, but the collection couldn't be sent to ${to.label}: ${msg} Save again to retry.` };
      }
    }
    revalidatePath("/", "layout");
    return { ok: true, edit, promotedTo };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Could not save: ${msg}` };
  }
}
