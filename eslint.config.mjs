import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Next turns on a handful of jsx-a11y rules; the app is shown to clients
  // and has to meet WCAG 2.2 AA, so it gets the plugin's whole recommended
  // set. The plugin itself is already registered by eslint-config-next.
  { files: ["**/*.{jsx,tsx}"], rules: jsxA11y.flatConfigs.recommended.rules },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MapLibre's worker, copied in by scripts/vendor-maplibre.mjs.
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
