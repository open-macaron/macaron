import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommitSha, PublishedLesson, RunKnowledge } from "@open-macaron/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { claudeArgs, claudeEnvironment } from "../src/harness.ts";
import { skillName, writeSkills } from "../src/skills.ts";

const lesson = (scope: string, slug: string, description?: string) =>
  PublishedLesson.parse({
    id: `${scope}/lessons/${slug}`,
    scope,
    topic: `Topic of ${slug}`,
    description,
    appliesTo: null,
    sources: ["https://github.com/axel7083/podman-desktop/issues/40"],
    lastVerified: "2026-10-21",
    confidence: "medium",
    body: "Hyper-V machines run on windows-2025.\n",
  });

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

describe("skillName", () => {
  it("joins scope and slug into a valid, bounded skill name", () => {
    expect(skillName(lesson("podman-desktop", "windows-machines"))).toBe("podman-desktop-windows-machines");
    expect(skillName(lesson("axel7083/foobar-tmp-demo", "building"))).toBe("axel7083-foobar-tmp-demo-building");
    const long = skillName(lesson("Some-Owner/Some.Repository_Name", "a".repeat(64)));
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(long.length).toBeLessThanOrEqual(64);
  });
});

describe("writeSkills", () => {
  it("writes one SKILL.md per lesson under .claude/skills, with its description and origin", async () => {
    dir = await mkdtemp(join(tmpdir(), "macaron-skills-"));
    const commit = CommitSha.parse("abcdef1".padEnd(40, "0"));
    const knowledge = RunKnowledge.parse({
      commit,
      lessons: [lesson("podman-desktop", "windows-machines", 'Windows Podman machines: "wsl" or "hyperv", and which one is the default.'), lesson("global", "building")],
    });

    expect(await writeSkills(dir, knowledge)).toBe(dir);
    const skills = join(dir, ".claude", "skills");
    expect((await readdir(skills)).sort()).toEqual(["global-building", "podman-desktop-windows-machines"]);
    const file = await readFile(join(skills, "podman-desktop-windows-machines", "SKILL.md"), "utf8");
    expect(file).toContain('---\nname: podman-desktop-windows-machines\ndescription: "Windows Podman machines: \\"wsl\\" or \\"hyperv\\", and which one is the default."\n---\n');
    expect(file).toContain("Hyper-V machines run on windows-2025.");
    expect(file).toContain("from open-macaron/knowledge@abcdef1");
    // Without a description, the topic stands in.
    expect(await readFile(join(skills, "global-building", "SKILL.md"), "utf8")).toContain('description: "Topic of building"');
  });

  it("keeps names unique when two lessons map to the same one", async () => {
    dir = await mkdtemp(join(tmpdir(), "macaron-skills-"));
    await writeSkills(dir, RunKnowledge.parse({ commit: null, lessons: [lesson("a-b", "c"), lesson("a", "b-c")] }));
    expect((await readdir(join(dir, ".claude", "skills"))).sort()).toEqual(["a-b-c", "a-b-c-2"]);
  });
});

describe("claudeArgs", () => {
  it("adds the skills directory only when the run has lessons", () => {
    expect(claudeArgs({ model: "m", systemPromptFile: "/p.md", skillsDir: "/tmp/macaron-knowledge" }).slice(-2)).toEqual(["--add-dir", "/tmp/macaron-knowledge"]);
    expect(claudeArgs({ model: "m", systemPromptFile: "/p.md" })).not.toContain("--add-dir");
  });
});

describe("claudeEnvironment", () => {
  it("bounds every MCP tool call, so a hung server can't stall the run", () => {
    const env = claudeEnvironment({ baseUrl: "https://llm.example", key: "k", fastModel: "f" }, "m");
    expect(env["MCP_TOOL_TIMEOUT"]).toBe("120000");
  });
});
