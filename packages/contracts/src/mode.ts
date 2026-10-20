import { z } from "zod";

export const Mode = z.enum(["triage", "plan", "implement", "address_review", "reproduce", "verify", "retro", "review"]);
export type Mode = z.infer<typeof Mode>;

export const Harness = z.enum(["claude", "codex", "opencode"]);
export type Harness = z.infer<typeof Harness>;

export const Capability = z.enum(["gui", "video", "container"]);

/**
 * The operating system a run's machine has. Linux is every repository's default; the others are
 * opt-in per repository, for issues that only happen there.
 */
export const Platform = z.enum(["linux", "windows", "macos"]);
export type Platform = z.infer<typeof Platform>;
export type Capability = z.infer<typeof Capability>;

/**
 * Actions a run may return, and which modes may return them. The Gate enforces this table.
 * `review`: per-rule verdicts on a pull request (RunResult.review), published as one GitHub review.
 */
export const ResultAction = z.enum(["reply", "plan", "ask", "commit", "escalate", "noop", "review"]);
export type ResultAction = z.infer<typeof ResultAction>;

export const allowedActions: Readonly<Record<Mode, readonly ResultAction[]>> = {
  triage: ["reply", "ask", "escalate", "noop"],
  plan: ["plan", "ask", "escalate", "noop"],
  implement: ["commit", "ask", "noop"],
  address_review: ["commit", "reply", "ask", "noop"],
  reproduce: ["reply", "ask", "escalate", "noop"],
  verify: ["reply", "ask", "noop"],
  retro: ["noop"],
  review: ["review"],
};

/**
 * Modes that need the repo's full environment (setup layers 1–3). Not `review`: it only reads, and
 * on a pull request anyone can open, the environment step would run that pull request's code.
 */
export const fullEnvironmentModes: ReadonlySet<Mode> = new Set<Mode>([
  "plan",
  "implement",
  "address_review",
  "reproduce",
  "verify",
]);
