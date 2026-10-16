// Lays out the npm package in dist-npm/: the bundled CLI, the README, the license and a manifest
// without dependencies. The workspace manifest can't be published as is: it depends on the
// private @open-macaron/contracts, which the bundle already contains.
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";

const Workspace = z.object({ name: z.string(), version: z.string(), description: z.string(), license: z.string() });
const workspace = Workspace.parse(JSON.parse(await readFile("package.json", "utf8")));

await rm("dist-npm", { recursive: true, force: true });
await mkdir("dist-npm");
await copyFile("dist-cli/macaron-review.mjs", "dist-npm/macaron-review.mjs");
await copyFile("README.md", "dist-npm/README.md");
await copyFile("../../LICENSE", "dist-npm/LICENSE");

const manifest = {
  name: workspace.name,
  version: workspace.version,
  description: workspace.description,
  license: workspace.license,
  type: "module",
  bin: { "macaron-review": "macaron-review.mjs" },
  files: ["macaron-review.mjs"],
  engines: { node: ">=24" },
  // npm checks provenance against this repository: it must be the one whose workflow publishes.
  repository: { type: "git", url: "git+https://github.com/open-macaron/macaron.git", directory: "packages/review" },
  homepage: "https://github.com/open-macaron/macaron/tree/main/packages/review#readme",
};
await writeFile("dist-npm/package.json", `${JSON.stringify(manifest, null, 2)}\n`);
