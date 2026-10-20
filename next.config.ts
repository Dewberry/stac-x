import type { NextConfig } from "next";

// A checkout on a Windows drive seen from WSL never delivers filesystem
// events, so the dev server has to poll instead. Off unless asked for.
const pollIntervalMs = Number(process.env.NEXT_WATCH_POLL_MS) || 0;

const nextConfig: NextConfig = {
  // `next build` also writes .next/standalone, a self-contained server with
  // only the node_modules it needs. The Dockerfile copies that in.
  output: "standalone",
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
