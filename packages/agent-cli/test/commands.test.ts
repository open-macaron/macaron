import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Changes, CommitSha, PublishedRule, RepoSlug, RunContext, RunResult, Ticket } from "@open-macaron/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attach, finish } from "../src/commands.ts";
import { type Inputs, paths } from "../src/inputs.ts";
import { systemPrompt, taskPrompt } from "../src/prompts.ts";

const git = (cwd: string, ...args: string[]) => promisify(execFile)("git", args, { cwd });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let root: string;
let inputs: Inputs;
let baseSha: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "macaron-agent-"));
  inputs = {
    MACARON_CONTROLLER_URL: "https://macaron.example.org",
    MACARON_TICKET: Ticket.parse(`t_${"a".repeat(43)}`),
    MACARON_REPO: RepoSlug.parse("org-x/repo-a"),
    MACARON_FORK: RepoSlug.parse("macaron-bot/abc123-repo-a"),
    MACARON_BRANCH: "macaron/12-crash",
    MACARON_BASE_SHA: CommitSha.parse("0".repeat(40)),
    MACARON_HARNESS: "claude",
    RUNNER_TEMP: join(root, "tmp"),
    GITHUB_WORKSPACE: join(root, "ws"),
  };
  const p = paths(inputs);
  await mkdir(p.work, { recursive: true });
  await mkdir(p.state, { recursive: true });
  await mkdir(p.media, { recursive: true });
  await git(p.work, "init", "--quiet");
  await git(p.work, "config", "user.email", "t@t");
  await git(p.work, "config", "user.name", "t");
  await writeFile(join(p.work, "README.md"), "hello\n");
  await writeFile(join(p.work, "old.txt"), "bye\n");
  await git(p.work, "add", "--all");
  await git(p.work, "commit", "--quiet", "-m", "base");
  baseSha = (await git(p.work, "rev-parse", "HEAD")).stdout.trim();
  const context = RunContext.parse({
    mode: "implement",
    repo: "org-x/repo-a",
    number: 12,
    kind: "issue",
    title: "Crash",
    baseSha,
    branch: "macaron/12-crash",
    trigger: { kind: "mention", author: "alice", url: "https://github.com/org-x/repo-a/issues/12", instruction: "implement" },
    thread: [],
    reviewComments: [],
    priorLoops: [],
    commands: { build: "npm run build" },
    attachments: { maxFiles: 10, maxFileBytes: 1_000_000, maxTotalBytes: 5_000_000 },
  });
  await writeFile(p.contextFile, JSON.stringify(context));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("finish", () => {
  it("collects working-tree and committed changes as whole files, and writes a valid result", async () => {
    const p = paths(inputs);
    await writeFile(join(p.work, "README.md"), "hello world\n");
    await rm(join(p.work, "old.txt"));
    await writeFile(join(p.work, "new.ts"), "export const x = 1;\n");
    await writeFile(p.resultFile, JSON.stringify({ action: "commit", commitMessage: "fix: crash", summary: "Fixed." }));

    expect(await finish(inputs)).toBe(0);

    const changes = Changes.parse(JSON.parse(await readFile(p.changesFile, "utf8")));
    expect(changes.baseSha).toBe(baseSha);
    expect(changes.files.map((file) => [file.action, file.path]).sort()).toEqual([
      ["delete", "old.txt"],
      ["upsert", "README.md"],
      ["upsert", "new.ts"],
    ]);
    expect(RunResult.parse(JSON.parse(await readFile(p.resultFile, "utf8"))).replies).toEqual([]);
  });

  it("merges attachments recorded with `attach`", async () => {
    const p = paths(inputs);
    const shot = join(root, "shot.png");
    await writeFile(shot, PNG);
    const reference = await attach(shot, "image", "The crash", undefined, inputs);
    await writeFile(p.resultFile, JSON.stringify({ action: "reply", message: `Reproduced: ![The crash](${reference})`, summary: "Reproduced." }));

    expect(await finish(inputs)).toBe(0);

    const result = RunResult.parse(JSON.parse(await readFile(p.resultFile, "utf8")));
    expect(reference).toBe("attachment:image-1");
    expect(result.attachments).toEqual([{ id: "image-1", path: "media/image-1.png", kind: "image", caption: "The crash" }]);
    expect(await readFile(join(p.media, "image-1.png"))).toEqual(PNG);
  });

  it("refuses an invalid result and changes under .github/", async () => {
    const p = paths(inputs);
    await writeFile(p.resultFile, JSON.stringify({ action: "commit", summary: "no message" }));
    expect(await finish(inputs)).toBe(1);

    await writeFile(p.resultFile, JSON.stringify({ action: "commit", commitMessage: "ci", summary: "ci" }));
    await mkdir(join(p.work, ".github", "workflows"), { recursive: true });
    await writeFile(join(p.work, ".github", "workflows", "x.yml"), "on: push\n");
    expect(await finish(inputs)).toBe(1);
  });

  it("refuses files the run turned from LF to CRLF, not files that already had CRLF", async () => {
    const p = paths(inputs);
    await writeFile(join(p.work, "dos.txt"), "a\r\nb\r\n");
    await git(p.work, "add", "dos.txt");
    await git(p.work, "commit", "--quiet", "-m", "dos");
    const context = RunContext.parse({ ...JSON.parse(await readFile(p.contextFile, "utf8")), baseSha: (await git(p.work, "rev-parse", "HEAD")).stdout.trim() });
    await writeFile(p.contextFile, JSON.stringify(context));
    await writeFile(p.resultFile, JSON.stringify({ action: "commit", commitMessage: "fix: crash", summary: "Fixed." }));

    await writeFile(join(p.work, "dos.txt"), "a\r\nb\r\nc\r\n");
    expect(await finish(inputs)).toBe(0);
    await writeFile(join(p.work, "README.md"), "hello\r\nworld\r\n");
    expect(await finish(inputs)).toBe(1);
  });

  it("refuses, on the agent's own call, a result that would read badly, and repairs it on the last one", async () => {
    const p = paths(inputs);
    const shot = join(root, "shot.png");
    await writeFile(shot, PNG);
    await attach(shot, "image", "The dropdown", undefined, inputs);
    // As in #156: the screenshot in no text, the answer again as a reply to a conversation comment.
    await writeFile(p.resultFile, JSON.stringify({ action: "reply", replies: [{ inReplyTo: 777, body: "Verified." }], summary: "Verified." }));
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    expect(await finish(inputs)).toBe(1);
    const told = output.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(told).toContain("add ![The dropdown](attachment:image-1) to message");
    expect(told).toContain("the reply to comment 777 can't be threaded");

    expect(await finish(inputs, { final: true })).toBe(0);
    output.mockRestore();
    const result = RunResult.parse(JSON.parse(await readFile(p.resultFile, "utf8")));
    expect(result.message).toBe("Verified.\n\n![The dropdown](attachment:image-1)");
    expect(result.replies).toEqual([]);
  });

  it("fails clearly when the agent wrote no result", async () => {
    expect(await finish(inputs)).toBe(1);
  });
});

