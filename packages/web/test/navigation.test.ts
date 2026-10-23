import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { navigation } from "../src/lib/navigation.ts";

const routes = join(import.meta.dirname, "../src/routes");

describe("navigation", () => {
  const items = navigation.flatMap((section) => section.items);

  it("links only to pages that exist", () => {
    for (const item of items) expect(existsSync(join(routes, item.route, "+page.svelte")), item.route).toBe(true);
  });

  it("lists each page once", () => {
    expect(new Set(items.map((item) => item.route)).size).toBe(items.length);
  });

  it("keeps administration for admins", () => {
    expect(navigation.find((section) => section.label === "Administration")?.adminOnly).toBe(true);
  });
});
