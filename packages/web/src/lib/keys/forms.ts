import { z } from "zod";

// The key form's input, shared by its remote function (server validation) and the form
// (preflight, in the browser). The controller checks it again.

// Records are the controller's API types, from its generated client. Type-only: erased from the
// browser bundle, so nothing of the server-only client reaches it.
import type { GetMyLlmKeyEventsResponse, GetMyLlmKeyResponse, GetMyMonthResponse } from "#lib/server/controller/generated/types.gen.js";

export type MyLlmKey = GetMyLlmKeyResponse;
export type LlmKey = NonNullable<MyLlmKey["key"]>;
export type EndpointChoice = MyLlmKey["endpoints"][number];
export type MyMonth = GetMyMonthResponse;
export type LlmKeyEvent = GetMyLlmKeyEventsResponse["events"][number];

/** The history's page size: the same arguments on both sides, so a change refreshes the page shown. */
export const HISTORY_PAGE = 25;

/**
 * `_key` starts with an underscore: SvelteKit never sends such a field back to the browser, not
 * even to refill the form after a refusal.
 */
export const KeyInput = z.object({
  endpointId: z.uuid("Choose an endpoint."),
  _key: z
    .string()
    .trim()
    .min(8, "Paste the whole key: this is too short.")
    .max(1024, "This is too long for an API key.")
    .regex(/^[\x21-\x7e]+$/, "An API key has no spaces or special characters: check what you pasted."),
});

/** An empty field clears the cap. */
export const CapInput = z.object({
  monthlyCapUsd: z
    .number("Enter an amount in dollars, like 50.")
    .positive("A cap is above $0: clear the field for no cap.")
    .max(100_000, "Keep the cap under $100,000.")
    .multipleOf(0.01, "Use whole cents.")
    .optional()
    .transform((cap) => cap ?? null),
});
