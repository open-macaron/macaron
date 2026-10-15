/**
 * Emits JSON Schema files for the file-based contracts, so non-TypeScript consumers
 * (the agent's prompt, the runner workflow) never guess a shape. CI fails on drift.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { GlobalFile, ProjectFile, RepoFile, RunContext, RunResult } from "../src/index.ts";

const outDir = join(import.meta.dirname, "..", "schemas");

const schemas: Readonly<Record<string, z.ZodType>> = {
  "run-context": RunContext,
  "run-result": RunResult,
  "config-global": GlobalFile,
  "config-project": ProjectFile,
  "config-repo": RepoFile,
};

await mkdir(outDir, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  await writeFile(join(outDir, `${name}.schema.json`), `${JSON.stringify(jsonSchema, null, 2)}\n`);
}
