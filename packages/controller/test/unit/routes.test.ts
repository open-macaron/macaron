import type { Mode } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { type Refusal, type Route, route, type Subject, subjectOf, type ThreadState } from "../../src/routing/routes.ts";

const fresh: ThreadState = { number: 16, title: "Syntax highlighting for env files", ownPullRequest: undefined, branch: undefined, nextLoop: 1 };
const withOwnPullRequest: ThreadState = { ...fresh, ownPullRequest: 17, branch: "macaron/16-syntax-highlighting-for-env-files", nextLoop: 5 };
/** The bot's earlier pull request was merged or closed: forgotten, but its branch exists. */
const afterClosedPullRequest: ThreadState = { ...withOwnPullRequest, ownPullRequest: undefined };
/** A pull request the bot didn't open: its own thread. */
const humanPullRequest: ThreadState = { number: 40, title: "Add a feature", ownPullRequest: undefined, branch: undefined, nextLoop: 1 };

const issue: Subject = { kind: "issue", number: 16 };
const ownPullRequest: Subject = { kind: "ownPullRequest", number: 17 };
const pullRequest: Subject = { kind: "pullRequest", number: 40 };

const BRANCH = "macaron/16-syntax-highlighting-for-env-files";

describe("routes from an issue", () => {
  it.each<[Mode]>([["triage"], ["plan"], ["reproduce"]])("%s runs on the default branch and answers on the issue, even with an open pull request", (mode) => {
    expect(route(withOwnPullRequest, issue, mode)).toEqual({ mode, subject: issue, checkout: { from: "defaultBranch" }, branch: BRANCH });
    expect(route(fresh, issue, mode)).toEqual({ mode, subject: issue, checkout: { from: "defaultBranch" }, branch: BRANCH });
  });

  it("implement starts on the default branch, on the thread's first branch", () => {
    expect(route(fresh, issue, "implement")).toEqual({ mode: "implement", subject: issue, checkout: { from: "defaultBranch" }, branch: BRANCH });
  });

  it("implement with an open pull request starts over on a new branch and supersedes it", () => {
    expect(route(withOwnPullRequest, issue, "implement")).toEqual({
      mode: "implement",
      subject: issue,
      checkout: { from: "defaultBranch" },
      branch: `${BRANCH}-5`,
      supersedes: 17,
    });
  });

  it("implement after a closed pull request starts on a new branch, superseding nothing", () => {
    expect(route(afterClosedPullRequest, issue, "implement")).toEqual({ mode: "implement", subject: issue, checkout: { from: "defaultBranch" }, branch: `${BRANCH}-5` });
  });

  it.each<[Mode]>([["verify"], ["review"]])("%s is refused, pointing to the pull request", (mode) => {
    expect(route(withOwnPullRequest, issue, mode)).toEqual<Refusal>({ refused: `\`${mode}\` runs on the pull request: mention me on #17.` });
    expect(route(fresh, issue, mode)).toEqual<Refusal>({ refused: `\`${mode}\` runs on a pull request, and this issue has none yet.` });
  });
});

describe("routes from the bot's own pull request", () => {
  it.each<[Mode]>([["triage"], ["address_review"], ["verify"]])("%s continues on the bot's branch and answers on the pull request", (mode) => {
    expect(route(withOwnPullRequest, ownPullRequest, mode)).toEqual<Route>({ mode, subject: ownPullRequest, checkout: { from: "botBranch" }, branch: BRANCH });
  });

  it("review checks the pull request's head", () => {
    expect(route(withOwnPullRequest, ownPullRequest, "review")).toEqual<Route>({
      mode: "review",
      subject: ownPullRequest,
      checkout: { from: "pullRequestHead", pullRequest: 17 },
      branch: BRANCH,
    });
  });

  it.each<[Mode]>([["implement"], ["plan"]])("%s is refused: it belongs to the issue", (mode) => {
    expect(route(withOwnPullRequest, ownPullRequest, mode)).toEqual<Refusal>({ refused: `\`${mode}\` can only be used from an issue.` });
  });

  it("reproduce is refused, suggesting review or verify", () => {
    expect(route(withOwnPullRequest, ownPullRequest, "reproduce")).toEqual<Refusal>({
      refused: "`reproduce` can only be used from an issue. On a pull request, use `review` or `verify`.",
    });
  });
});

describe("routes from another pull request", () => {
  it.each<[Mode]>([["triage"], ["verify"], ["review"]])("%s runs on its head and answers there", (mode) => {
    expect(route(humanPullRequest, pullRequest, mode)).toEqual<Route>({
      mode,
      subject: pullRequest,
      checkout: { from: "pullRequestHead", pullRequest: 40 },
      branch: "macaron/40-add-a-feature",
    });
  });

  it.each<[Mode]>([["implement"], ["plan"], ["reproduce"]])("%s is refused", (mode) => {
    expect("refused" in route(humanPullRequest, pullRequest, mode)).toBe(true);
  });
});

describe("modes no one can request", () => {
  it.each<[Subject]>([[issue], [ownPullRequest], [pullRequest]])("retro is refused on %o", (subject) => {
    expect(route(withOwnPullRequest, subject, "retro")).toEqual<Refusal>({ refused: "`retro` isn't available here." });
  });

  it("address_review is refused on the issue", () => {
    expect(route(withOwnPullRequest, issue, "address_review")).toEqual<Refusal>({ refused: "`address_review` isn't available here." });
  });
});

describe("subjectOf", () => {
  it("classifies a notification's subject against the thread", () => {
    expect(subjectOf({ kind: "issue", number: 16 }, withOwnPullRequest)).toEqual(issue);
    expect(subjectOf({ kind: "pull", number: 17 }, withOwnPullRequest)).toEqual(ownPullRequest);
    expect(subjectOf({ kind: "pull", number: 40 }, withOwnPullRequest)).toEqual({ kind: "pullRequest", number: 40 });
  });

  it("treats the bot's closed pull request as anyone's", () => {
    expect(subjectOf({ kind: "pull", number: 17 }, afterClosedPullRequest)).toEqual({ kind: "pullRequest", number: 17 });
  });
});
