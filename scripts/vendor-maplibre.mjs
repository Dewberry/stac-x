#!/usr/bin/env node
/**
 * Put MapLibre's worker where the browser can fetch it.
 *
 * MapLibre 6 finds its worker script by resolving `maplibre-gl-worker.mjs`
 * against `import.meta.url` of the module that created the map. Bundled, that
 * URL is a Next chunk under /_next/static/chunks, where no worker lives, so
 * the worker fails to start and the map never draws a tile or a feature.
 *
 * So the worker and the shared module it imports are copied out of
 * node_modules into public/vendor, and the map component points MapLibre at
 * them with setWorkerUrl(). Runs before `next dev` and `next build` (predev
 * and prebuild in package.json), which keeps the copies at the installed
 * version. public/vendor is generated and ignored by git.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "vendor", "maplibre-gl");
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, f), join(out, f));
}
