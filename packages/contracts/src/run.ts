import { z } from "zod";
import { Commands } from "./config.ts";
import { BotBranch, CommitSha, GitHubLogin, RepoSlug, Ticket, Usd } from "./ids.ts";
import { Harness, Mode, ResultAction } from "./mode.ts";

const Body = z.string().max(65_536);

export const ThreadComment = z.strictObject({
  id: z.int().positive(),
  author: GitHubLogin,
  body: Body,
  createdAt: z.iso.datetime(),
});
export type ThreadComment = z.infer<typeof ThreadComment>;

export const ReviewComment = z.strictObject({
  id: z.int().positive(),
  author: GitHubLogin,
  body: Body,
  path: z.string().min(1),
  line: z.int().positive().nullable(),
  inReplyTo: z.int().positive().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReviewComment = z.infer<typeof ReviewComment>;

export const LoopSummary = z.strictObject({
  loop: z.int().positive(),
  mode: Mode,
  summary: z.string().max(4_096),
  costUsd: Usd,
});
export type LoopSummary = z.infer<typeof LoopSummary>;

export const AttachmentLimits = z.strictObject({
  maxFiles: z.int().min(0).max(50),
  maxFileBytes: z.int().positive(),
  maxTotalBytes: z.int().positive(),
});
export type AttachmentLimits = z.infer<typeof AttachmentLimits>;

/** `context.json`: everything the agent is told about its task. Text fields are untrusted user content. */
export const RunContext = z.strictObject({
  mode: Mode,
  repo: RepoSlug,
  number: z.int().positive(),
  kind: z.enum(["issue", "pull"]),
  title: z.string().max(1_024),
  baseSha: CommitSha,
  branch: BotBranch,
  trigger: z.strictObject({
    kind: z.enum(["mention", "assign", "review", "comment"]),
    author: GitHubLogin,
    url: z.url(),
    instruction: z.string().max(4_096),
  }),
  thread: z.array(ThreadComment),
  reviewComments: z.array(ReviewComment),
  priorLoops: z.array(LoopSummary),
  commands: Commands,
  attachments: AttachmentLimits,
});
export type RunContext = z.infer<typeof RunContext>;

/** Reference used in reply bodies: `![caption](attachment:<id>)`. */
export const AttachmentId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "lowercase id, digits and hyphens");

export const Attachment = z.strictObject({
  id: AttachmentId,
  path: z
    .string()
    .regex(/^media\/[A-Za-z0-9._-]+$/, "must be a file directly under media/")
    .refine((path) => !path.includes(".."), "must not contain '..'"),
  kind: z.enum(["image", "video"]),
  caption: z.string().min(1).max(280),
  preview: z
    .string()
    .regex(/^media\/[A-Za-z0-9._-]+$/)
    .optional(),
});
export type Attachment = z.infer<typeof Attachment>;

export const Reply = z.strictObject({
  inReplyTo: z.int().positive(),
  body: Body.min(1),
});

export const Learning = z.strictObject({
  scope: z.enum(["global", "project", "repo"]),
  topic: z.string().min(1).max(120),
  text: z.string().min(1).max(4_096),
  evidence: z.url(),
});
export type Learning = z.infer<typeof Learning>;

/** `result.json`: everything the agent asks the controller to do. Nothing here is trusted. */
export const RunResult = z
  .strictObject({
    action: ResultAction,
    escalateTo: Mode.optional(),
    commitMessage: z.string().min(1).max(4_096).optional(),
    pr: z.strictObject({ title: z.string().min(1).max(256), body: Body }).optional(),
    message: Body.optional(),
    replies: z.array(Reply).max(50),
    summary: z.string().min(1).max(4_096),
    attachments: z.array(Attachment).max(50),
    learnings: z.array(Learning).max(20),
  })
  .superRefine((result, ctx) => {
    if (result.action === "escalate" && result.escalateTo === undefined) {
      ctx.addIssue({ code: "custom", path: ["escalateTo"], message: "required when action is escalate" });
    }
    if (result.action === "commit" && result.commitMessage === undefined) {
      ctx.addIssue({ code: "custom", path: ["commitMessage"], message: "required when action is commit" });
    }
    const ids = new Set<string>();
    for (const [index, attachment] of result.attachments.entries()) {
      if (ids.has(attachment.id)) {
        ctx.addIssue({ code: "custom", path: ["attachments", index, "id"], message: "duplicate attachment id" });
      }
      ids.add(attachment.id);
    }
  });
export type RunResult = z.infer<typeof RunResult>;

/** Inputs of `runner/.github/workflows/run.yml`. All strings: workflow_dispatch inputs are strings. */
export const DispatchInputs = z.strictObject({
  ticket: Ticket,
  repo: RepoSlug,
  "base-sha": CommitSha,
  fork: RepoSlug,
  branch: BotBranch,
  "env-json": z.string().max(8_192),
  "runs-on": z.string().min(1),
  "timeout-minutes": z.string().regex(/^[0-9]{1,3}$/),
  "full-environment": z.enum(["true", "false"]),
  /** Known before bootstrap so `prepare` can install it while the repository is cloned. */
  harness: Harness,
  /** Where the runner exchanges its OIDC token for the key: the controller's PUBLIC_URL. */
  "controller-url": z.url({ protocol: /^https$/ }),
});
export type DispatchInputs = z.infer<typeof DispatchInputs>;

/** POST /v1/bootstrap body. The OIDC token travels in the Authorization header. */
export const BootstrapRequest = z.strictObject({ ticket: Ticket });
export type BootstrapRequest = z.infer<typeof BootstrapRequest>;

export const BootstrapResponse = z.strictObject({
  openRouterKey: z.string().min(1),
  harness: Harness,
  model: z.string().min(1),
  context: RunContext,
});
export type BootstrapResponse = z.infer<typeof BootstrapResponse>;

/** A repo-relative path: no leading slash, no `.`/`..` segments, no backslashes. */
export const RepoPath = z
  .string()
  .min(1)
  .max(4_096)
  .refine((path) => !path.startsWith("/") && !path.includes("\\"), "must be relative, with forward slashes")
  .refine((path) => path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."), "must not contain empty, '.' or '..' segments");

export const FileChange = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("upsert"),
    path: RepoPath,
    mode: z.enum(["100644", "100755"]),
    contentBase64: z.base64(),
  }),
  z.strictObject({ action: z.literal("delete"), path: RepoPath }),
]);
export type FileChange = z.infer<typeof FileChange>;

/**
 * `changes.json`: the working-tree diff of a run, as whole files. The controller turns it into
 * one commit through the Git Data API; the agent never runs git against a remote.
 */
export const Changes = z.strictObject({
  baseSha: CommitSha,
  files: z.array(FileChange).max(1_000),
});
export type Changes = z.infer<typeof Changes>;

/** Name of the workflow artifact the agent job uploads; the controller downloads only this one. */
export const RESULT_ARTIFACT_NAME = "macaron-result";
