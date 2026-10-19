import { describe, expect, it } from "vitest";
import { testEnv } from "../support/env.ts";

describe("MACARON_ALLOWED_USER_IDS", () => {
  it("is unrestricted when unset", () => {
    expect(testEnv().MACARON_ALLOWED_USER_IDS).toBeUndefined();
  });

  it("parses comma-separated ids", () => {
    expect(testEnv({ MACARON_ALLOWED_USER_IDS: "42176370,7" }).MACARON_ALLOWED_USER_IDS).toEqual(new Set([42_176_370, 7]));
  });

  it("refuses logins and malformed lists", () => {
    expect(() => testEnv({ MACARON_ALLOWED_USER_IDS: "axel7083" })).toThrow(/MACARON_ALLOWED_USER_IDS/);
    expect(() => testEnv({ MACARON_ALLOWED_USER_IDS: "1,,2" })).toThrow(/MACARON_ALLOWED_USER_IDS/);
    expect(() => testEnv({ MACARON_ALLOWED_USER_IDS: "" })).toThrow(/MACARON_ALLOWED_USER_IDS/);
  });
});

describe("LLM backends", () => {
  const bifrost = {
    BIFROST_ADMIN_URL: "http://macaron-bifrost:8080",
    BIFROST_PUBLIC_URL: "https://macaron.example.test/llm/anthropic",
    BIFROST_ADMIN_PASSWORD: "bifrost-admin-password-000",
  };

  it("defaults to OpenRouter, with Bifrost unconfigured", () => {
    const env = testEnv();
    expect(env.LLM_BACKEND).toBe("openrouter");
    expect(env.openRouter?.workspace).toBe("macaron");
    expect(env.bifrost).toBeUndefined();
  });

  it("configures Bifrost when its variables are set, alongside OpenRouter", () => {
    const env = testEnv({ ...bifrost, LLM_BACKEND: "bifrost" });
    expect(env.bifrost).toEqual({
      adminUrl: "http://macaron-bifrost:8080",
      publicUrl: "https://macaron.example.test/llm/anthropic",
      username: "macaron",
      password: "bifrost-admin-password-000",
      provider: "anthropic",
      requestsPerMinute: 60,
    });
    expect(env.openRouter).toBeDefined();
  });

  it("requires the selected backend's variables", () => {
    expect(() => testEnv({ LLM_BACKEND: "bifrost" })).toThrow(/BIFROST_ADMIN_URL: required for the Bifrost backend/);
    expect(() => testEnv({ OPENROUTER_PROVISIONING_KEY: "" })).toThrow(/OPENROUTER_PROVISIONING_KEY/);
  });

  it("refuses a half-configured backend even when it isn't selected", () => {
    expect(() => testEnv({ BIFROST_ADMIN_URL: "http://macaron-bifrost:8080" })).toThrow(/BIFROST_PUBLIC_URL: required/);
  });

  it("refuses a public URL runners would reach in clear text", () => {
    expect(() => testEnv({ ...bifrost, BIFROST_PUBLIC_URL: "http://macaron.example.test/llm/anthropic" })).toThrow(/BIFROST_PUBLIC_URL/);
  });
});
