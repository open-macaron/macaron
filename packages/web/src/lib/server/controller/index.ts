import { error, redirect } from "@sveltejs/kit";
import { SESSION_COOKIE } from "@open-macaron/contracts/auth";
import { CONTROLLER_URL } from "$app/env/private";
import { resolve } from "$app/paths";
import { getRequestEvent } from "$app/server";
import { z } from "zod";
import { type Client, createClient } from "./generated/client/index.ts";

/**
 * The controller, acting as the signed-in user: the request's session cookie, and nothing else of
 * it, goes along. Server-only (a `server` directory): the browser never talks to the controller's API.
 */
export function controller(): Client {
  if (CONTROLLER_URL === undefined) error(503, "The controller is not configured.");
  const session = getRequestEvent().cookies.get(SESSION_COOKIE);
  return createClient({ baseUrl: CONTROLLER_URL, headers: session === undefined ? {} : { cookie: `${SESSION_COOKIE}=${session}` } });
}

/** A refusal the controller addressed to one form field (HTTP 409). */
const FieldRefusal = z.object({ error: z.literal("field_refused"), field: z.string(), message: z.string() });
export type FieldRefusal = z.infer<typeof FieldRefusal>;

/** What a generated call resolves to: its validated data on success, the error body otherwise. */
interface Result<T> {
  readonly data?: T;
  readonly error?: unknown;
  readonly response?: Response;
}

/**
 * A call's data, or what its failure means for the page: an expired session goes back to sign-in,
 * anything else becomes the matching HTTP error. A 409 field refusal is the caller's to handle first.
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.response?.ok === true && result.data !== undefined) return result.data;
  fail(result);
}

/** The same, for calls that answer 204 No Content. */
export function unwrapEmpty(result: Result<unknown>): void {
  if (result.response?.ok !== true) fail(result);
}

function fail(result: Result<unknown>): never {
  const status = result.response?.status ?? 502;
  if (status === 401) redirect(303, resolve("/sign-in"));
  if (status === 403) error(403, "Only administrators can do this.");
  error(status >= 500 || status < 400 ? 502 : status, "The controller refused the request.");
}

/** The field refusal a failed call carries, if it is one. */
export function fieldRefusal(result: Result<unknown>): FieldRefusal | undefined {
  return result.response?.status === 409 ? FieldRefusal.safeParse(result.error).data : undefined;
}

const ErrorCode = z.object({ error: z.string() });

/** The error code a failed call's body names (`fresh_session_required`…), if any. */
export function errorCode(result: Result<unknown>): string | undefined {
  return result.response?.ok === true ? undefined : ErrorCode.safeParse(result.error).data?.error;
}
