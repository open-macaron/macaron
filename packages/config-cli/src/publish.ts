import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CommitSha, PublishedConfig } from "@open-macaron/contracts";

/**
 * Writes `v1/config.json` under `outDir`: the configuration's files verbatim at `commit`, which the
 * controller fetches and validates exactly as a local tree. Returns the path written.
 */
export async function publish(files: ReadonlyMap<string, string>, commit: CommitSha, outDir: string): Promise<string> {
  // Sorted keys: the same tree always publishes the same bytes, so Pages' ETag only moves with content.
  const snapshot = PublishedConfig.parse({ version: 1, commit, files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b))) });
  await mkdir(join(outDir, "v1"), { recursive: true });
  await writeFile(join(outDir, "v1", "config.json"), `${JSON.stringify(snapshot)}\n`);
  return "v1/config.json";
}
