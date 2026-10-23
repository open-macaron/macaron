import { Global, Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { BifrostKeys } from "./budget/bifrost-keys.ts";
import { BudgetService } from "./budget/budget.service.ts";
import { OpenRouterKeys } from "./budget/openrouter-keys.ts";
import { RunKeysRegistry } from "./budget/run-keys.registry.ts";
import { APP_ENV, type AppEnv } from "./config/env.ts";
import { configuredModels } from "./config/configured-models.ts";
import { ConfigSnapshotStore, DrizzleConfigSnapshotStore } from "./config/config-snapshots.store.ts";
import { ConfigUpdates } from "./config/config-updates.ts";
import { PublishedConfigClient } from "./config/published-config.client.ts";
import { RepoConfigService } from "./config/repo-config.service.ts";
import { BotIdentity } from "./github/bot-identity.ts";
import { InvitationsService } from "./accounts/invitations.service.ts";
import { SessionsService } from "./accounts/sessions.service.ts";
import { UsageService } from "./accounts/usage.service.ts";
import { UsersService } from "./accounts/users.service.ts";
import { EndpointsService, RESOLVE } from "./endpoints/endpoints.service.ts";
import { resolveAll } from "./endpoints/public-address.ts";
import { PROBE, probeEndpoint } from "./keys/key-check.ts";
import { KeyRing } from "./keys/key-ring.ts";
import { CONFIGURED_MODELS, KEY_RING, LlmKeysService } from "./keys/llm-keys.service.ts";
import { AdminController } from "./http/admin.controller.ts";
import { BootstrapController } from "./http/bootstrap.controller.ts";
import { MeController } from "./http/me.controller.ts";
import { HealthController } from "./http/health.controller.ts";
import { WebhookController } from "./http/webhook.controller.ts";
import { ContextBuilder } from "./ingest/context-builder.ts";
import { EventsRepository } from "./ingest/events.repository.ts";
import { IngestService } from "./ingest/ingest.service.ts";
import { NotificationSink, NotificationsPoller, PgBossPollScheduler, PollScheduler } from "./ingest/notifications-poller.ts";
import { NotificationsApi, NotificationsSource } from "./ingest/notifications-source.ts";
import { DrizzlePollStateStore, PollStateStore } from "./ingest/poll-state.store.ts";
import { ThreadWorker } from "./ingest/thread-worker.ts";
import { Jobs } from "./jobs/jobs.ts";
import { EvidenceHost } from "./publish/evidence-host.ts";
import { ForkCommitter } from "./publish/fork-committer.ts";
import { Publisher } from "./publish/publisher.ts";
import { KnowledgeProposer } from "./knowledge/knowledge-proposer.ts";
import { ReactionTargets } from "./publish/reaction-targets.ts";
import { UpstreamWriter } from "./publish/upstream-writer.ts";
import { KnowledgeClient } from "./review/knowledge-client.ts";
import { PullDiffReader } from "./review/pull-diff.ts";
import { ArtifactDownloader } from "./runs/artifact.ts";
import { Housekeeping } from "./runs/housekeeping.ts";
import { githubJwks, OIDC_KEYS, OidcVerifier } from "./runs/oidc-verifier.ts";
import { RunLauncher } from "./runs/run-launcher.ts";
import { RunsRepository } from "./runs/runs.repository.ts";
import { ThreadStates } from "./routing/thread-states.ts";

/** Shared state: configuration, queues, repositories, locks, the bot's identity. */
@Global()
@Module({
  providers: [
    RepoConfigService,
    PublishedConfigClient,
    { provide: ConfigSnapshotStore, useClass: DrizzleConfigSnapshotStore },
    ConfigUpdates,
    Jobs,
    BotIdentity,
    RunsRepository,
    EventsRepository,
    { provide: PollStateStore, useClass: DrizzlePollStateStore },
  ],
  exports: [RepoConfigService, ConfigUpdates, Jobs, BotIdentity, RunsRepository, EventsRepository, PollStateStore],
})
export class CoreModule {}

/** Run keys: the only module holding the credentials that mint them. */
@Module({
  providers: [
    {
      provide: RunKeysRegistry,
      inject: [APP_ENV, RepoConfigService],
      useFactory: (env: AppEnv, config: RepoConfigService) => {
        const registry = new RunKeysRegistry(
          env.LLM_BACKEND,
          [...(env.openRouter === undefined ? [] : [new OpenRouterKeys(env.openRouter)]), ...(env.bifrost === undefined ? [] : [new BifrostKeys(env.bifrost)])],
          () => configuredModels(config.snapshot),
        );
        // A reloaded configuration naming a model the active backend can't bill is refused as a whole,
        // as at boot, rather than failing every run that would use it.
        config.addCheck(async (snapshot) => {
          const unpriced = await registry.active.unpriced(configuredModels(snapshot));
          return unpriced.length === 0 ? [] : [`LLM backend "${registry.activeBackend}" has no price for ${unpriced.join(", ")}`];
        });
        return registry;
      },
    },
    BudgetService,
  ],
  exports: [BudgetService],
})
export class BudgetModule {}

/** Everything that writes to GitHub. */
@Module({
  providers: [ForkCommitter, UpstreamWriter, ReactionTargets, EvidenceHost, KnowledgeProposer, Publisher],
  exports: [ForkCommitter, UpstreamWriter, ReactionTargets, Publisher],
})
export class PublishModule {}

/** What reviews read: knowledge rules (Pages read API) and pull request diffs (GitHub). */
@Module({ providers: [KnowledgeClient, PullDiffReader], exports: [KnowledgeClient, PullDiffReader] })
export class ReviewModule {}

/** The web app's users: sign-in (better-auth), invitations, capabilities, usage, endpoints and their LLM keys. */
@Module({
  providers: [
    InvitationsService,
    SessionsService,
    UsersService,
    UsageService,
    EndpointsService,
    LlmKeysService,
    { provide: RESOLVE, useValue: resolveAll },
    { provide: PROBE, useValue: probeEndpoint },
    { provide: CONFIGURED_MODELS, inject: [RepoConfigService], useFactory: (config: RepoConfigService) => () => configuredModels(config.snapshot) },
    { provide: KEY_RING, inject: [APP_ENV], useFactory: (env: AppEnv) => (env.LLM_KEK_DIR === undefined ? undefined : KeyRing.fromDirectory(env.LLM_KEK_DIR)) },
  ],
  exports: [InvitationsService, SessionsService, UsersService, UsageService, EndpointsService, LlmKeysService],
})
export class AccountsModule {}

/** A run's lifecycle: launch, bootstrap, completion, safety nets. */
@Module({
  imports: [BudgetModule, PublishModule, ReviewModule, AccountsModule],
  providers: [{ provide: OIDC_KEYS, useFactory: githubJwks }, OidcVerifier, ArtifactDownloader, RunLauncher, Housekeeping],
  exports: [RunLauncher],
})
export class RunsModule {}

/** From GitHub notifications to launched runs. */
@Module({
  imports: [RunsModule, PublishModule, ReviewModule, AccountsModule],
  providers: [
    { provide: NotificationsApi, useClass: NotificationsSource },
    { provide: NotificationSink, useClass: IngestService },
    { provide: PollScheduler, useClass: PgBossPollScheduler },
    NotificationsPoller,
    ContextBuilder,
    ThreadStates,
    ThreadWorker,
  ],
})
export class IngestModule {}


/**
 * The edge exposes /v1/bootstrap and /v1/webhook (and better-auth's /api/auth, mounted in main.ts).
 * /v1/me and /v1/admin are reached only by the web app, through the cluster Service.
 */
@Module({
  imports: [RunsModule, AccountsModule, TerminusModule],
  controllers: [BootstrapController, WebhookController, HealthController, MeController, AdminController],
})
export class HttpModule {}
