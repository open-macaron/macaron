import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import { Body, Controller, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountAuth } from "../../src/accounts/mount.ts";

@Controller("v1")
class EchoController {
  @Post("echo")
  echo(@Body() body: unknown): unknown {
    return { parsedByNest: body };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

async function rawBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

describe("mountAuth", () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    // As main.ts: rawBody on (webhooks), the handler mounted before listen.
    app = await NestFactory.create<NestExpressApplication>(EchoModule, { rawBody: true, logger: false });
    mountAuth(app, async (request, response) => {
      const body = await rawBody(request);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ url: request.url, body }));
    });
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });

  it("hands /api/auth/* to the handler with its full path and its unread body", async () => {
    const response = await fetch(`${base}/api/auth/sign-in/social?x=1`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"provider":"github"}' });
    expect(await response.json()).toEqual({ url: "/api/auth/sign-in/social?x=1", body: '{"provider":"github"}' });
  });

  it("leaves every other route to Nest", async () => {
    const response = await fetch(`${base}/v1/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' });
    expect(await response.json()).toEqual({ parsedByNest: { a: 1 } });
    expect((await fetch(`${base}/api/authx`)).status).toBe(404);
  });
});
