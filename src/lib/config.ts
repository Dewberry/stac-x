import "server-only";

import type { EnvKey } from "./env";

/**
 * Runtime configuration, all from the environment.
 *
 * Each of the three environments reads its own geoparquet sources:
 * STAC_SOURCES_DEV, STAC_SOURCES_TEST and STAC_SOURCES_PROD. Entries are
 * separated by commas or newlines and each one is:
 *
 *   s3://bucket/prefix/           every *.parquet and *.pq under the prefix
 *   s3://bucket/path/file.parquet one file
 *   ./data/dev                    every *.parquet and *.pq in a local folder
 *   ./data/dev/gages.parquet      one local file
 *
 * The first entry of an environment must be a folder or prefix, because
 * that's where a collection promoted into it is copied.
 *
 * With nothing set, the environments read ./data/dev, ./data/test and
 * ./data/prod, which is where the sample file starts (in dev), so a fresh
 * clone runs with no AWS account at all. STAC_SOURCES, from before there were
 * environments, is still read as Development's.
 */
const SOURCE_VARS: Record<EnvKey, string> = {
  dev: "STAC_SOURCES_DEV",
  test: "STAC_SOURCES_TEST",
  prod: "STAC_SOURCES_PROD",
};

export function sources(env: EnvKey): string[] {
  const raw = (process.env[SOURCE_VARS[env]] ?? (env === "dev" ? process.env.STAC_SOURCES : undefined))?.trim();
  if (!raw) return [`./data/${env}`];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Where a collection promoted into this environment is copied to. */
export function landingFolder(env: EnvKey): string {
  const first = sources(env)[0];
  if (/\.(geo)?parquet$|\.pq$/i.test(first)) {
    throw new Error(`${SOURCE_VARS[env]} must start with a folder or prefix to receive promoted collections, not a single file`);
  }
  return first.endsWith("/") ? first : `${first}/`;
}

export const catalogTitle = process.env.STAC_TITLE || "Colorado STAC";
export const catalogDescription =
  process.env.STAC_DESCRIPTION ||
  "Gages, models and storm catalogs for the South Platte. Open a collection to browse its items and record QC.";

/** How long a parsed file is trusted before its ETag is checked again. */
export const refreshMs = Number(process.env.STAC_REFRESH_SECONDS || 30) * 1000;

export const awsRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

/**
 * A link to an S3 object in Cloud View, Dewberry's internal browser for the
 * bucket, where people can find the file and download it. CLOUD_VIEW_URL is
 * a template: {bucket} and {key} are filled in from the s3:// href, so it
 * fits whatever shape Cloud View's links take. Null for anything outside S3,
 * or while the template isn't set.
 */
export function cloudViewHref(href: string): string | null {
  const template = process.env.CLOUD_VIEW_URL?.trim();
  const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(href);
  if (!template || !m) return null;
  const key = m[2].split("/").map(encodeURIComponent).join("/");
  return template.replaceAll("{bucket}", encodeURIComponent(m[1])).replaceAll("{key}", key);
}
