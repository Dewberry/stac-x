import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import pkg from "./package.json";

// A checkout on a Windows drive seen from WSL never delivers filesystem
// events, so the dev server has to poll instead. Off unless asked for.
const pollIntervalMs = Number(process.env.NEXT_WATCH_POLL_MS) || 0;

// The path the app is served under when it shares a domain, like /stac.
// Next bakes it into the build, so it's set at build time, not at run time.
// The same variable gives src/lib/utils.ts the prefix for URLs Next doesn't
// rewrite itself.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

// Which build this is, for src/lib/build.ts: the version, the commit and
// the time of the build. CI numbers each merge to main and hands the
// version in as APP_VERSION, with the commit as APP_COMMIT (the Docker build
// has no .git to ask); a checkout shows package.json's version and asks git. The time is
// kept in the environment so the processes `next build` starts all get the
// same one, and is left empty under `next dev`, which isn't a build.
function buildCommit(): string {
  const given = process.env.APP_COMMIT?.trim();
  if (given) return given;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}
const isDev = process.env.NODE_ENV === "development";
if (!isDev) process.env.APP_BUILT_AT ||= new Date().toISOString();
const commit = buildCommit();

const nextConfig: NextConfig = {
  // Written into the server and browser code at build time, so a page keeps
  // the build it was loaded from.
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION?.trim() || pkg.version,
    NEXT_PUBLIC_APP_COMMIT: commit,
    NEXT_PUBLIC_APP_BUILT_AT: process.env.APP_BUILT_AT ?? "",
  },
  // Names the build to Next itself. When a tab from an older build asks the
  // server for a page, Next sees the ids differ and loads the page whole
  // instead of patching new content into old code, so most people pick up a
  // deployment on their next click. Asset URLs carry it as ?dpl=, which
  // also keeps a browser or proxy from serving the last build's files.
  ...(commit && !isDev ? { deploymentId: commit } : {}),
  // `next build` also writes .next/standalone, a self-contained server with
  // only the node_modules it needs. The Dockerfile copies that in.
  output: "standalone",
  // Parquet files are decoded by a child process (src/lib/parquet.ts). Node
  // runs that process's file as it is, so the file and the packages it
  // imports have to be in the standalone build as files, where the tracer
  // doesn't look for them on its own. The Dockerfile loads the file once
  // to check they all made it.
  outputFileTracingIncludes: {
    "/*": [
      "src/lib/parquet-worker.mjs",
      "node_modules/hyparquet/**/*",
      "node_modules/hyparquet-compressors/**/*",
      "node_modules/fzstd/**/*",
      "node_modules/hysnappy/**/*",
    ],
  },
  ...(basePath ? { basePath } : {}),
  poweredByHeader: false,
  // No framing, so the QC form can't be clickjacked, and no MIME sniffing.
  // A full script CSP is left for later: MapLibre's workers and the
  // configurable tile hosts need testing before one can go on.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  ...(pollIntervalMs > 0 ? { watchOptions: { pollIntervalMs } } : {}),
};

export default nextConfig;
