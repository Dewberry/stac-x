import "server-only";

import { notFound } from "next/navigation";
import { isEnv, type EnvKey } from "./env";

/** The environment a page was asked for, from its [env] param. Anything else is a 404. */
export async function pageEnv(params: Promise<{ env: string }>): Promise<EnvKey> {
  const { env } = await params;
  if (!isEnv(env)) notFound();
  return env;
}
