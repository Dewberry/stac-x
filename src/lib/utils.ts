import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { withEnv, type EnvKey } from "./env";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* Every link inside the catalog stays in the environment it was made in. */

export function withEnvHome(env: EnvKey) {
  return withEnv(env, "/");
}

export function collectionHref(env: EnvKey, id: string) {
  return withEnv(env, `/collections/${encodeURIComponent(id)}`);
}

export function itemHref(env: EnvKey, collection: string, id: string) {
  return withEnv(env, `/collections/${encodeURIComponent(collection)}/items/${encodeURIComponent(id)}`);
}

export function collectionJsonHref(env: EnvKey, id: string) {
  return withEnv(env, `/api/collections/${encodeURIComponent(id)}`);
}

export function itemJsonHref(env: EnvKey, collection: string, id: string) {
  return withEnv(env, `/api/collections/${encodeURIComponent(collection)}/items/${encodeURIComponent(id)}`);
}

export function assetHref(href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  return `/api/asset?href=${encodeURIComponent(href)}`;
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
