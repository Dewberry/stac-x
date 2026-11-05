import type { NextConfig } from "next";

// A checkout on a Windows drive seen from WSL never delivers filesystem
// events, so the dev server has to poll instead. Off unless asked for.
const pollIntervalMs = Number(process.env.NEXT_WATCH_POLL_MS) || 0;

// The path the app is served under when it shares a domain, like /stac.
// Next bakes it into the build, so it's set at build time, not at run time.
// The same variable gives src/lib/utils.ts the prefix for URLs Next doesn't
// rewrite itself.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
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
