import { fullEnvironmentModes, Mode, Platform } from "@open-macaron/contracts";
import { z } from "zod";
import { branchFor } from "../ingest/triggers.ts";

/**
 * What a request is about, as in GitHub notifications, and so where the bot answers: the issue,
 * the bot's own open pull request for it, or another pull request.
 */
export const SubjectKind = z.enum(["issue", "ownPullRequest", "pullRequest"]);
export type SubjectKind = z.infer<typeof SubjectKind>;

export const Subject = z.object({ kind: SubjectKind, number: z.int().positive() });
export type Subject = z.infer<typeof Subject>;

/** The commit a run starts from. */
export const Checkout = z.discriminatedUnion("from", [
  /** The default branch's head: the project as its users have it. */
  z.object({ from: z.literal("defaultBranch") }),
  /** The head of the bot's branch: its work so far. */
  z.object({ from: z.literal("botBranch") }),
  /** A pull request's head, whoever opened it. */
  z.object({ from: z.literal("pullRequestHead"), pullRequest: z.int().positive() }),
]);
export type Checkout = z.infer<typeof Checkout>;

/** What the controller does with one request. Stored on the run: everything after launch follows it. */
export const Route = z.object({
  mode: Mode,
  subject: Subject,
  checkout: Checkout,
  /** The bot's branch the run works on (where a commit goes). */
  branch: z.string().min(1),
  /** The bot's open pull request this run supersedes: closed once the run's new pull request is open. */
  supersedes: z.int().positive().optional(),
  /** Set when the run isn't on Linux. */
  platform: Platform.exclude(["linux"]).optional(),
});
export type Route = z.infer<typeof Route>;

/** The platform a route runs on. */
export function platformOf(route: Pick<Route, "platform">): Platform {
  return route.platform ?? "linux";
}

/** The platform an earlier run used (Linux for runs from before routes were stored): retries and escalations stay there unless asked otherwise. */
export function platformOfRun(run: { readonly route: unknown }): Platform {
  const parsed = Route.safeParse(run.route);
  return parsed.success ? platformOf(parsed.data) : "linux";
}

export interface Refusal {
  /** Posted where the request was made. */
  readonly refused: string;
}

/** What routing needs to know about a thread, read once per request. */
export interface ThreadState {
  /** The thread's issue (or pull request, for one the bot didn't open). */
  readonly number: number;
  readonly title: string;
  /** The bot's open pull request for the thread. A merged or closed one is forgotten. */
  readonly ownPullRequest: number | undefined;
  /** The bot's branch for the thread, if it ever opened a pull request from one. */
  readonly branch: string | undefined;
  /** The loop number the next run gets. */
  readonly nextLoop: number;
}

/** A request's raw subject (from the notification) classified against the thread. */
export function subjectOf(raw: { readonly kind: "issue" | "pull"; readonly number: number }, state: Pick<ThreadState, "ownPullRequest">): Subject {
  if (raw.kind === "issue") return { kind: "issue", number: raw.number };
  return { kind: raw.number === state.ownPullRequest ? "ownPullRequest" : "pullRequest", number: raw.number };
}

/** A cell of ROUTES: where the run starts from, or why the request is refused. */
type Rule = { readonly checkout: Checkout["from"] } | { readonly refuse: (mode: Mode, state: ThreadState) => string };

const fromDefaultBranch: Rule = { checkout: "defaultBranch" };
const fromBotBranch: Rule = { checkout: "botBranch" };
const fromPullRequestHead: Rule = { checkout: "pullRequestHead" };
const issueOnly: Rule = { refuse: (mode) => `\`${mode}\` can only be used from an issue.` };
const reproduceOnIssue: Rule = { refuse: () => "`reproduce` can only be used from an issue. On a pull request, use `review` or `verify`." };
const pullRequestOnly: Rule = {
  refuse: (mode, state) =>
    state.ownPullRequest === undefined
      ? `\`${mode}\` runs on a pull request, and this issue has none yet.`
      : `\`${mode}\` runs on the pull request: mention me on #${String(state.ownPullRequest)}.`,
};

/**
 * Every route, one row per subject kind: what the bot does where. The issue is for understanding
 * the problem and starting the work; a pull request for checking and continuing a change.
 */
export const ROUTES: Readonly<Record<SubjectKind, Readonly<Partial<Record<Mode, Rule>>>>> = {
  issue: {
    triage: fromDefaultBranch,
    // `remember:`: the code as its users have it, to check the claim against.
    retro: fromDefaultBranch,
    plan: fromDefaultBranch,
    reproduce: fromDefaultBranch,
    // A fresh attempt: a new branch from the default branch, superseding the bot's open pull request.
    implement: fromDefaultBranch,
    verify: pullRequestOnly,
    review: pullRequestOnly,
  },
  ownPullRequest: {
    triage: fromBotBranch,
    retro: fromBotBranch,
    address_review: fromBotBranch,
    verify: fromBotBranch,
    review: fromPullRequestHead,
    implement: issueOnly,
    plan: issueOnly,
    reproduce: reproduceOnIssue,
  },
  pullRequest: {
    triage: fromPullRequestHead,
    retro: fromPullRequestHead,
    verify: fromPullRequestHead,
    review: fromPullRequestHead,
    implement: issueOnly,
    plan: issueOnly,
    reproduce: reproduceOnIssue,
  },
};

/** The route for one request, or why it is refused. Pure. */
export function route(state: ThreadState, subject: Subject, mode: Mode, platform: Platform = "linux"): Route | Refusal {
  const rule = ROUTES[subject.kind][mode];
  if (rule === undefined) return { refused: `\`${mode}\` isn't available here.` };
  if ("refuse" in rule) return { refused: rule.refuse(mode, state) };
  // Only modes that set the project up depend on the machine.
  if (platform !== "linux" && !fullEnvironmentModes.has(mode)) return { refused: `\`${mode}\` doesn't set the project up, so it always runs on Linux.` };
  const on = platform === "linux" ? {} : { platform };

  const checkout: Checkout = rule.checkout === "pullRequestHead" ? { from: "pullRequestHead", pullRequest: subject.number } : { from: rule.checkout };
  if (mode === "implement") {
    // Never on top of earlier work: the branch is new whenever the bot already had one.
    const branch = state.branch === undefined ? branchFor(state.number, state.title) : branchFor(state.number, state.title, state.nextLoop);
    return { mode, subject, checkout, branch, ...(state.ownPullRequest === undefined ? {} : { supersedes: state.ownPullRequest }), ...on };
  }
  return { mode, subject, checkout, branch: state.branch ?? branchFor(state.number, state.title), ...on };
}

export function isRefusal(outcome: Route | Refusal): outcome is Refusal {
  return "refused" in outcome;
}

/**
 * The subject a run answers on: its route's, or for a run from before routes were stored, the one
 * its trigger's URL points at.
 */
export function subjectOfRun(
  run: { readonly route: unknown; readonly context: { readonly trigger: { readonly url: string } } },
  thread: { readonly number: number; readonly prNumber: number | null },
): Subject {
  if (run.route !== null && run.route !== undefined) return Route.parse(run.route).subject;
  const pull = /\/pull\/(\d+)/.exec(run.context.trigger.url)?.[1];
  const raw: { kind: "issue" | "pull"; number: number } = pull === undefined ? { kind: "issue", number: thread.number } : { kind: "pull", number: Number(pull) };
  return subjectOf(raw, { ownPullRequest: thread.prNumber ?? undefined });
}
