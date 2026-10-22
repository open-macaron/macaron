import "reflect-metadata";
import { StandardSchemaValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.ts";
import { APP_ENV, type AppEnv } from "./config/env.ts";
import { DomainErrorFilter } from "./http/domain-error.filter.ts";

async function bootstrap(): Promise<void> {
  // rawBody: webhook signatures are computed over the exact bytes GitHub sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new StandardSchemaValidationPipe({ transform: true }));
  app.useGlobalFilters(new DomainErrorFilter());
  // Not SIGHUP, which Nest includes by default: it reloads the configuration (RepoConfigService).
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  app.disable("x-powered-by");
  const env = app.get<AppEnv>(APP_ENV);
  await app.listen(env.PORT, "0.0.0.0");
}

await bootstrap();
