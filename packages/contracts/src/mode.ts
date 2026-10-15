import { z } from "zod";

export const Mode = z.enum(["triage", "plan", "implement", "address_review", "reproduce", "verify", "retro"]);
export type Mode = z.infer<typeof Mode>;

export const Harness = z.enum(["claude", "codex", "opencode"]);
export type Harness = z.infer<typeof Harness>;

export const Capability = z.enum(["gui", "video", "container"]);
export type Capability = z.infer<typeof Capability>;

/** Actions a run may return, and which modes may return them. The Gate enforces this table. */
export const ResultAction = z.enum(["reply", "plan", "ask", "commit", "escalate", "noop"]);
export type ResultAction = z.infer<typeof ResultAction>;

export const allowedActions: Readonly<Record<Mode, readonly ResultAction[]>> = {
  triage: ["reply", "ask", "escalate", "noop"],
  plan: ["plan", "ask", "escalate", "noop"],
  implement: ["commit", "ask", "noop"],
  address_review: ["commit", "reply", "ask", "noop"],
  reproduce: ["reply", "ask", "escalate", "noop"],
  verify: ["reply", "ask", "noop"],
  retro: ["noop"],
};

/** Modes that need the repo's full environment (setup layers 1–3). */
export const fullEnvironmentModes: ReadonlySet<Mode> = new Set<Mode>([
  "plan",
  "implement",
  "address_review",
  "reproduce",
  "verify",
]);
