"use server";

import { revalidatePath } from "next/cache";
import { getItem, invalidateEdits } from "@/lib/catalog";
import { saveEdit, validateEdit } from "@/lib/edits";
import type { ItemEdit } from "@/lib/stac";
import { collectionHref, itemHref } from "@/lib/utils";

export type SaveState = { ok: true; edit: ItemEdit } | { ok: false; error: string; edit?: undefined } | { ok: null; edit?: undefined };

/**
 * Save QC for one item. There is no sign-in yet, so anyone who can reach the
 * app can write; put the app behind the deployment's auth (an ALB with OIDC,
 * or a VPN) until a user model exists. The edit record carries no author for
 * the same reason.
 */
export async function saveQcAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  const collection = String(form.get("collection") ?? "");
  const id = String(form.get("id") ?? "");
  try {
    const item = await getItem(collection, id);
    if (!item) return { ok: false, error: "Item not found." };
    const input = validateEdit({
      qc: form.get("qc"),
      date_approved: form.get("date_approved"),
      note: form.get("note"),
    });
    const edit = await saveEdit(item.source, collection, id, input);
    invalidateEdits(item.source);
    revalidatePath(itemHref(collection, id));
    revalidatePath(collectionHref(collection));
    revalidatePath("/");
    return { ok: true, edit };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Could not save: ${msg}` };
  }
}
