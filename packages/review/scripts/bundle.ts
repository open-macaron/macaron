// Bundles the macaron-review CLI and its dependencies into one ES module: the npm package ships
// this single file (with a minimal manifest, see release-review.yml), nothing to install.
import { build } from "esbuild";

await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist-cli/macaron-review.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  conditions: ["@open-macaron/source"],
  legalComments: "linked",
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});
