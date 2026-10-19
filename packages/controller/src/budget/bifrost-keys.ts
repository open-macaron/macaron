import { Logger } from "@nestjs/common";
import { z } from "zod";
import { UpstreamError } from "../common/errors.ts";
import type { BifrostEnv } from "../config/env.ts";
import type { CreateVirtualKeyData, UpdateVirtualKeyData } from "../generated/bifrost/types.gen.ts";
import { zListModelDetailsManagementResponse, zVirtualKey } from "../generated/bifrost/zod.gen.ts";
import { type KeyStatus, type ProvisionedKey, RunKeys } from "./run-keys.ts";

/** Only the fields we use: the rest of Bifrost's key object can change without breaking us. */
const CreatedKey = z.object({ virtual_key: zVirtualKey.pick({ id: true, value: true }) });
const KeyBudgets = z.object({ virtual_key: zVirtualKey.pick({ budgets: true }) });
const ListedKey = zVirtualKey.pick({ id: true, name: true, is_active: true, created_at: true });
/** An empty page has `virtual_keys: null` (Go's nil slice), unlike the OpenAPI document says. */
const KeyPage = z.object({ virtual_keys: z.array(ListedKey).nullable(), total_count: z.coerce.number() });
const Ignored = z.unknown();

const PAGE_SIZE = 100;

/**
 * Budgets can't be one-off in Bifrost (`reset_duration` is required). A run's key expires within
 * hours, so a yearly reset never happens in its lifetime.
 */
const BUDGET_RESET = "1Y";

/**
 * Run keys as Bifrost virtual keys, over the provider key Bifrost holds (the company's ENMAAS key,
 * which can't derive keys itself). Authenticated with Bifrost's admin credentials, which never
 * leave this class; the admin API is reachable on the internal network only.
 */
export class BifrostKeys extends RunKeys {
  readonly backend = "bifrost";
  readonly baseUrl: string;
  /** Bifrost keeps spend in memory and reads it back live (`from_memory`); a short wait covers late usage. */
  readonly usageLagMs = 15_000;
  private readonly logger = new Logger(BifrostKeys.name);
  private readonly authorization: string;
  private priced = new Set<string>();

  constructor(private readonly settings: BifrostEnv) {
    super();
    this.baseUrl = settings.publicUrl;
    this.authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString("base64")}`;
  }

  /** Checks the admin credentials and loads which models have a price. */
  async init(): Promise<void> {
    await this.loadPrices();
    this.logger.log(`Bifrost keys on provider "${this.settings.provider}"; ${String(this.priced.size)} models priced`);
  }

  /**
   * Refuses models without a price: Bifrost charges them $0, so the key's budget would never stop
   * them. Prices are reloaded once before refusing, in case the catalog changed since startup.
   */
  async create(name: string, limitUsd: number, expiresAt: Date, models: readonly string[]): Promise<ProvisionedKey> {
    const allowed = [...new Set(models)];
    if (allowed.some((model) => !this.priced.has(model))) await this.loadPrices();
    const unpriced = allowed.filter((model) => !this.priced.has(model));
    if (unpriced.length > 0) throw new UpstreamError("bifrost", `no price for ${unpriced.join(", ")}: refusing a key its budget can't limit`, undefined);

    const body: CreateVirtualKeyData["body"] = {
      name,
      provider_configs: [{ provider: this.settings.provider, allowed_models: allowed, key_ids: ["*"] }],
      budgets: [{ max_limit: limitUsd, reset_duration: BUDGET_RESET }],
      rate_limit: { request_max_limit: this.settings.requestsPerMinute, request_reset_duration: "1m" },
      expires_at: expiresAt.toISOString(),
      // Settlement reads the spend after the run; the sweeper deletes the key afterwards.
      delete_after_expire: false,
      disable_content_logging: true,
    };
    const created = await this.request("create key", "POST", "/api/governance/virtual-keys", CreatedKey, body);
    return { key: created.virtual_key.value, hash: created.virtual_key.id };
  }

  async disable(hash: string): Promise<void> {
    const body: UpdateVirtualKeyData["body"] = { is_active: false };
    await this.request("disable key", "PUT", `/api/governance/virtual-keys/${encodeURIComponent(hash)}`, Ignored, body);
  }

  async delete(hash: string): Promise<void> {
    try {
      await this.request("delete key", "DELETE", `/api/governance/virtual-keys/${encodeURIComponent(hash)}`, Ignored);
    } catch (error: unknown) {
      if (error instanceof UpstreamError && error.status === 404) return;
      throw error;
    }
  }

  async listByPrefix(prefix: string): Promise<KeyStatus[]> {
    const found: KeyStatus[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const query = new URLSearchParams({ search: prefix, limit: String(PAGE_SIZE), offset: String(offset) });
      const page = await this.request("list keys", "GET", `/api/governance/virtual-keys?${query.toString()}`, KeyPage);
      const listed = page.virtual_keys ?? [];
      for (const key of listed) {
        // `search` is a substring match: keep only real prefixes.
        if (key.name.startsWith(prefix)) found.push({ hash: key.id, name: key.name, disabled: !key.is_active, createdAt: new Date(key.created_at) });
      }
      if (listed.length === 0 || offset + PAGE_SIZE >= page.total_count) return found;
    }
  }

  /** A key belongs to one run, so its whole budget usage is the run's spend: `since` isn't needed. */
  async spentSince(hash: string, _since: Date): Promise<number> {
    const key = await this.request("read key usage", "GET", `/api/governance/virtual-keys/${encodeURIComponent(hash)}?from_memory=true`, KeyBudgets);
    return (key.virtual_key.budgets ?? []).reduce((total, budget) => total + budget.current_usage, 0);
  }

  private async loadPrices(): Promise<void> {
    const query = new URLSearchParams({ provider: this.settings.provider, limit: "1000" });
    const details = await this.request("list model prices", "GET", `/api/models/details?${query.toString()}`, zListModelDetailsManagementResponse);
    this.priced = new Set(
      (details.models ?? [])
        .filter((model) => (model.input_cost_per_token ?? 0) > 0 && (model.output_cost_per_token ?? 0) > 0)
        .flatMap((model) => (model.name === undefined ? [] : [model.name])),
    );
  }

  private async request<T>(action: string, method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      const init: RequestInit = { method, headers: { authorization: this.authorization }, signal: AbortSignal.timeout(30_000) };
      if (body !== undefined) {
        init.headers = { authorization: this.authorization, "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      response = await fetch(new URL(path, this.settings.adminUrl), init);
    } catch (error: unknown) {
      throw new UpstreamError("bifrost", `${action} failed: unreachable`, undefined, { cause: error });
    }
    if (!response.ok) throw new UpstreamError("bifrost", `${action} failed (HTTP ${String(response.status)})`, response.status);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new UpstreamError("bifrost", `${action}: unexpected response`, response.status, { cause: parsed.error });
    return parsed.data;
  }
}
