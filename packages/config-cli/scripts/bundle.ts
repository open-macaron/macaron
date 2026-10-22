// Bundles the CLI and its dependencies into one ES module, so the config workflows download a single
// pinned file (checked by sha256) instead of installing anything.
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/config-cli.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  conditions: ["@open-macaron/source"],
  legalComments: "linked",
  sourcemap: "linked",
  // CommonJS dependencies bundled into ESM need a require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});
