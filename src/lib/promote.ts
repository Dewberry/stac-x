import "server-only";

import { getCatalog, invalidate } from "./catalog";
import { landingFolder } from "./config";
import { editsUri, logEvent, readEdits, updateEdits } from "./edits";
import { envMeta, nextEnv, type EnvKey } from "./env";
import { Refused } from "./refused";
import type { Collection } from "./stac";
import { baseName, copy, isJsonSource, parseRef } from "./storage";

/**
 * Move a collection forward one environment.
 *
 * Promotion copies the collection's parquet files byte for byte into the next
 * environment's landing folder, so what arrives is exactly what was approved,
 * never a regenerated copy. The storage does the copying (S3 from one key
 * to another, the disk from one file to another), so a large file never
 * passes through this server's memory. A file that already sits there under
 * the same name is replaced, which is how a fix made in Development reaches
 * a collection that was sent back from Test.
 *
 * The copy in the next environment starts unreviewed: its QC record is
 * cleared, because an approval there was for the version it replaces. Both
 * sidecars log the move.
 *
 * A parquet file that also holds items of another collection is refused,
 * since copying it would promote that collection too. So is one whose name
 * is taken in the next environment by another collection, usually another
 * version of this one, and one whose sidecar in the next environment can't
 * be read, since the move couldn't be logged there. All of that is checked
 * before the first byte is copied, and what's refused is said in words
 * meant for the reviewer (Refused).
 */
/**
 * Whether approving can copy this collection on. One read through a STAC
 * catalog can't be yet: it would need its collection.json and parquet file
 * copied together and a child link added to the next catalog. Until that's
 * built, approving it records the decision and says the copy is coming soon.
 */
export function canPromote(c: Pick<Collection, "sources">): boolean {
  return c.sources.length > 0 && !c.sources.some(isJsonSource);
}

export async function promote(env: EnvKey, c: Collection): Promise<EnvKey> {
  const to = nextEnv(env);
  if (!to) throw new Refused(`Nothing is promoted out of ${envMeta(env).label}.`);
  if (c.sources.length === 0) throw new Refused("This collection has no source file to promote.");
  if (!canPromote(c)) {
    throw new Refused("This collection comes from a STAC catalog, which can't be sent to the next environment yet.");
  }

  const catalog = await getCatalog(env);
  for (const uri of c.sources) {
    const source = catalog.sources.find((s) => s.uri === uri);
    const total = source?.itemCount ?? 0;
    const mine = c.items.filter((i) => i.source === uri).length;
    if (mine !== total || source?.collections.some((id) => id !== c.id)) {
      throw new Refused(`${baseName(uri)} also holds other collections, so it can't be promoted on its own.`);
    }
  }

  // Files land by name alone, so two versions whose files share a name
  // (v1/gages.parquet, v2/gages.parquet) would replace each other there.
  const folder = landingFolder(to.key);
  const there = await getCatalog(to.key);
  for (const uri of c.sources) {
    const landing = parseRef(`${folder}${baseName(uri)}`).uri;
    const target = there.sources.find((s) => parseRef(s.uri).uri === landing);
    const other = target?.collections.find((id) => id !== c.id);
    if (other) {
      throw new Refused(
        `${baseName(uri)} in ${to.label} already holds ${other}. Give this version's file its own name before sending it on.`,
      );
    }
    // The copy's sidecar is written to below. If it can't be, the file
    // shouldn't be copied either.
    const { unreadable } = await readEdits(landing);
    if (unreadable) {
      throw new Refused(
        `${baseName(editsUri(landing))} in ${to.label}, the review record beside this file's copy there, can't be read (${unreadable}), so nothing was copied. Fix or delete that file first.`,
      );
    }
  }

  const at = new Date().toISOString();
  const copied: string[] = [];
  for (const uri of c.sources) {
    const target = `${folder}${baseName(uri)}`;
    await copy(uri, target, { contentType: "application/vnd.apache.parquet" });
    copied.push(target);
  }

  // Sidecars are keyed by the id the file's own metadata gives the collection.
  const names = copied.map(baseName);
  for (const target of copied) {
    await updateEdits(target, (edits) => {
      delete edits.collections[c.stacId];
      logEvent(edits, c.stacId, { kind: "received", at, from: env, files: names });
    });
  }
  await updateEdits(c.sources[0], (edits) => {
    logEvent(edits, c.stacId, { kind: "promoted", at, to: to.key, files: names });
  });

  invalidate(to.key);
  invalidate(env, c.sources[0]);
  return to.key;
}
