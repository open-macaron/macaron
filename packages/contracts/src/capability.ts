import { z } from "zod";
import type { Mode } from "./mode.ts";

/**
 * What a user may ask the bot for, granted per user by an admin. Named after what users type, not
 * the run modes: one Postgres enum (`capability`), one checkbox each in the web app. A new value is
 * appended by a migration, never renamed.
 */
export const Capability = z.enum(["triage", "plan", "implement", "reproduce", "verify", "review", "remember"]);
export type Capability = z.infer<typeof Capability>;

/**
 * The capability a run of each mode needs from the user who pays for it. Exhaustive: a new Mode
 * doesn't compile without a decision here.
 */
export const requiredCapability: Readonly<Record<Mode, Capability>> = {
  triage: "triage",
  plan: "plan",
  implement: "implement",
  // Replying to review comments on the bot's pull request changes code, like implementing.
  address_review: "implement",
  reproduce: "reproduce",
  verify: "verify",
  retro: "remember",
  review: "review",
};
