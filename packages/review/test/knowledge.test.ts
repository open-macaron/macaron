import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeSource } from "../src/knowledge.ts";

const COMMIT = "c".repeat(40);
const slice = (scope: string, lessonSlug: string) => ({
  version: 1,
  commit: COMMIT,
  scope,
  overview: null,
  rules: [{ id: `${scope}/rule`, scope, title: "A rule", severity: "error", appliesTo: null, exclude: [], sources: [], body: "## Check\n" }],
  lessons: [{ id: `${scope}/lessons/${lessonSlug}`, scope, topic: lessonSlug, appliesTo: null, sources: ["https://example.org/x"], lastVerified: "2026-10-21", confidence: "high", body: "b" }],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KnowledgeSource", () => {
  it("keeps lessons and rules of every level at one commit, and skips missing levels", async () => {
    const served: Record<string, unknown> = { "https://k/v1/global.json": slice("global", "harness"), "https://k/v1/repos/o/r.json": slice("o/r", "building") };
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(url in served ? new Response(JSON.stringify(served[url]), { status: 200 }) : new Response("", { status: 404 })),
    );
    const source = new KnowledgeSource("https://k/v1");

    const knowledge = await source.knowledge({ project: "p", repo: "o/r" });
    expect(knowledge.commit).toBe(COMMIT);
    expect(knowledge.lessons.map((lesson) => lesson.id)).toEqual(["global/lessons/harness", "o/r/lessons/building"]);
    expect(await source.rules({ project: "p", repo: "o/r" })).toEqual({ commit: COMMIT, rules: knowledge.rules });
  });
});
