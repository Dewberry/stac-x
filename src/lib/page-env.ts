import "server-only";

import { notFound } from "next/navigation";
import { isEnv, type EnvKey } from "./env";

/** The environment a page was asked for, from its [env] param. Anything else is a 404. */
export async function pageEnv(params: Promise<{ env: string }>): Promise<EnvKey> {
  const { env } = await params;
  if (!isEnv(env)) notFound();
  return env;
}

/**
 * A dynamic segment's value in a page component: a collection or item id.
 *
 * Next gives a page component its params still percent-encoded (they're
 * the router tree's segment keys, so "a b" arrives as "a%20b" and "50%" as
 * "50%25"), and gives generateMetadata and route handlers the decoded
 * value. That's Next 16.4.2, the same under `next dev` and a build. So a
 * page decodes once, here, and nothing else decodes at all: decoding a
 * value Next had already decoded threw on any id with a "%" in it.
 *
 * If a later Next hands pages the decoded value too, a "%" that isn't an
 * escape makes the decode throw, and the value is used as it came.
 */
export function pageParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
