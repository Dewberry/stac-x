import "server-only";

import { getCatalog } from "./catalog";
import { sources } from "./config";
import { ENVS, type EnvKey } from "./env";
import type { Collection } from "./stac";
import { parseRef } from "./storage";

/**
 * A collection's versions that live in another environment.
 *
 * The generator's version links can cross buckets: Development's
 * stream-gages 1.0 names the copy in the Sandbox bucket as its
 * predecessor. That copy isn't read into Development (stac-json.ts stops
 * at the bucket), because it's the Sandbox environment's collection,
 * reviewed there. But the pages can still offer it: the bucket says which
 * environment it is, and that environment's catalog says which of its
 * collections the file became. A link whose bucket no environment reads,
 * or whose file that environment didn't load, is left out.
 */

export type VersionElsewhere = {
  env: EnvKey;
  collection: Collection;
  rel: string;
  /** The version label, from the collection's series or its own metadata. */
  label: string | null;
};

export async function versionsElsewhere(env: EnvKey, c: Collection): Promise<VersionElsewhere[]> {
  const out: VersionElsewhere[] = [];
  for (const link of c.versionsElsewhere) {
    const other = envOfBucket(link.href, env);
    if (!other) continue;
    const { collections } = await getCatalog(other);
    const found = collections.find((x) => x.docHref === link.href);
    if (!found || out.some((v) => v.env === other && v.collection.id === found.id)) continue;
    out.push({
      env: other,
      collection: found,
      rel: link.rel,
      label: found.series.versions.find((v) => v.id === found.id)?.label ?? found.version,
    });
  }
  return out;
}

/**
 * The environment whose sources hold the href, other than this one: the
 * one reading the href's bucket, or for a local path, the one whose folder
 * it's under.
 */
function envOfBucket(href: string, here: EnvKey): EnvKey | null {
  const ref = parseRef(href);
  for (const e of ENVS) {
    if (e.key === here) continue;
    for (const source of sources(e.key).map(parseRef)) {
      if (ref.kind === "s3" && source.kind === "s3" && source.bucket === ref.bucket) return e.key;
      if (ref.kind === "file" && source.kind === "file" && ref.path.startsWith(folderOf(source.path))) return e.key;
    }
  }
  return null;
}

/** A source entry's folder: the entry itself, or the folder of a file it names. */
function folderOf(path: string): string {
  return /\.(json|(geo)?parquet|pq)$/i.test(path) ? path.slice(0, path.lastIndexOf("/") + 1) : path.replace(/\/?$/, "/");
}
