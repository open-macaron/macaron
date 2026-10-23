import { type Capability, type Mode, requiredCapability } from "@open-macaron/contracts";

/** The account a run is for: what its owner may ask the bot for. */
export interface Asker {
  /** The account's id: who the run is billed to. */
  readonly userId: string;
  readonly githubId: number;
  readonly capabilities: readonly Capability[];
}

/** One request in a batch, as far as deciding who asked goes. */
export interface Requester {
  readonly author: string;
  readonly authorId: number | null;
}

/**
 * Whose request a batch is: the latest person who asked in it; for a batch made only of trusted
 * review bots' comments (on the bot's own pull request), whoever asked for the thread's last run.
 * Undefined when nobody can be named: the request is then refused, never run on no one's behalf.
 */
export function askedBy(batch: readonly Requester[], isBot: (login: string) => boolean, previousAsker: number | null | undefined): number | undefined {
  const person = batch.filter((event) => !isBot(event.author) && event.authorId !== null).at(-1);
  if (person?.authorId !== undefined && person.authorId !== null) return person.authorId;
  return previousAsker ?? undefined;
}

/**
 * Why `asker` may not have a run of `mode`, or undefined when they may. Covers explicit commands,
 * retries and the bot's own escalations alike: each launches a run of a mode for someone.
 */
export function capabilityRefusal(asker: Asker | undefined, mode: Mode, webApp: string): string | undefined {
  if (asker === undefined) return `this needs an account on macaron: ask an administrator for an invitation (${webApp})`;
  const needed = requiredCapability[mode];
  if (asker.capabilities.includes(needed)) return undefined;
  return `this account can't ask for \`${needed}\`: an administrator grants it on macaron (${webApp})`;
}
