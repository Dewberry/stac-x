import "server-only";

import { getCatalog, invalidate } from "./catalog";
import { landingFolder } from "./config";
import { logEvent, updateEdits } from "./edits";
import { nextEnv, type EnvKey } from "./env";
import type { Collection } from "./stac";
import { baseName, parseRef, read, write } from "./storage";

/**
 * Move a collection forward one environment.
 *
 * Promotion copies the collection's parquet files byte for byte into the next
 * environment's landing folder, so what arrives is exactly what was approved,
 * never a regenerated copy. A file that already sits there under the same
 * name is replaced, which is how a fix made in Development reaches a
 * collection that was sent back from Testing.
 *
 * The copy in the next environment starts unreviewed: its QC record is
 * cleared, because an approval there was for the version it replaces. Both
 * sidecars log the move.
 *
 * A parquet file that also holds items of another collection is refused,
 * since copying it would promote that collection too. So is one whose name
 * is taken in the next environment by another collection, usually another
 * version of this one.
 */
export async function promote(env: EnvKey, c: Collection): Promise<EnvKey> {
  const to = nextEnv(env);
  if (!to) throw new Error("Production is the last environment; there is nowhere to promote to.");
  if (c.sources.length === 0) throw new Error("This collection has no source file to promote.");

  const catalog = await getCatalog(env);
  for (const uri of c.sources) {
    const total = catalog.sources.find((s) => s.uri === uri)?.itemCount ?? 0;
    const mine = c.items.filter((i) => i.source === uri).length;
    if (mine !== total) {
      throw new Error(`${baseName(uri)} also holds items of other collections, so it can't be promoted on its own.`);
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
      throw new Error(
        `${baseName(uri)} in ${to.label} already holds ${other}. Give this version's file its own name before sending it on.`,
      );
    }
  }

  const at = new Date().toISOString();
  const copied: string[] = [];
  for (const uri of c.sources) {
    const target = `${folder}${baseName(uri)}`;
    const { bytes } = await read(uri);
    await write(target, bytes, { contentType: "application/vnd.apache.parquet" });
    copied.push(target);
  }

  const names = copied.map(baseName);
  for (const target of copied) {
    await updateEdits(target, (edits) => {
      delete edits.collections[c.id];
      logEvent(edits, c.id, { kind: "received", at, from: env, files: names });
    });
  }
  await updateEdits(c.sources[0], (edits) => {
    logEvent(edits, c.id, { kind: "promoted", at, to: to.key, files: names });
  });

  invalidate(to.key);
  invalidate(env, c.sources[0]);
  return to.key;
}
