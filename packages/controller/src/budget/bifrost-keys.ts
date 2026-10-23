import { Logger } from "@nestjs/common";
import { z } from "zod";
import { UpstreamError } from "../common/errors.ts";
import type { BifrostEnv } from "../config/env.ts";
import type { AddProviderRequest, CreatePricingOverrideRequest, CreateVirtualKeyData, Key, UpdateVirtualKeyData } from "../generated/bifrost/types.gen.ts";
import { zKey, zListPricingOverridesResponse, zProviderResponse, zVirtualKey } from "../generated/bifrost/zod.gen.ts";
import type { PriceList, PricePatch } from "./price-list.ts";
import { type KeyStatus, type ProvisionedKey, RunKeys, type Upstream } from "./run-keys.ts";

/** Only the fields we use: the rest of Bifrost's objects can change without breaking us. */
const CreatedKey = z.object({ virtual_key: zVirtualKey.pick({ id: true, value: true }) });
const KeyBudgets = z.object({ virtual_key: zVirtualKey.pick({ budgets: true }) });
const KeyBinding = z.object({ virtual_key: z.object({ name: z.string(), provider_configs: z.array(z.object({ provider: z.string() })).nullish() }) });
const ListedKey = zVirtualKey.pick({ id: true, name: true, is_active: true, created_at: true });
/** An empty page has `virtual_keys: null` (Go's nil slice), unlike the OpenAPI document says. */
const KeyPage = z.object({ virtual_keys: z.array(ListedKey).nullable(), total_count: z.coerce.number() });
const Provider = zProviderResponse.pick({ network_config: true });
/** An empty list comes back as `keys: null`, as for virtual keys. */
const ProviderKeys = z.object({ keys: z.array(z.object({ id: z.string().optional(), name: z.string().optional() })).nullish() });
const CreatedProviderKey = zKey.pick({ id: true });
const Overrides = zListPricingOverridesResponse.pick({ pricing_overrides: true });
const ProviderNames = z.object({ providers: z.array(z.object({ name: z.string() })).nullish() });
const Ignored = z.unknown();

const PAGE_SIZE = 100;
/** Bifrost's names for the providers we create: one per approved endpoint. */
export const ENDPOINT_PROVIDER_PREFIX = "macaron-ep-";
/** Requests in flight per endpoint: the only bound on a burst, as budgets are counted after requests. */
const CONCURRENCY = 16;
/** What Claude Code sends: Messages (Bifrost's `responses`), streamed, token counting, the model list. */
const ALLOWED_REQUESTS = { responses: true, responses_stream: true, count_tokens: true, list_models: true };
const PRICED_REQUESTS: CreatePricingOverrideRequest["request_types"] = ["responses", "chat_completion"];

/**
 * Budgets can't be one-off in Bifrost (`reset_duration` is required). A run's key expires within
 * hours, so a yearly reset never happens in its lifetime.
 */
const BUDGET_RESET = "1Y";

/** Bifrost's provider request, with a name of our own: the generated type only lists built-in providers. */
type EndpointProviderRequest = Omit<AddProviderRequest, "provider"> & { provider: string };
/** A price override, its patch checked against Bifrost's field names when the price list is read. */
type PriceOverrideRequest = Omit<CreatePricingOverrideRequest, "patch"> & { patch: PricePatch };
const StoredPatch = z.record(z.string(), z.unknown());

/**
 * Run keys as Bifrost virtual keys over the key of whoever the run is billed to. Each approved
 * endpoint is a Bifrost provider (`macaron-ep-<endpoint id>`), ensured before every mint since a
 * Bifrost restart drops providers created at runtime, and priced from the pinned list. A run's
 * user key is added to it for that run only, and its virtual key may use that key alone
 * (`key_ids`): no run can spend another user's key. Authenticated with Bifrost's admin
 * credentials, which never leave this class; the admin API is reachable on the internal network only.
 */
export class BifrostKeys extends RunKeys {
  readonly backend = "bifrost";
  readonly baseUrl: string;
  /** Bifrost keeps spend in memory and reads it back live (`from_memory`); a short wait covers late usage. */
  readonly usageLagMs = 15_000;
  private readonly logger = new Logger(BifrostKeys.name);
  private readonly authorization: string;

