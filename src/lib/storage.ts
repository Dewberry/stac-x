import "server-only";

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsRegion } from "./config";

/**
 * One small object-store interface over S3 and the local disk.
 *
 * Everything the app reads or writes goes through here: parquet files, the
 * edits sidecar, collection.json, asset previews. Local paths exist so the app
 * runs from a checkout with no credentials, and so a test can point at a
 * folder. S3 is the real target.
 *
 * Writes are conditional. S3 honors If-Match on PutObject, so two reviewers
 * saving QC on the same file at the same moment can't silently drop each
 * other's edit: the second write fails with 412 and the caller re-reads and
 * retries. Local files get the same contract by comparing a synthetic ETag.
 */

export type ObjectRef =
  | { kind: "s3"; bucket: string; key: string; uri: string }
  | { kind: "file"; path: string; uri: string };

export type ObjectHead = { etag: string; size: number };

export class PreconditionFailed extends Error {
  constructor(uri: string) {
    super(`Precondition failed writing ${uri}`);
    this.name = "PreconditionFailed";
  }
}

export class NotFound extends Error {
  constructor(uri: string) {
    super(`Not found: ${uri}`);
    this.name = "NotFound";
  }
}

export function parseRef(uri: string): ObjectRef {
  const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(uri);
  if (m) return { kind: "s3", bucket: m[1], key: m[2], uri };
  const path = uri.startsWith("file://") ? uri.slice(7) : uri;
  return { kind: "file", path: resolve(path), uri: `file://${resolve(path)}` };
}

export function isS3(uri: string) {
  return uri.startsWith("s3://");
}

/** The URI of a sibling object with a different suffix, in the same folder. */
export function sibling(uri: string, name: string): string {
  const ref = parseRef(uri);
  if (ref.kind === "s3") {
    const dir = ref.key.includes("/") ? ref.key.slice(0, ref.key.lastIndexOf("/") + 1) : "";
    return `s3://${ref.bucket}/${dir}${name}`;
  }
  return `file://${join(dirname(ref.path), name)}`;
}

export function baseName(uri: string): string {
  return uri.replace(/\/+$/, "").split("/").pop() ?? uri;
}

let client: S3Client | null = null;
function s3() {
  if (!client) client = new S3Client({ region: awsRegion });
  return client;
}

const PARQUET = /\.(geo)?parquet$|\.pq$/i;

/* ------------------------------------------------------------------ list */

/**
 * Expand a source entry into the parquet files it names. A URI that ends in a
 * slash, or a local folder, is listed; anything else is taken as one file.
 */
export async function listParquet(uri: string): Promise<string[]> {
  const ref = parseRef(uri);
  if (ref.kind === "s3") {
    if (!uri.endsWith("/")) return [uri];
    const out: string[] = [];
    let token: string | undefined;
    do {
      const res = await s3().send(
        new ListObjectsV2Command({ Bucket: ref.bucket, Prefix: ref.key, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key && PARQUET.test(o.Key)) out.push(`s3://${ref.bucket}/${o.Key}`);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out.sort();
  }
  const s = await stat(/*turbopackIgnore: true*/ ref.path).catch(() => null);
  if (!s) throw new NotFound(ref.uri);
  if (s.isFile()) return [ref.uri];
  const names = await readdir(/*turbopackIgnore: true*/ ref.path);
  return names
    .filter((n) => PARQUET.test(n))
    .sort()
    .map((n) => `file://${join(/*turbopackIgnore: true*/ ref.path, n)}`);
}

/* ------------------------------------------------------------------ head */

export async function head(uri: string): Promise<ObjectHead | null> {
  const ref = parseRef(uri);
  if (ref.kind === "s3") {
    try {
      const res = await s3().send(new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key }));
      return { etag: res.ETag ?? "", size: res.ContentLength ?? 0 };
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }
  const s = await stat(/*turbopackIgnore: true*/ ref.path).catch(() => null);
  if (!s) return null;
  return { etag: fileEtag(s.mtimeMs, s.size), size: s.size };
}

function fileEtag(mtimeMs: number, size: number) {
  return `"${createHash("sha1").update(`${mtimeMs}:${size}`).digest("hex").slice(0, 16)}"`;
}

/* ------------------------------------------------------------------ read */

export async function read(uri: string): Promise<{ bytes: Uint8Array; etag: string }> {
  const ref = parseRef(uri);
  if (ref.kind === "s3") {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }));
      const bytes = await res.Body!.transformToByteArray();
      return { bytes, etag: res.ETag ?? "" };
    } catch (e) {
      if (isMissing(e)) throw new NotFound(uri);
      throw e;
    }
  }
  const s = await stat(/*turbopackIgnore: true*/ ref.path).catch(() => null);
  if (!s) throw new NotFound(uri);
  const bytes = await readFile(/*turbopackIgnore: true*/ ref.path);
  return { bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), etag: fileEtag(s.mtimeMs, s.size) };
}

