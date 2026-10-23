import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type CreateEndpoint, type Endpoint, GitHubLogin } from "@open-macaron/contracts";
import { asc, eq } from "drizzle-orm";
import { FieldRefused } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import type { Db } from "../db/db.module.ts";
import { adminAudit, llmEndpoints, users } from "../db/schema.ts";
import type { Actor } from "../accounts/invitations.service.ts";
import { publicHostRefusal, type Resolve } from "./public-address.ts";

/** How the controller resolves host names; a token so tests give their own answers. */
export const RESOLVE = Symbol("RESOLVE");

type EndpointRow = typeof llmEndpoints.$inferSelect;

function toEndpoint(row: EndpointRow, createdBy: string | null): Endpoint {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    pricingNote: row.pricingNote,
    createdBy: createdBy === null ? null : GitHubLogin.parse(createdBy),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The LLM endpoints users may send their key to. Admins approve them (and the deployment's
 * defaults are inserted at start); a base URL never changes. Every address its host resolves to
 * must be public, checked when approved: the egress NetworkPolicy and Bifrost refuse private
 * ones again when a key is used.
 */
@Injectable()
export class EndpointsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EndpointsService.name);

  constructor(
    @InjectDrizzle() private readonly db: Db,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(RESOLVE) private readonly resolve: Resolve,
  ) {}

  /** The deployment's defaults: inserted when their base URL is missing, never updated. */
  async onApplicationBootstrap(): Promise<void> {
    for (const endpoint of this.env.LLM_ENDPOINT_DEFAULTS) {
      const refusal = await publicHostRefusal(endpoint.baseUrl, this.resolve);
      if (refusal !== undefined) {
        this.logger.warn(`default endpoint ${endpoint.baseUrl} left out: ${refusal}`);
        continue;
      }
      const [inserted] = await this.db
        .insert(llmEndpoints)
        .values({ name: endpoint.name, baseUrl: endpoint.baseUrl, pricingNote: endpoint.pricingNote })
        .onConflictDoNothing({ target: llmEndpoints.baseUrl })
        .returning({ id: llmEndpoints.id });
      if (inserted !== undefined) this.logger.log(`default endpoint ${endpoint.name} (${endpoint.baseUrl}) approved`);
    }
  }

  async list(): Promise<Endpoint[]> {
    const rows = await this.db
      .select({ endpoint: llmEndpoints, createdBy: users.githubLogin })
      .from(llmEndpoints)
      .leftJoin(users, eq(users.id, llmEndpoints.createdBy))
      .orderBy(asc(llmEndpoints.createdAt));
    return rows.map(({ endpoint, createdBy }) => toEndpoint(endpoint, createdBy));
  }

  /** The endpoints users may pick now. */
  async enabled(): Promise<Endpoint[]> {
    return (await this.list()).filter((endpoint) => endpoint.enabled);
  }

  async approve(input: CreateEndpoint, by: Actor): Promise<Endpoint> {
    const refusal = await publicHostRefusal(input.baseUrl, this.resolve);
    if (refusal !== undefined) throw new FieldRefused("baseUrl", `Keys can't be sent there: ${refusal}.`);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(llmEndpoints)
        .values({ name: input.name, baseUrl: input.baseUrl, pricingNote: input.pricingNote, createdBy: by.id })
        .onConflictDoNothing({ target: llmEndpoints.baseUrl })
        .returning();
      if (row === undefined) throw new FieldRefused("baseUrl", "This base URL is already an endpoint: enable it rather than adding it again.");
      await tx.insert(adminAudit).values({ actorId: by.id, action: "endpoint.approve", target: `endpoint:${row.id}`, details: { name: row.name, baseUrl: row.baseUrl } });
      return toEndpoint(row, by.githubLogin);
    });
  }

  /** Enables or disables an endpoint; its base URL, like everything else about it, stays. */
  async setEnabled(id: string, enabled: boolean, by: Actor): Promise<Endpoint> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(llmEndpoints).set({ enabled }).where(eq(llmEndpoints.id, id)).returning();
      if (row === undefined) throw new FieldRefused("id", "This endpoint doesn't exist.");
      await tx.insert(adminAudit).values({ actorId: by.id, action: enabled ? "endpoint.enable" : "endpoint.disable", target: `endpoint:${id}`, details: { name: row.name } });
      const [creator] = row.createdBy === null ? [] : await tx.select({ login: users.githubLogin }).from(users).where(eq(users.id, row.createdBy));
      return toEndpoint(row, creator?.login ?? null);
    });
  }
}
