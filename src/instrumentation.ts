import type { Instrumentation } from "next";

/**
 * Read every environment's catalog as the server starts, so the first
 * person to open a page doesn't wait on S3 for it. Not awaited: the server
 * takes requests straight away, and one that arrives before the read is
 * done joins it (see lib/catalog.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getCatalog }, { ENVS }] = await Promise.all([import("./lib/catalog"), import("./lib/env")]);
  for (const e of ENVS) void getCatalog(e.key).catch(() => {});
}

/**
 * One line in the log for every error a request ends in, saying which
 * route it was and, for a page, the reference the error card shows the
 * person who hit it, so the two can be matched up. Next logs the error
 * itself, with its stack, right beside this.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  const what = error instanceof Error ? error.message : String(error);
  console.error(
    `stac-x: ${request.method} ${request.path} failed in ${context.routePath} (${context.routeType})${digest ? `, reference ${digest}` : ""}: ${what}`,
  );
};
