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
