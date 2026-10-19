import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { APP_ENV, type AppEnv } from "./config/env.ts";
import { EnvModule } from "./config/env.module.ts";
import { DbModule } from "./db/db.module.ts";
import { GitHubModule } from "./github/github.module.ts";
import { CoreModule, HttpModule, IngestModule } from "./modules.ts";

/** Paths pino must never print, whatever gets logged. */
export const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-hub-signature-256"]',
  "*.llm.key",
  "*.key",
  "*.keySecret",
  "*.token",
];

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
          // Health probes every few seconds would drown the useful lines.
          autoLogging: { ignore: (request) => request.url === "/healthz" || request.url === "/readyz" },
        },
      }),
    }),
    DbModule,
    GitHubModule,
    CoreModule,
    IngestModule,
    HttpModule,
  ],
})
export class AppModule {}
