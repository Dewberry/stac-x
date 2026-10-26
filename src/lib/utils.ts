import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { withEnv, type EnvKey } from "./env";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The path the app is served under, like /stac, or "" at the root. next/link,
 * the router and redirects add it on their own. Plain <a> and <img> tags,
 * fetch, MapLibre's worker and links written into STAC JSON don't, so those
 * go through withBase.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

export function withBase(path: string) {
  return `${BASE_PATH}${path}`;
}

/* Every link inside the catalog stays in the environment it was made in. */

export function withEnvHome(env: EnvKey) {
  return withEnv(env, "/");
}

/** The home page with a catalog open in the rail, or the whole environment for null. */
export function scopeHref(env: EnvKey, slug: string | null) {
  return slug ? `${withEnvHome(env)}?in=${encodeURIComponent(slug)}` : withEnvHome(env);
}

export function collectionHref(env: EnvKey, id: string) {
  return withEnv(env, `/collections/${encodeURIComponent(id)}`);
}

export function itemHref(env: EnvKey, collection: string, id: string) {
  return withEnv(env, `/collections/${encodeURIComponent(collection)}/items/${encodeURIComponent(id)}`);
}

/* The JSON and asset URLs end up in plain <a> tags and STAC JSON, so they carry the base path. */

export function collectionJsonHref(env: EnvKey, id: string) {
  return withBase(withEnv(env, `/api/collections/${encodeURIComponent(id)}`));
}

export function itemJsonHref(env: EnvKey, collection: string, id: string) {
  return withBase(withEnv(env, `/api/collections/${encodeURIComponent(collection)}/items/${encodeURIComponent(id)}`));
}

export function assetHref(href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  return withBase(`/api/asset?href=${encodeURIComponent(href)}`);
}

/**
 * A Content-Disposition that saves the file under this name. The plain
 * filename keeps printable ASCII minus quotes and backslashes, since Node
 * refuses some header characters outright; filename* carries the real name
 * for browsers that read it, which is all current ones.
 */
export function attachment(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
