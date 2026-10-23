import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { LlmKey, LlmKeyEvents, MyLlmKey, SavedLlmKey, SaveLlmKey } from "@open-macaron/contracts";
import { and, count, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { SessionUser } from "../accounts/sessions.service.ts";
import { Clock } from "../common/clock.ts";
import { decodeCursor, encodeCursor } from "../common/cursor.ts";
import { FieldRefused, FreshSessionRequired, KeyStorageUnavailable, TooManyAttempts } from "../common/errors.ts";
import type { Db } from "../db/db.module.ts";
import { llmEndpoints, llmKeyEvents, llmKeys, runs, threads } from "../db/schema.ts";
import { RESOLVE } from "../endpoints/endpoints.service.ts";
import { publicHostRefusal, type Resolve } from "../endpoints/public-address.ts";
import { PROBE, type Probe } from "./endpoint-probe.ts";
import { KeyRing, keyAad } from "./key-ring.ts";

/** Every model the live configuration can give a run: what a saved key's endpoint should list. */
export const CONFIGURED_MODELS = Symbol("CONFIGURED_MODELS");

/** The key ring, or undefined when this deployment has no LLM_KEK_DIR. */
export const KEY_RING = Symbol("KEY_RING");

/** Saving or deleting a key needs a sign-in this recent (better-auth's `freshAge`). */
export const FRESH_SESSION_MS = 10 * 60_000;
/** Attempts to save a key, per user and hour, whatever their outcome. */
export const SAVE_ATTEMPTS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

type KeyRow = typeof llmKeys.$inferSelect;
type EndpointRow = typeof llmEndpoints.$inferSelect;

function toView(key: KeyRow, endpoint: EndpointRow): LlmKey {
  return {
    endpoint: { id: endpoint.id, name: endpoint.name, baseUrl: endpoint.baseUrl, pricingNote: endpoint.pricingNote, enabled: endpoint.enabled },
    last4: key.last4,
    status: key.status,
    validatedAt: key.validatedAt.toISOString(),
    createdAt: key.createdAt.toISOString(),
    updatedAt: key.updatedAt.toISOString(),
  };
}

/** A save that ended before a key was stored: recorded, then reported to the form. */
type Outcome = { readonly saved: SavedLlmKey } | { readonly refusal: FieldRefused };

/**
 * Users' own LLM keys: sealed at rest (KeyRing), write-only through the API, checked against their
 * endpoint before they are stored. Each change is an event in the key's history. The plaintext
 * exists only in the request that saves it; nothing here logs or returns it.
 */
@Injectable()
export class LlmKeysService {
  private readonly logger = new Logger(LlmKeysService.name);

  constructor(
    @InjectDrizzle() private readonly db: Db,
    @Inject(KEY_RING) private readonly ring: KeyRing | undefined,
    @Inject(PROBE) private readonly probe: Probe,
    @Inject(RESOLVE) private readonly resolve: Resolve,
    @Inject(CONFIGURED_MODELS) private readonly configuredModels: () => readonly string[],
    private readonly clock: Clock,
  ) {}

  async mine(user: SessionUser): Promise<MyLlmKey> {
    const userId = user.id;
    const [row] = await this.db.select({ key: llmKeys, endpoint: llmEndpoints }).from(llmKeys).innerJoin(llmEndpoints, eq(llmEndpoints.id, llmKeys.endpointId)).where(eq(llmKeys.userId, userId));
    const endpoints = await this.db
      .select({ id: llmEndpoints.id, name: llmEndpoints.name, baseUrl: llmEndpoints.baseUrl, pricingNote: llmEndpoints.pricingNote })
      .from(llmEndpoints)
      .where(eq(llmEndpoints.enabled, true))
      .orderBy(llmEndpoints.createdAt);
    return {
      key: row === undefined ? null : toView(row.key, row.endpoint),
      endpoints,
      storage: this.ring !== undefined,
      freshUntil: new Date(user.signedInAt.getTime() + FRESH_SESSION_MS).toISOString(),
    };
  }

  /**
   * Checks the key against its endpoint, then seals and stores it, replacing the user's previous
   * one. Attempts are serialised per user (an advisory lock held for the probe, at most 10 s) so
   * the hourly limit holds under concurrent requests.
   */
  async save(user: SessionUser, input: SaveLlmKey): Promise<SavedLlmKey> {
    const ring = this.ring;
    if (ring === undefined) throw new KeyStorageUnavailable("LLM_KEK_DIR is not configured");
    this.requireFresh(user);
    const outcome = await this.db.transaction(async (tx): Promise<Outcome> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`llm-key:${user.id}`}))`);
      const now = this.clock.now();
      const since = new Date(now.getTime() - HOUR_MS);
      const [attempts] = await tx
        .select({ n: count() })
        .from(llmKeyEvents)
        .where(and(eq(llmKeyEvents.userId, user.id), gte(llmKeyEvents.at, since), inArray(llmKeyEvents.kind, ["created", "replaced", "rejected", "unreachable"])));
      if ((attempts?.n ?? 0) >= SAVE_ATTEMPTS_PER_HOUR) throw new TooManyAttempts(`@${user.githubLogin} tried ${String(SAVE_ATTEMPTS_PER_HOUR)} keys within an hour`);

      const [endpoint] = await tx.select().from(llmEndpoints).where(eq(llmEndpoints.id, input.endpointId));
      if (endpoint?.enabled !== true) return { refusal: new FieldRefused("endpointId", "Choose one of the endpoints in the list.") };
      // Approved on public addresses; checked again, as DNS answers change.
      const hostRefusal = await publicHostRefusal(endpoint.baseUrl, this.resolve);
      if (hostRefusal !== undefined) return { refusal: new FieldRefused("endpointId", `This endpoint can't be used now: ${hostRefusal}.`) };

      const last4 = input.key.slice(-4);
      const result = await this.probe(endpoint.baseUrl, input.key);
      if (result.outcome !== "accepted") {
        const rejected = result.outcome === "rejected";
        const detail = rejected ? `HTTP ${String(result.status)}` : result.reason;
        await tx.insert(llmKeyEvents).values({ userId: user.id, kind: result.outcome, endpointId: endpoint.id, last4, detail, at: now });
        this.logger.log(`@${user.githubLogin}'s key for ${endpoint.name} not saved: ${result.outcome} (${detail})`);
        return {
          refusal: new FieldRefused("key", rejected ? `${endpoint.name} refused this key (HTTP ${String(result.status)}). Check it, and that it's meant for this endpoint.` : `${endpoint.name} couldn't check this key: ${result.reason}. Try again in a moment.`),
        };
      }

      const sealed = ring.seal(input.key, keyAad(user.id, endpoint.id));
      const [previous] = await tx.select({ last4: llmKeys.last4 }).from(llmKeys).where(eq(llmKeys.userId, user.id));
      const values: Omit<typeof llmKeys.$inferInsert, "userId"> = { endpointId: endpoint.id, ...sealed, last4, status: "valid", validatedAt: now, updatedAt: now };
      const [stored] = await tx
        .insert(llmKeys)
        .values({ userId: user.id, ...values })
        .onConflictDoUpdate({ target: llmKeys.userId, set: values })
        .returning();
      if (stored === undefined) throw new Error("the key wasn't stored");
      await tx.insert(llmKeyEvents).values({
        userId: user.id,
        kind: previous === undefined ? "created" : "replaced",
        endpointId: endpoint.id,
        last4,
        detail: previous === undefined ? null : `replaces the key ending in ${previous.last4}`,
        at: now,
      });
      const listed = new Set(result.models);
      const missingModels = this.configuredModels().filter((model) => !listed.has(model));
      this.logger.log(`@${user.githubLogin} saved a key for ${endpoint.name}`);
      return { saved: { key: toView(stored, endpoint), missingModels } };
    });
    if ("refusal" in outcome) throw outcome.refusal;
    return outcome.saved;
  }

  /** Deletes the user's key: its ciphertext leaves the database; its history stays. */
  async remove(user: SessionUser): Promise<void> {
    this.requireFresh(user);
    await this.db.transaction(async (tx) => {
      const [deleted] = await tx.delete(llmKeys).where(eq(llmKeys.userId, user.id)).returning({ endpointId: llmKeys.endpointId, last4: llmKeys.last4 });
      if (deleted === undefined) return;
      await tx.insert(llmKeyEvents).values({ userId: user.id, kind: "deleted", endpointId: deleted.endpointId, last4: deleted.last4, at: this.clock.now() });
    });
  }

  /** The key's history, newest first. */
  async events(userId: string, limit: number, before: string | undefined): Promise<LlmKeyEvents> {
    const cursor = before === undefined ? undefined : decodeCursor(before);
    const mine = eq(llmKeyEvents.userId, userId);
    const after = cursor === undefined ? undefined : or(lt(llmKeyEvents.at, cursor.at), and(eq(llmKeyEvents.at, cursor.at), lt(llmKeyEvents.id, cursor.id)));
    const rows = await this.db
      .select({ event: llmKeyEvents, endpointName: llmEndpoints.name, repo: threads.repo, number: threads.number, kind: threads.kind })
      .from(llmKeyEvents)
      .leftJoin(llmEndpoints, eq(llmEndpoints.id, llmKeyEvents.endpointId))
      .leftJoin(runs, eq(runs.id, llmKeyEvents.runId))
      .leftJoin(threads, eq(threads.id, runs.threadId))
      .where(after === undefined ? mine : and(mine, after))
      .orderBy(desc(llmKeyEvents.at), desc(llmKeyEvents.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      events: page.map(({ event, endpointName, repo, number, kind }) => ({
        id: event.id,
        kind: event.kind,
        at: event.at.toISOString(),
        endpointName,
        last4: event.last4,
        thread: repo === null || number === null || kind === null ? null : { repo, number, kind },
        detail: event.detail,
      })),
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.event.at, last.event.id) : null,
    };
  }

  private requireFresh(user: SessionUser): void {
    if (this.clock.now().getTime() - user.signedInAt.getTime() > FRESH_SESSION_MS) throw new FreshSessionRequired(`@${user.githubLogin} signed in over 10 minutes ago`);
  }
}
