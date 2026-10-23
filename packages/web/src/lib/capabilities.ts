import type { LucideIcon } from "@lucide/svelte";
import BrainIcon from "@lucide/svelte/icons/brain";
import BugIcon from "@lucide/svelte/icons/bug";
import ClipboardCheckIcon from "@lucide/svelte/icons/clipboard-check";
import CodeIcon from "@lucide/svelte/icons/code";
import FlaskConicalIcon from "@lucide/svelte/icons/flask-conical";
import ListChecksIcon from "@lucide/svelte/icons/list-checks";
import MessageCircleQuestionIcon from "@lucide/svelte/icons/message-circle-question";
import type { Capability } from "@open-macaron/contracts/capability";

export interface CapabilityInfo {
  readonly label: string;
  /** What the bot does when a user with this capability asks. */
  readonly description: string;
  readonly icon: LucideIcon;
}

/** Every capability's wording in the app. Exhaustive: a new capability doesn't compile without one. */
export const capabilityInfo: Readonly<Record<Capability, CapabilityInfo>> = {
  triage: { label: "Triage", description: "Answers a bare mention: reads the thread and replies or asks.", icon: MessageCircleQuestionIcon },
  plan: { label: "Plan", description: "Writes an implementation plan on the issue.", icon: ListChecksIcon },
  implement: { label: "Implement", description: "Opens a pull request from its fork, and addresses review comments on it.", icon: CodeIcon },
  reproduce: { label: "Reproduce", description: "Reproduces a reported bug on Linux, Windows or macOS.", icon: BugIcon },
  verify: { label: "Verify", description: "Tries a fix and reports whether the issue is gone.", icon: FlaskConicalIcon },
  review: { label: "Review", description: "Reviews a pull request against the knowledge base's rules.", icon: ClipboardCheckIcon },
  remember: { label: "Remember", description: "Proposes a lesson to the knowledge base.", icon: BrainIcon },
};
