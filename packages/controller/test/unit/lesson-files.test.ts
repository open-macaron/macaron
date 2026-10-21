import { Learning, LessonFrontMatter, PublishedLesson, RepoSlug, Slug } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { folderOfLearning, folderOfScope, lessonFile, slugOf } from "../../src/knowledge/lesson-files.ts";

const config = { project: Slug.parse("podman-desktop"), repo: RepoSlug.parse("axel7083/podman-desktop") };
const learning = Learning.parse({
  scope: "project",
  topic: "Windows Podman machine providers",
  description: "Podman machines on Windows: WSL or Hyper-V, and which one the installer made the default.",
  text: "Hyper-V machines run on `windows-2025`, one machine at a time.\n",
  evidence: "https://github.com/axel7083/podman-desktop/issues/40#issuecomment-1",
});
const base = { config, lessons: [], triggerUrl: "https://github.com/axel7083/podman-desktop/issues/40#issuecomment-2", today: "2026-10-21", slug: "windows-podman-machine-providers" };

/** The front matter and body of a rendered lesson, as knowledge-cli reads them. */
function read(content: string) {
  const [, front, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content) ?? [];
  return { frontMatter: LessonFrontMatter.parse(parse(front ?? "")), body };
}

describe("lesson folders", () => {
  it("map scopes and learning levels to the knowledge repository's owned folders", () => {
    expect(folderOfScope("global")).toBe("global");
    expect(folderOfScope("podman-desktop")).toBe("projects/podman-desktop");
    expect(folderOfScope("axel7083/podman-desktop")).toBe("repos/axel7083/podman-desktop");
    expect(folderOfLearning("global", config)).toBe("global");
    expect(folderOfLearning("project", config)).toBe("projects/podman-desktop");
    expect(folderOfLearning("repo", config)).toBe("repos/axel7083/podman-desktop");
    expect(slugOf("Windows: Podman machine providers!")).toBe("windows-podman-machine-providers");
  });
});

describe("lessonFile", () => {
  it("writes a new lesson in its level's folder, at medium confidence, with the evidence and the remember: comment as sources", () => {
    const file = lessonFile({ ...base, learning });
    expect(file.path).toBe("projects/podman-desktop/lessons/windows-podman-machine-providers.md");
    expect(file.revises).toBeUndefined();
    const { frontMatter, body } = read(file.content);
    expect(frontMatter).toEqual({
      topic: "Windows Podman machine providers",
      description: "Podman machines on Windows: WSL or Hyper-V, and which one the installer made the default.",
      sources: [learning.evidence, base.triggerUrl],
      last_verified: "2026-10-21",
      confidence: "medium",
    });
    expect(body).toBe("Hyper-V machines run on `windows-2025`, one machine at a time.\n");
  });

  it("revises a lesson in its own folder: keeps its globs and confidence, adds sources, verified today", () => {
    const existing = PublishedLesson.parse({
      id: "podman-desktop/lessons/windows-machines",
      scope: "podman-desktop",
      topic: "Windows machines",
      appliesTo: ["extensions/podman/**"],
      sources: ["https://example.org/old"],
      lastVerified: "2026-01-01",
      confidence: "high",
      body: "old",
    });
    const file = lessonFile({ ...base, lessons: [existing], learning: { ...learning, scope: "global", updates: existing.id, description: undefined } });
    expect(file.path).toBe("projects/podman-desktop/lessons/windows-machines.md");
    expect(file.revises).toBe(existing.id);
    expect(read(file.content).frontMatter).toEqual({
      topic: "Windows Podman machine providers",
      applies_to: ["extensions/podman/**"],
      sources: ["https://example.org/old", learning.evidence, base.triggerUrl],
      last_verified: "2026-10-21",
      confidence: "high",
    });
  });
});
