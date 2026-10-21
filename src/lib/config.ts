import "server-only";

import type { EnvKey } from "./env";

/**
 * Runtime configuration, all from the environment.
 *
 * Each of the four environments reads its own sources: STAC_SOURCES_SANDBOX,
 * STAC_SOURCES_DEV, STAC_SOURCES_TEST and STAC_SOURCES_PROD. Entries are
 * separated by commas or newlines and each one is:
 *
 *   s3://bucket/prefix/           every *.parquet, *.pq and catalog.json under the prefix
 *   s3://bucket/path/file.parquet one file
 *   s3://bucket/path/catalog.json a STAC catalog, followed to its collections
 *                                 (catalog-v1.json and other versioned names too)
 *   ./data/dev                    every *.parquet, *.pq and catalog.json in a local folder
 *   ./data/dev/gages.parquet      one local file
 *
 * The first entry of an environment must be a folder, a prefix or a
 * catalog.json, because that's where a collection promoted into it is
 * copied (a catalog's own folder, for a catalog).
 *
 * An environment whose variable isn't set reads nothing, so its pages load
 * empty. STAC_SOURCES, from before there were environments, is still read as
 * Development's.
 */
const SOURCE_VARS: Record<EnvKey, string> = {
  sandbox: "STAC_SOURCES_SANDBOX",
  dev: "STAC_SOURCES_DEV",
  test: "STAC_SOURCES_TEST",
  prod: "STAC_SOURCES_PROD",
};

export function sources(env: EnvKey): string[] {
  const raw = (process.env[SOURCE_VARS[env]] ?? (env === "dev" ? process.env.STAC_SOURCES : undefined))?.trim();
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Where a collection promoted into this environment is copied to. */
export function landingFolder(env: EnvKey): string {
  const first = sources(env)[0];
  if (!first) throw new Error(`${SOURCE_VARS[env]} isn't set, so there's no folder to receive promoted collections`);
  if (/\.(geo)?parquet$|\.pq$/i.test(first)) {
    throw new Error(`${SOURCE_VARS[env]} must start with a folder or prefix to receive promoted collections, not a single file`);
  }
  if (/(^|\/)catalog[^/]*\.json$/i.test(first)) return first.slice(0, first.lastIndexOf("/") + 1) || "./";
  return first.endsWith("/") ? first : `${first}/`;
}

export const catalogTitle = process.env.STAC_TITLE || "STAC";
export const catalogDescription =
  process.env.STAC_DESCRIPTION ||
  "Collections from the STAC catalog. Open a collection to browse its items and record QC.";

/** How long a parsed file is trusted before its ETag is checked again. */
export const refreshMs = Number(process.env.STAC_REFRESH_SECONDS || 30) * 1000;

export const awsRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

/**
 * A link to an S3 object in Cloud View's Bucket View, Dewberry's internal
 * browser for the bucket, where people can find the file and download it.
 * CLOUD_VIEW_URL is a template filled in from the s3:// href, so it fits
 * whatever shape the links take: {bucket}, {key} as a path, and {prefix},
 * the folder the object is in, as a query value (Bucket View opens folders,
 * not files). Null for anything outside S3, or while the template isn't set.
 */
export function cloudViewHref(href: string): string | null {
  const template = process.env.CLOUD_VIEW_URL?.trim();
  const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(href);
  if (!template || !m) return null;
  const key = m[2].split("/").map(encodeURIComponent).join("/");
  const prefix = m[2].slice(0, m[2].lastIndexOf("/") + 1);
  return template
    .replaceAll("{bucket}", encodeURIComponent(m[1]))
    .replaceAll("{key}", key)
    .replaceAll("{prefix}", encodeURIComponent(prefix));
}
