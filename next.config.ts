import type { NextConfig } from "next";

// A checkout on a Windows drive seen from WSL never delivers filesystem
// events, so the dev server has to poll instead. Off unless asked for.
const pollIntervalMs = Number(process.env.NEXT_WATCH_POLL_MS) || 0;

const nextConfig: NextConfig = {
  // `next build` also writes .next/standalone, a self-contained server with
  // only the node_modules it needs. The Dockerfile copies that in.
  output: "standalone",
  ...(pollIntervalMs > 0 ? { watchOptions: { pollIntervalMs } } : {}),
};

export default nextConfig;
