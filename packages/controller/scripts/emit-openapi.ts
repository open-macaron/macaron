/**
 * Emits the controller's OpenAPI document to packages/contracts/openapi/controller.json, without
 * starting anything: Nest's preview mode resolves routes and metadata but instantiates no
 * provider (no database, no GitHub). Clients (agent-cli) are generated from this file; CI fails
 * on drift.
 */
import "reflect-metadata";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { SESSION_COOKIE } from "@open-macaron/contracts";
import { AppModule } from "../src/app.module.ts";

const app = await NestFactory.create(AppModule, { preview: true, abortOnError: false, logger: false });
const config = new DocumentBuilder()
  .setTitle("macaron-bot controller")
  .setDescription("Runners call /v1/bootstrap through the edge; the web app calls /v1/me and /v1/admin through the cluster Service.")
  .setVersion("1")
  .addBearerAuth({ type: "http", scheme: "bearer", description: "GitHub Actions OIDC token, audience = PUBLIC_URL" })
  .addCookieAuth(SESSION_COOKIE, { type: "apiKey", in: "cookie", description: "The better-auth session cookie the web app forwards" })
  .build();
const document = SwaggerModule.createDocument(app, config);
// pnpm runs package scripts from the package directory.
const out = join(process.cwd(), "..", "contracts", "openapi", "controller.json");
await writeFile(out, `${JSON.stringify(document, null, 2)}\n`);
console.info(`wrote ${out}`);
// No app.close(): in preview mode nothing was started, and providers have nothing to release.
process.exit(0);