describe("prompts", () => {
  it("index the rules with their globs and files, and ask the agent to check its changes against them", async () => {
    const context = RunContext.parse(JSON.parse(await readFile(paths(inputs).contextFile, "utf8")));
    expect(systemPrompt(context, "/out")).not.toContain("## Project rules");

    const rule = PublishedRule.parse({ id: "podman-desktop/svelte/runes", scope: "podman-desktop", title: "Use runes", severity: "error", appliesTo: ["**/*.svelte"], exclude: ["vendor/**"], sources: [], body: "b" });
    const everywhere = PublishedRule.parse({ ...rule, id: "global/dco", scope: "global", title: "Sign off", severity: "warning", appliesTo: null, exclude: [] });
    const system = systemPrompt(RunContext.parse({ ...context, knowledge: { commit: "a".repeat(40), lessons: [], rules: [rule, everywhere] } }), "/out", [
      { rule, path: "/k/rules/runes.md" },
      { rule: everywhere, path: "/k/rules/dco.md" },
    ]);
    expect(system).toContain(`these rules (from open-macaron/knowledge@${"a".repeat(40)})`);
    expect(system).toContain("- `podman-desktop/svelte/runes` (error): Use runes. Applies to `**/*.svelte`, except `vendor/**`. Full text: `/k/rules/runes.md`");
    expect(system).toContain("- `global/dco` (warning): Sign off. Applies to every file. Full text: `/k/rules/dco.md`");
    expect(system).toContain("`git status --short`");
  });

  it("tell the agent its mode, the allowed actions, where to write, how to link code, and include the schema", async () => {
    const context = RunContext.parse(JSON.parse(await readFile(paths(inputs).contextFile, "utf8")));
    const system = systemPrompt(context, "/out");

    expect(system).toContain("## Mode: implement");
    expect(system).toContain("Allowed actions in this mode: commit, ask, noop.");
    expect(system).toContain("`/out/result.json`");
    expect(system).toContain('"escalateTo"');
    expect(system).toContain(`https://github.com/org-x/repo-a/blob/${baseSha}/`);
    expect(taskPrompt(context)).toContain("@alice asked");
    expect(system).not.toContain("## Platform");
    expect(system).toContain("At most 10 files, 1 MB each and 5 MB in total");
  });

  it("tell the agent where its lessons come from, only when it has some", async () => {
    const context = RunContext.parse(JSON.parse(await readFile(paths(inputs).contextFile, "utf8")));
    expect(systemPrompt(context, "/out")).not.toContain("## Lessons");

    const lesson = { id: "global/lessons/building", scope: "global", topic: "Building", appliesTo: null, sources: ["https://example.org/x"], lastVerified: "2026-10-21", confidence: "high", body: "b" };
    const withLessons = RunContext.parse({ ...context, knowledge: { commit: "a".repeat(40), lessons: [lesson] } });
    expect(systemPrompt(withLessons, "/out")).toContain(`available as 1 skill (lessons from open-macaron/knowledge@${"a".repeat(40)})`);
    expect(systemPrompt(withLessons, "/out")).not.toContain("Their ids");

    // remember: needs the ids to revise a lesson, and says so when there is none yet.
    const retro = systemPrompt({ ...withLessons, mode: "retro" }, "/out");
    expect(retro).toContain("Their ids, for `updates`:\n- `global/lessons/building`: Building");
    expect(retro).toContain("set `updates` to its id");
    expect(retro).toContain("`scope` (`project` by default");
    expect(systemPrompt({ ...context, mode: "retro" }, "/out")).toContain("This repository has no lessons yet.");
  });

  it("ask reproduce and verify to end their answer with a verdict in their own words", async () => {
    const context = RunContext.parse(JSON.parse(await readFile(paths(inputs).contextFile, "utf8")));

    const verify = systemPrompt({ ...context, mode: "verify" }, "/out");
    expect(verify).toContain("`### Verdict`");
    expect(verify).toContain("❌ **Not verified**, you checked it and it doesn't");
    expect(verify).toContain("⚠️ **Partially verified**");
    const reproduce = systemPrompt({ ...context, mode: "reproduce" }, "/out");
    expect(reproduce).toContain("✅ **Reproduced**, you checked it and it holds");
    expect(reproduce).toContain("⚠️ **Could not reproduce here**");
    expect(systemPrompt(context, "/out")).not.toContain("### Verdict");
  });

  it("tell the agent its platform, and triage where it may escalate to", async () => {
    const context = RunContext.parse(JSON.parse(await readFile(paths(inputs).contextFile, "utf8")));

    expect(systemPrompt({ ...context, platform: "windows", platforms: ["linux", "windows"] }, "/out")).toContain("## Platform: windows\nThis machine runs Windows");
    expect(systemPrompt({ ...context, mode: "triage", platforms: ["linux", "windows"] }, "/out")).toContain("set `escalateOn`");
    expect(systemPrompt({ ...context, mode: "triage" }, "/out")).not.toContain("escalateOn`");
  });
});
