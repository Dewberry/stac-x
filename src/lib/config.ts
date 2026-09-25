import "server-only";

/**
 * Runtime configuration, all from the environment.
 *
 * STAC_SOURCES lists where the geoparquet files live. Entries are separated by
 * commas or newlines and each one is:
 *
 *   s3://bucket/prefix/           every *.parquet and *.pq under the prefix
 *   s3://bucket/path/file.parquet one file
 *   ./data                        every *.parquet and *.pq in a local folder
 *   ./data/gages.parquet          one local file
 *
 * With nothing set the app reads ./data, which is where the sample file sits,
 * so a fresh clone runs with no AWS account at all.
 */
export function sources(): string[] {
  const raw = process.env.STAC_SOURCES?.trim();
  if (!raw) return ["./data"];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const catalogTitle = process.env.STAC_TITLE || "Colorado STAC";
export const catalogDescription =
  process.env.STAC_DESCRIPTION ||
  "Items for the Colorado pilot, read straight from stac-geoparquet files in S3.";

/** How long a parsed file is trusted before its ETag is checked again. */
export const refreshMs = Number(process.env.STAC_REFRESH_SECONDS || 30) * 1000;

export const awsRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
