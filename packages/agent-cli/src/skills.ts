import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PublishedLesson, RunKnowledge } from "@open-macaron/contracts";

/** Agent Skills names: lowercase letters, digits and single hyphens, at most 64 characters. */
const MAX_NAME = 64;

/**
 * Writes the run's lessons as Agent Skills, `<dir>/.claude/skills/<name>/SKILL.md`, and returns
 * `dir` for Claude Code's `--add-dir`. Outside the checkout on purpose: `finish` publishes every file
 * under it. Each name carries the lesson's scope, so lessons with the same slug at two levels differ.
 */
export async function writeSkills(dir: string, knowledge: RunKnowledge): Promise<string> {
  const skills = join(dir, ".claude", "skills");
  await rm(skills, { recursive: true, force: true });
  const taken = new Set<string>();
  for (const lesson of knowledge.lessons) {
    const name = uniqueName(skillName(lesson), taken);
    await mkdir(join(skills, name), { recursive: true });
    await writeFile(join(skills, name, "SKILL.md"), skillFile(name, lesson, knowledge.commit));
  }
  return dir;
}

/** `<scope>-<slug>`, e.g. `podman-desktop-windows-machines` or `axel7083-foobar-tmp-demo-building`. */
export function skillName(lesson: Pick<PublishedLesson, "scope" | "id">): string {
  const slug = lesson.id.split("/").at(-1) ?? "lesson";
  return `${lesson.scope}-${slug}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME)
    .replace(/-+$/, "");
}

function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let index = 2; taken.has(candidate); index++) {
    const suffix = `-${String(index)}`;
    candidate = `${name.slice(0, MAX_NAME - suffix.length).replace(/-+$/, "")}${suffix}`;
  }
  taken.add(candidate);
  return candidate;
}

/** JSON strings are valid YAML scalars: no escaping rules of our own. */
function skillFile(name: string, lesson: PublishedLesson, commit: string | null): string {
  const origin = commit === null ? "open-macaron/knowledge" : `open-macaron/knowledge@${commit.slice(0, 7)}`;
  return `---
name: ${name}
description: ${JSON.stringify(lesson.description ?? lesson.topic)}
---
# ${lesson.topic}

${lesson.body.trim()}

---
Lesson \`${lesson.id}\` from ${origin}, last verified ${lesson.lastVerified}, confidence ${lesson.confidence}. Sources: ${lesson.sources.join(", ")}
`;
}
