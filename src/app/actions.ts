"use server";

import { revalidatePath } from "next/cache";
import { getCollection, invalidateEdits } from "@/lib/catalog";
import { saveEdit, validateEdit } from "@/lib/edits";
import type { QcEdit } from "@/lib/stac";
import { collectionHref } from "@/lib/utils";

export type SaveState = { ok: true; edit: QcEdit } | { ok: false; error: string; edit?: undefined } | { ok: null; edit?: undefined };

/**
 * Save QC for a collection. There is no sign-in yet, so anyone who can reach
 * the app can write; put the app behind the deployment's auth (an ALB with
 * OIDC, or a VPN) until a user model exists. The edit record carries no
 * author for the same reason.
 */
export async function saveQcAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  const collection = String(form.get("collection") ?? "");
  try {
    const c = await getCollection(collection);
    if (!c) return { ok: false, error: "Collection not found." };
    const source = c.sources[0];
    if (!source) return { ok: false, error: "This collection has no source file to save beside." };
    const input = validateEdit({
      qc: form.get("qc"),
      date_approved: form.get("date_approved"),
      note: form.get("note"),
    });
    const edit = await saveEdit(source, collection, input);
    invalidateEdits(source);
    revalidatePath(collectionHref(collection));
    revalidatePath("/");
    return { ok: true, edit };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Could not save: ${msg}` };
  }
}
