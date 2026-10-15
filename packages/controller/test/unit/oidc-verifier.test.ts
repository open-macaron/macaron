import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { OidcRejected } from "../../src/common/errors.ts";
import { GITHUB_OIDC_ISSUER, OidcVerifier } from "../../src/runs/oidc-verifier.ts";
import { testEnv } from "../support/env.ts";

const env = testEnv();

const validClaims = {
  repository: "open-macaron/runner",
  repository_id: "1001",
  repository_owner_id: "2002",
  workflow_ref: "open-macaron/runner/.github/workflows/run.yml@refs/heads/main",
  event_name: "workflow_dispatch",
  actor: "macaron-bot",
  run_id: "987654321",
  run_attempt: "1",
};

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let signingKey: PrivateKey;
let otherKey: PrivateKey;
let verifier: OidcVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "test", alg: "RS256" };
  verifier = new OidcVerifier(env, createLocalJWKSet({ keys: [jwk] }));
});

interface TokenOptions {
  readonly claims?: JWTPayload;
  readonly audience?: string;
  readonly issuer?: string;
  readonly key?: PrivateKey;
  readonly issuedAt?: number;
}

async function token(options: TokenOptions = {}): Promise<string> {
  const issuedAt = options.issuedAt ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ ...validClaims, ...options.claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(options.issuer ?? GITHUB_OIDC_ISSUER)
    .setAudience(options.audience ?? env.PUBLIC_URL)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 300)
    .sign(options.key ?? signingKey);
}

describe("OidcVerifier", () => {
  it("accepts a token from our runner workflow and returns its run", async () => {
    await expect(verifier.verify(await token())).resolves.toEqual({ runId: 987654321, runAttempt: 1 });
  });

  it.each([
    ["another repository (same name, different id: a fork or a recreated repo)", { repository_id: "9999" }],
    ["another owner", { repository_owner_id: "9999" }],
    ["another workflow file", { workflow_ref: "open-macaron/runner/.github/workflows/other.yml@refs/heads/main" }],
    ["another branch", { workflow_ref: "open-macaron/runner/.github/workflows/run.yml@refs/heads/evil" }],
    ["another trigger", { event_name: "push" }],
    ["another actor", { actor: "someone-else" }],
  ])("rejects a token from %s", async (_label, claims) => {
    await expect(verifier.verify(await token({ claims }))).rejects.toBeInstanceOf(OidcRejected);
  });

  it("rejects a token signed by another key", async () => {
    await expect(verifier.verify(await token({ key: otherKey }))).rejects.toBeInstanceOf(OidcRejected);
  });

  it("rejects a token minted for another audience", async () => {
    await expect(verifier.verify(await token({ audience: "https://elsewhere.test" }))).rejects.toThrow(OidcRejected);
  });

  it("rejects a token from another issuer", async () => {
    await expect(verifier.verify(await token({ issuer: "https://evil.test" }))).rejects.toThrow(OidcRejected);
  });

  it("rejects an expired token", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 3_600;
    await expect(verifier.verify(await token({ issuedAt }))).rejects.toThrow(OidcRejected);
  });

  it("rejects garbage", async () => {
    await expect(verifier.verify("not-a-jwt")).rejects.toThrow(OidcRejected);
  });
});
