import { Inject, Injectable } from "@nestjs/common";
import { Changes, RESULT_ARTIFACT_NAME, RunResult } from "@open-macaron/contracts";
import { unzipSync } from "fflate";
import { z } from "zod";
import { DomainError } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { GH_INTERACT, type GitHub } from "../github/github.ts";
import { repoRef } from "../github/repo-ref.ts";

export class ArtifactInvalid extends DomainError {
  readonly code = "artifact_invalid";
}

export interface RunArtifact {
  readonly result: RunResult;
  readonly changes: Changes | undefined;
  /** `media/<file>` → bytes. */
  readonly media: ReadonlyMap<string, Uint8Array>;
}

export interface ArtifactLimits {
  readonly maxZipBytes: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_ARTIFACT_LIMITS: ArtifactLimits = {
  maxZipBytes: 120_000_000,
  maxEntryBytes: 60_000_000,
  maxTotalBytes: 150_000_000,
};

const MEDIA_ENTRY = /^media\/[A-Za-z0-9._-]+$/;
const KNOWN_ENTRY = (name: string) => name === "result.json" || name === "changes.json" || MEDIA_ENTRY.test(name);

/**
 * Unpacks a run's artifact. Untrusted input: entries are size-checked before inflating
 * (no zip bombs), unknown entries are ignored, JSON goes through the contracts' schemas.
 */
export function readArtifact(zip: Uint8Array, limits: ArtifactLimits = DEFAULT_ARTIFACT_LIMITS): RunArtifact {
  if (zip.length > limits.maxZipBytes) throw new ArtifactInvalid(`artifact is ${String(zip.length)} bytes`);
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (file) => {
        if (!KNOWN_ENTRY(file.name)) return false;
        if (file.originalSize > limits.maxEntryBytes) throw new ArtifactInvalid(`${file.name} is too large`);
        total += file.originalSize;
        if (total > limits.maxTotalBytes) throw new ArtifactInvalid("artifact content is too large");
        return true;
      },
    });
  } catch (error: unknown) {
    if (error instanceof ArtifactInvalid) throw error;
    throw new ArtifactInvalid("artifact is not a readable zip", { cause: error });
  }

  const json = <T>(name: string, schema: z.ZodType<T>): T | undefined => {
    const bytes = entries[name];
    if (bytes === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      throw new ArtifactInvalid(`${name} is not valid JSON`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) throw new ArtifactInvalid(`${name} does not match its schema: ${z.prettifyError(result.error)}`);
    return result.data;
  };

  const result = json("result.json", RunResult);
  if (result === undefined) throw new ArtifactInvalid("result.json is missing");
  const media = new Map(Object.entries(entries).filter(([name]) => MEDIA_ENTRY.test(name)));
  return { result, changes: json("changes.json", Changes), media };
}

/** Fetches a run's result artifact from the (public) runner repository: read access is enough. */
@Injectable()
export class ArtifactDownloader {
  constructor(
    @Inject(GH_INTERACT) private readonly gh: GitHub,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** The zip bytes, or undefined when the run uploaded no result artifact. */
  async download(runId: number, limits: ArtifactLimits = DEFAULT_ARTIFACT_LIMITS): Promise<Uint8Array | undefined> {
    const runner = repoRef(this.env.RUNNER_REPO);
    const { data } = await this.gh.rest.actions.listWorkflowRunArtifacts({ ...runner, run_id: runId, name: RESULT_ARTIFACT_NAME });
    const artifact = data.artifacts.find((candidate) => candidate.name === RESULT_ARTIFACT_NAME && !candidate.expired);
    if (artifact === undefined) return undefined;
    if (artifact.size_in_bytes > limits.maxZipBytes) throw new ArtifactInvalid(`artifact is ${String(artifact.size_in_bytes)} bytes`);
    const response = await this.gh.rest.actions.downloadArtifact({ ...runner, artifact_id: artifact.id, archive_format: "zip" });
    if (!(response.data instanceof ArrayBuffer)) throw new ArtifactInvalid("unexpected artifact download payload");
    return new Uint8Array(response.data);
  }
}
