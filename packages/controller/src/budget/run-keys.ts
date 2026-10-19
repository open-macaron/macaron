import { z } from "zod";

/** Where a run's LLM key lives. Stored on each run, so a run is always settled where its key was minted. */
export const LlmBackend = z.enum(["openrouter", "bifrost"]);
export type LlmBackend = z.infer<typeof LlmBackend>;

export interface ProvisionedKey {
  /** The bearer key, shown once at creation. */
  readonly key: string;
  /** The backend's id for the key: what every later call (disable, usage, delete) refers to. */
  readonly hash: string;
}

export interface KeyStatus {
  readonly hash: string;
  readonly name: string;
  readonly disabled: boolean;
  readonly createdAt: Date;
}

/**
 * Per-run LLM keys, capped and self-expiring: the only port BudgetService and Housekeeping see.
 * Implementations hold the credential that mints keys; it never leaves them.
 */
export abstract class RunKeys {
  abstract readonly backend: LlmBackend;
  /** Where runners send Anthropic Messages requests with a minted key. */
  abstract readonly baseUrl: string;
  /** How long after a key is frozen before its usage is complete enough to read. */
  abstract readonly usageLagMs: number;

  /** Checks the backend is usable before the controller accepts work. */
  abstract init(): Promise<void>;
  /** A key capped at `limitUsd`, refused after `expiresAt`, and usable only with `models` where the backend can restrict them. */
  abstract create(name: string, limitUsd: number, expiresAt: Date, models: readonly string[]): Promise<ProvisionedKey>;
  /** Immediate: the next request made with the key is refused. */
  abstract disable(hash: string): Promise<void>;
  /** Idempotent: deleting a key that is already gone is not an error. */
  abstract delete(hash: string): Promise<void>;
  /** Every key whose name starts with `prefix`, disabled ones included. */
  abstract listByPrefix(prefix: string): Promise<KeyStatus[]>;
  /** What the key spent, in USD, between `since` (a little before the run started) and now. */
  abstract spentSince(hash: string, since: Date): Promise<number>;
}
