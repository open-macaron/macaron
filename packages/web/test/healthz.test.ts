import { describe, expect, it } from "vitest";
import { GET } from "../src/routes/healthz/+server.ts";

describe("/healthz", () => {
  it("answers ok, uncached", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("ok");
  });
});