export async function readJson<T = unknown>(uri: string): Promise<{ value: T; etag: string }> {
  const { bytes, etag } = await read(uri);
  return { value: JSON.parse(new TextDecoder().decode(bytes)) as T, etag };
}

/** A byte range, for reading the head of a parquet file without the rest. */
export async function readRange(uri: string, start: number, end: number): Promise<ArrayBuffer> {
  const ref = parseRef(uri);
  if (ref.kind === "s3") {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key, Range: `bytes=${start}-${end - 1}` }),
    );
    const b = await res.Body!.transformToByteArray();
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  const handle = await readFile(/*turbopackIgnore: true*/ ref.path);
  return handle.buffer.slice(handle.byteOffset + start, handle.byteOffset + end) as ArrayBuffer;
}

/* ------------------------------------------------------------------ write */

export async function write(
  uri: string,
  body: string | Uint8Array,
  opts: { contentType?: string; ifMatch?: string | null } = {},
): Promise<{ etag: string }> {
  const ref = parseRef(uri);
  if (ref.kind === "s3") {
    try {
      const res = await s3().send(
        new PutObjectCommand({
          Bucket: ref.bucket,
          Key: ref.key,
          Body: body,
          ContentType: opts.contentType,
          // null means "must not exist yet"; a string means "must still be this version".
          ...(opts.ifMatch === null ? { IfNoneMatch: "*" } : {}),
          ...(opts.ifMatch ? { IfMatch: opts.ifMatch } : {}),
        }),
      );
      return { etag: res.ETag ?? "" };
    } catch (e) {
      if (e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 412 || e.$metadata.httpStatusCode === 409)) {
        throw new PreconditionFailed(uri);
      }
      throw e;
    }
  }
  const current = await head(uri);
  if (opts.ifMatch === null && current) throw new PreconditionFailed(uri);
  if (opts.ifMatch && current?.etag !== opts.ifMatch) throw new PreconditionFailed(uri);
  await writeFile(/*turbopackIgnore: true*/ ref.path, body);
  const after = await head(uri);
  return { etag: after?.etag ?? "" };
}

/* ------------------------------------------------------------------ links */

/**
 * A URL a browser can fetch for an asset. S3 assets get a presigned GET that
 * lasts an hour; local files are served by the asset route directly.
 */
export async function presign(uri: string, ttlSeconds = 3600): Promise<string> {
  const ref = parseRef(uri);
  if (ref.kind !== "s3") throw new Error("Only S3 objects can be presigned");
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }), {
    expiresIn: ttlSeconds,
  });
}

function isMissing(e: unknown) {
  return (
    e instanceof S3ServiceException &&
    (e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata.httpStatusCode === 404)
  );
}

/** Whether S3 calls have any chance of working: a region and some credential source. */
export function awsLooksConfigured() {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
      process.env.STAC_ASSUME_AWS,
  );
}
