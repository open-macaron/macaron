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
