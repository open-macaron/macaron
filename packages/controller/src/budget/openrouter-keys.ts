import { Logger } from "@nestjs/common";
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { apiKeysCreate } from "@openrouter/sdk/funcs/apiKeysCreate.js";
import { apiKeysDelete } from "@openrouter/sdk/funcs/apiKeysDelete.js";
import { apiKeysGet } from "@openrouter/sdk/funcs/apiKeysGet.js";
import { apiKeysList } from "@openrouter/sdk/funcs/apiKeysList.js";
import { apiKeysUpdate } from "@openrouter/sdk/funcs/apiKeysUpdate.js";
import { workspacesList } from "@openrouter/sdk/funcs/workspacesList.js";
import { z } from "zod";
import { UpstreamError } from "../common/errors.ts";
import { type KeyStatus, type ProvisionedKey, RunKeys } from "./run-keys.ts";

export interface OpenRouterSettings {
  /** OpenRouter's API, for key management and analytics. */
  readonly baseUrl: string;
  /** Slug of the workspace holding every key we create, so its dashboard shows the bot's total spend. */
  readonly workspace: string;
  readonly provisioningKey: string;
}

/** Where Claude Code finds OpenRouter's Anthropic Messages endpoint. */
const ANTHROPIC_BASE_URL = "https://openrouter.ai/api";

/** OpenRouter's own figure for a key; its `usage` is unreliable outside the default workspace (see spentSince). */
export interface OpenRouterKeyStatus extends KeyStatus {
  readonly usageUsd: number;
}

const AnalyticsResponse = z.object({
  data: z.object({ data: z.array(z.object({ total_usage: z.coerce.number().nonnegative().optional() })) }),
});

/** HTTP status carried by the SDK's typed errors, when there is one. */
function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return undefined;
}

/**
 * OpenRouter key management through the official SDK (generated from OpenRouter's OpenAPI
 * spec, responses validated with Zod). Authenticated with the provisioning key, which never
 * leaves this class. Every key lives in one workspace, so its dashboard is the bot's total spend.
 */
export class OpenRouterKeys extends RunKeys {
  readonly backend = "openrouter";
  readonly baseUrl = ANTHROPIC_BASE_URL;
  /** OpenRouter reports usage ~25 s late (measured); the first read waits comfortably longer. */
  readonly usageLagMs = 90_000;
  private readonly logger = new Logger(OpenRouterKeys.name);
  private readonly core: OpenRouterCore;
  private resolvedWorkspaceId: string | undefined;

  constructor(private readonly settings: OpenRouterSettings) {
    super();
    this.core = new OpenRouterCore({ apiKey: settings.provisioningKey, serverURL: settings.baseUrl, timeoutMs: 30_000 });
  }

  /** Resolves the workspace slug once; refuses to start rather than create keys in the wrong workspace. */
  async init(): Promise<void> {
    for (let offset = 0; ; ) {
      const result = await workspacesList(this.core, { offset, limit: 100 });
      if (!result.ok) throw this.failure("list workspaces", result.error);
      const page = result.value.result.data;
      const match = page.find((workspace) => workspace.slug === this.settings.workspace);
      if (match !== undefined) {
        this.resolvedWorkspaceId = match.id;
        this.logger.log(`OpenRouter keys live in workspace "${match.slug}"`);
        return;
      }
      if (page.length === 0) throw new Error(`OpenRouter workspace "${this.settings.workspace}" not found`);
      offset += page.length;
    }
  }

  private get workspaceId(): string {
    if (this.resolvedWorkspaceId === undefined) throw new Error("OpenRouter workspace not resolved yet");
    return this.resolvedWorkspaceId;
  }

  /** OpenRouter keys can't be restricted to models: `models` is only enforced by the backends that can. */
  async create(name: string, limitUsd: number, expiresAt: Date, _models: readonly string[]): Promise<ProvisionedKey> {
    const result = await apiKeysCreate(this.core, {
      requestBody: { name, limit: limitUsd, limitReset: null, includeByokInLimit: true, expiresAt, workspaceId: this.workspaceId },
    });
    if (!result.ok) throw this.failure("create key", result.error);
    return { key: result.value.key, hash: result.value.data.hash };
  }

  async status(hash: string): Promise<OpenRouterKeyStatus> {
    const result = await apiKeysGet(this.core, { hash });
    if (!result.ok) throw this.failure("get key", result.error);
    const { data } = result.value;
    return { hash: data.hash, name: data.name, usageUsd: data.usage, disabled: data.disabled, createdAt: new Date(data.createdAt) };
  }

  async disable(hash: string): Promise<void> {
    const result = await apiKeysUpdate(this.core, { hash, requestBody: { disabled: true } });
    if (!result.ok) throw this.failure("disable key", result.error);
  }

  async delete(hash: string): Promise<void> {
    const result = await apiKeysDelete(this.core, { hash });
    if (!result.ok && statusOf(result.error) !== 404) throw this.failure("delete key", result.error);
  }

  async listByPrefix(prefix: string): Promise<OpenRouterKeyStatus[]> {
    const found: OpenRouterKeyStatus[] = [];
    for (let offset = 0; ; ) {
      const result = await apiKeysList(this.core, { offset, includeDisabled: true, workspaceId: this.workspaceId });
      if (!result.ok) throw this.failure("list keys", result.error);
      const page = result.value.data;
      for (const key of page) {
        if (key.name.startsWith(prefix)) {
          found.push({ hash: key.hash, name: key.name, usageUsd: key.usage, disabled: key.disabled, createdAt: new Date(key.createdAt) });
        }
      }
      if (page.length === 0) return found;
      offset += page.length;
    }
  }

  /**
   * What a key really spent, from OpenRouter's analytics (the source of its Activity dashboard),
   * between `since` and now. Works for disabled and deleted keys.
   *
   * Why not the key's own `usage` field: it stayed at $0 for keys in a non-default workspace
   * (measured on 2026-10-15) while analytics had the real cost. Why plain fetch: the SDK's
   * generated schema types analytics rows as `{}` and strips every field.
   */
  async spentSince(hash: string, since: Date): Promise<number> {
    const response = await fetch(`${this.settings.baseUrl}/analytics/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.settings.provisioningKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        metrics: ["total_usage"],
        filters: [{ field: "api_key_id", operator: "eq", value: hash }],
        time_range: { start: since.toISOString(), end: new Date().toISOString() },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new UpstreamError("openrouter", `analytics query failed (HTTP ${String(response.status)})`, response.status);
    const parsed = AnalyticsResponse.safeParse(await response.json());
    if (!parsed.success) throw new UpstreamError("openrouter", "unexpected analytics response", response.status);
    return parsed.data.data.data.reduce((total, row) => total + (row.total_usage ?? 0), 0);
  }

  private failure(action: string, error: unknown): UpstreamError {
    const status = statusOf(error);
    return new UpstreamError("openrouter", `${action} failed (HTTP ${String(status ?? "n/a")})`, status, { cause: error });
  }
}
