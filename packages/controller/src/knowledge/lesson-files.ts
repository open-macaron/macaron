import slugify from "@sindresorhus/slugify";
import { HttpsUrl, type Learning, LessonFrontMatter, type PublishedLesson, type RepoConfig } from "@open-macaron/contracts";
import { stringify } from "yaml";

/** A lesson file a `remember:` run proposes: new in its folder, or the revision of an existing lesson. */
export interface LessonFile {
  /** The owned folder: `global`, `projects/<p>` or `repos/<o>/<r>`. */
  readonly folder: string;
  readonly path: string;
  readonly content: string;
  readonly topic: string;
  /** The id of the lesson it revises. */
  readonly revises?: string;
}

const MAX_SLUG = 64;

/** The folder of a lesson's scope: `global`, a project name, or `<owner>/<repo>`. */
export function folderOfScope(scope: string): string {
  if (scope === "global") return "global";
  return scope.includes("/") ? `repos/${scope}` : `projects/${scope}`;
}

/** Where a new lesson of `learning` goes, for the repository the run worked on. */
export function folderOfLearning(level: Learning["scope"], config: Pick<RepoConfig, "project" | "repo">): string {
  switch (level) {
    case "global":
      return "global";
    case "project":
      return `projects/${config.project}`;
    case "repo":
      return `repos/${config.repo}`;
  }
}

/** A lesson's file name from its topic: kebab-case, at most 64 characters (the knowledge layout's slug). */
export function slugOf(topic: string): string {
  const slug = slugify(topic).slice(0, MAX_SLUG).replace(/-+$/, "");
  return slug === "" ? "lesson" : slug;
}

export interface LessonInput {
  readonly learning: Learning;
  /** The lessons the run was given; `learning.updates` names one of them (the Gate checked it). */
  readonly lessons: readonly PublishedLesson[];
  readonly config: Pick<RepoConfig, "project" | "repo">;
  /** The `remember:` comment. */
  readonly triggerUrl: string;
  /** `YYYY-MM-DD`: when the run checked the lesson. */
  readonly today: string;
  /** For a new lesson: its slug, free in its folder. */
  readonly slug: string;
}

/**
 * The file for one learning. A revision keeps the lesson's scope, globs and confidence, adds the new
 * sources to the old ones and is verified today; a new lesson starts at medium confidence.
 */
export function lessonFile(input: LessonInput): LessonFile {
  const { learning } = input;
  const revised = learning.updates === undefined ? undefined : input.lessons.find((lesson) => lesson.id === learning.updates);
  const sources = [...new Set([...(revised?.sources ?? []), learning.evidence, input.triggerUrl])].filter((url) => HttpsUrl.safeParse(url).success);
  const frontMatter = LessonFrontMatter.parse({
    topic: learning.topic,
    description: learning.description ?? revised?.description,
    ...(revised?.appliesTo === null || revised === undefined ? {} : { applies_to: revised.appliesTo }),
    sources,
    last_verified: input.today,
    confidence: revised?.confidence ?? "medium",
  });
  if (revised !== undefined) {
    const folder = folderOfScope(revised.scope);
    const slug = revised.id.split("/").at(-1) ?? input.slug;
    return { folder, path: `${folder}/lessons/${slug}.md`, content: renderLesson(frontMatter, learning.text), topic: learning.topic, revises: revised.id };
  }
  const folder = folderOfLearning(learning.scope, input.config);
  return { folder, path: `${folder}/lessons/${input.slug}.md`, content: renderLesson(frontMatter, learning.text), topic: learning.topic };
}

export function renderLesson(frontMatter: LessonFrontMatter, body: string): string {
  return `---\n${stringify(frontMatter, { lineWidth: 0 })}---\n${body.trim()}\n`;
}