  constructor(
    private readonly settings: BifrostEnv,
    private readonly prices: PriceList,
  ) {
    super();
    this.baseUrl = settings.publicUrl;
    this.authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString("base64")}`;
  }

  /** Checks the admin credentials. */
  async init(): Promise<void> {
    await this.request("list providers", "GET", "/api/providers", Ignored);
    this.logger.log("Bifrost keys over users' endpoints");
  }

  /** Models the pinned list doesn't price: Bifrost would charge them $0, so a budget wouldn't stop them. */
  unpriced(models: readonly string[]): Promise<string[]> {
    return Promise.resolve(this.prices.unpriced(models));
  }

  async create(name: string, limitUsd: number, expiresAt: Date, models: readonly string[], upstream: Upstream): Promise<ProvisionedKey> {
    const allowed = [...new Set(models)];
    const unpriced = this.prices.unpriced(allowed);
    if (unpriced.length > 0) throw new UpstreamError("bifrost", `no price for ${unpriced.join(", ")}: refusing a key its budget can't limit`, undefined);

    const provider = `${ENDPOINT_PROVIDER_PREFIX}${upstream.endpointId}`;
    await this.ensureProvider(provider, upstream.baseUrl);
    await this.ensurePrices(provider, allowed);
    const userKey: Key = { id: name, name, value: upstream.key, models: allowed, weight: 1 };
    // The key's id is the run key's name: settlement and the sweeper find it from the virtual key alone.
    const added = await this.request("add the run's upstream key", "POST", `/api/providers/${encodeURIComponent(provider)}/keys`, CreatedProviderKey, userKey);
    const keyId = added.id ?? name;
    if (keyId !== name) {
      await this.deleteUpstreamKey(provider, keyId);
      throw new UpstreamError("bifrost", `the upstream key was stored as ${keyId}, not ${name}`, undefined);
    }
    try {
      const body: CreateVirtualKeyData["body"] = {
        name,
        provider_configs: [{ provider, allowed_models: allowed, key_ids: [keyId] }],
        budgets: [{ max_limit: limitUsd, reset_duration: BUDGET_RESET }],
        rate_limit: { request_max_limit: this.settings.requestsPerMinute, request_reset_duration: "1m" },
        expires_at: expiresAt.toISOString(),
        // Settlement reads the spend after the run; the sweeper deletes the key afterwards.
        delete_after_expire: false,
        disable_content_logging: true,
      };
      const created = await this.request("create key", "POST", "/api/governance/virtual-keys", CreatedKey, body);
      return { key: created.virtual_key.value, hash: created.virtual_key.id };
    } catch (error: unknown) {
      // The user's key must not stay in Bifrost without a run to settle it.
      await this.deleteUpstreamKey(provider, keyId).catch((cleanup: unknown) => {
        this.logger.error(`removing the upstream key ${name} after a failed mint failed: ${String(cleanup)}`);
      });
      throw error;
    }
  }

  /** Spending stops at once, and the user's key leaves Bifrost: usage stays readable on the virtual key. */
  async disable(hash: string): Promise<void> {
    const body: UpdateVirtualKeyData["body"] = { is_active: false };
    await this.request("disable key", "PUT", `/api/governance/virtual-keys/${encodeURIComponent(hash)}`, Ignored, body);
    await this.removeBoundKeys(hash);
  }

  async delete(hash: string): Promise<void> {
    try {
      await this.removeBoundKeys(hash);
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

  /**
   * Removes users' keys left on endpoint providers (named `prefix`…) that `keep` doesn't name: a
   * mint interrupted between adding the key and creating its virtual key. Returns their names.
   */
  async sweepUpstreamKeys(prefix: string, keep: ReadonlySet<string>): Promise<string[]> {
    const providers = await this.request("list providers", "GET", "/api/providers", ProviderNames);
    const removed: string[] = [];
    for (const { name: provider } of providers.providers ?? []) {
      if (!provider.startsWith(ENDPOINT_PROVIDER_PREFIX)) continue;
      const { keys } = await this.request("list upstream keys", "GET", `/api/providers/${encodeURIComponent(provider)}/keys`, ProviderKeys);
      for (const key of keys ?? []) {
        const name = key.name ?? "";
        if (!name.startsWith(prefix) || keep.has(name) || key.id === undefined) continue;
        await this.deleteUpstreamKey(provider, key.id);
        removed.push(name);
      }
    }
    return removed;
  }

  /** A key belongs to one run, so its whole budget usage is the run's spend: `since` isn't needed. */
  async spentSince(hash: string, _since: Date): Promise<number> {
    const key = await this.request("read key usage", "GET", `/api/governance/virtual-keys/${encodeURIComponent(hash)}?from_memory=true`, KeyBudgets);
    return (key.virtual_key.budgets ?? []).reduce((total, budget) => total + budget.current_usage, 0);
  }

  /** Creates the endpoint's provider when it's missing; an existing one must point at the same base URL. */
  private async ensureProvider(provider: string, baseUrl: string): Promise<void> {
    try {
      const existing = await this.request("read provider", "GET", `/api/providers/${encodeURIComponent(provider)}`, Provider);
      const current = existing.network_config?.base_url?.replace(/\/+$/, "");
      if (current !== baseUrl) throw new UpstreamError("bifrost", `provider ${provider} points at ${current ?? "nothing"}, not ${baseUrl}`, undefined);
      return;
    } catch (error: unknown) {
      if (!(error instanceof UpstreamError && error.status === 404)) throw error;
    }
    const body: EndpointProviderRequest = {
      provider,
      network_config: { base_url: baseUrl },
      concurrency_and_buffer_size: { concurrency: CONCURRENCY, buffer_size: CONCURRENCY },
      custom_provider_config: { base_provider_type: "anthropic", allowed_requests: ALLOWED_REQUESTS },
    };
    try {
      await this.request("create provider", "POST", "/api/providers", Ignored, body);
      this.logger.log(`Bifrost provider ${provider} created for ${baseUrl}`);
    } catch (error: unknown) {
      // Another mint created it meanwhile.
      if (!(error instanceof UpstreamError && error.status === 409)) throw error;
    }
  }

  /** One provider-scoped price override per model, created or brought back to the pinned price. */
  private async ensurePrices(provider: string, models: readonly string[]): Promise<void> {
    const query = new URLSearchParams({ scope_kind: "provider", provider_id: provider });
    const listed = await this.request("list price overrides", "GET", `/api/governance/pricing-overrides?${query.toString()}`, Overrides);
    const existing = new Map<string, { readonly id: string | undefined; readonly patch: unknown }>();
    for (const override of listed.pricing_overrides ?? []) {
      if (override.pattern !== undefined) existing.set(override.pattern, { id: override.id, patch: override.patch });
    }
    for (const model of models) {
      const patch = this.prices.patch(model);
      if (patch === undefined) throw new UpstreamError("bifrost", `no price for ${model}`, undefined);
      const current = existing.get(model);
      if (current === undefined) {
        const body: PriceOverrideRequest = { name: `${provider} ${model}`, scope_kind: "provider", provider_id: provider, match_type: "exact", pattern: model, request_types: PRICED_REQUESTS, patch };
        await this.request("create price override", "POST", "/api/governance/pricing-overrides", Ignored, body);
      } else if (current.id !== undefined && !samePrices(current.patch, patch)) {
        await this.request("update price override", "PUT", `/api/governance/pricing-overrides/${encodeURIComponent(current.id)}`, Ignored, { patch });
      }
    }
  }

  /** Deletes the user's key a virtual key is bound to (stored under the virtual key's name); the virtual key itself stays. */
  private async removeBoundKeys(hash: string): Promise<void> {
    const { virtual_key: bound } = await this.request("read key binding", "GET", `/api/governance/virtual-keys/${encodeURIComponent(hash)}`, KeyBinding);
    for (const { provider } of bound.provider_configs ?? []) {
      if (provider.startsWith(ENDPOINT_PROVIDER_PREFIX)) await this.deleteUpstreamKey(provider, bound.name);
    }
  }

  private async deleteUpstreamKey(provider: string, keyId: string): Promise<void> {
    try {
      await this.request("delete upstream key", "DELETE", `/api/providers/${encodeURIComponent(provider)}/keys/${encodeURIComponent(keyId)}`, Ignored);
    } catch (error: unknown) {
      // Gone already, or with its provider after a Bifrost restart.
      if (error instanceof UpstreamError && error.status === 404) return;
      throw error;
    }
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
    // Never the body: Bifrost's errors may echo what we sent, a user's key included.
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError("bifrost", `${action} failed (HTTP ${String(response.status)})`, response.status);
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      throw new UpstreamError("bifrost", `${action}: unreadable response`, response.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new UpstreamError("bifrost", `${action}: unexpected response`, response.status);
    return parsed.data;
  }
}

/** Whether Bifrost's stored patch holds exactly the pinned prices. */
function samePrices(stored: unknown, wanted: PricePatch): boolean {
  const parsed = StoredPatch.safeParse(stored);
  if (!parsed.success) return false;
  const set = Object.entries(parsed.data).filter(([, value]) => value !== null && value !== undefined);
  return set.length === Object.keys(wanted).length && set.every(([field, value]) => wanted[field] === value);
}
