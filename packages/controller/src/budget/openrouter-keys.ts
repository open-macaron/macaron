import { Inject, Injectable } from "@nestjs/common";
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { apiKeysCreate } from "@openrouter/sdk/funcs/apiKeysCreate.js";
import { apiKeysDelete } from "@openrouter/sdk/funcs/apiKeysDelete.js";
import { apiKeysGet } from "@openrouter/sdk/funcs/apiKeysGet.js";
import { apiKeysList } from "@openrouter/sdk/funcs/apiKeysList.js";
import { apiKeysUpdate } from "@openrouter/sdk/funcs/apiKeysUpdate.js";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { UpstreamError } from "../common/errors.ts";

export interface ProvisionedKey {
  /** The bearer key, shown once at creation. */
  readonly key: string;
  readonly hash: string;
}

export interface KeyStatus {
  readonly hash: string;
  readonly name: string;
  readonly usageUsd: number;
  readonly disabled: boolean;
  readonly createdAt: Date;
}

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
 * leaves this class.
 */
@Injectable()
export class OpenRouterKeys {
  private readonly core: OpenRouterCore;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.core = new OpenRouterCore({
      apiKey: env.OPENROUTER_PROVISIONING_KEY,
      serverURL: env.OPENROUTER_BASE_URL,
      timeoutMs: 30_000,
    });
  }

  /** Creates a key capped at `limitUsd` that expires on its own at `expiresAt`. */
  async create(name: string, limitUsd: number, expiresAt: Date): Promise<ProvisionedKey> {
    const result = await apiKeysCreate(this.core, {
      requestBody: { name, limit: limitUsd, limitReset: null, includeByokInLimit: true, expiresAt },
    });
    if (!result.ok) throw this.failure("create key", result.error);
    return { key: result.value.key, hash: result.value.data.hash };
  }

  async status(hash: string): Promise<KeyStatus> {
    const result = await apiKeysGet(this.core, { hash });
    if (!result.ok) throw this.failure("get key", result.error);
    const { data } = result.value;
    return { hash: data.hash, name: data.name, usageUsd: data.usage, disabled: data.disabled, createdAt: new Date(data.createdAt) };
  }

  /** Disabling is immediate: the next request made with the key is refused. */
  async disable(hash: string): Promise<void> {
    const result = await apiKeysUpdate(this.core, { hash, requestBody: { disabled: true } });
    if (!result.ok) throw this.failure("disable key", result.error);
  }

  /** Idempotent: deleting a key that is already gone is not an error. */
  async delete(hash: string): Promise<void> {
    const result = await apiKeysDelete(this.core, { hash });
    if (!result.ok && statusOf(result.error) !== 404) throw this.failure("delete key", result.error);
  }

  /** Every key whose name starts with `prefix`, across all pages. */
  async listByPrefix(prefix: string): Promise<KeyStatus[]> {
    const found: KeyStatus[] = [];
    for (let offset = 0; ; ) {
      const result = await apiKeysList(this.core, { offset, includeDisabled: true });
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

  private failure(action: string, error: unknown): UpstreamError {
    const status = statusOf(error);
    return new UpstreamError("openrouter", `${action} failed (HTTP ${String(status ?? "n/a")})`, status, { cause: error });
  }
}
