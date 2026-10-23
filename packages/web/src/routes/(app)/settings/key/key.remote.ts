import { invalid } from "@sveltejs/kit";
import { command, form, query } from "$app/server";
import { z } from "zod";
import { HISTORY_PAGE, KeyInput } from "#lib/keys/forms.js";
import { requireUser } from "#lib/server/admin/access.js";
import { controller, errorCode, fieldRefusal, unwrap, unwrapEmpty } from "#lib/server/controller/index.js";
import { deleteMyLlmKey, getMyLlmKey, getMyLlmKeyEvents, saveMyLlmKey } from "#lib/server/controller/generated/sdk.gen.js";

/** The signed-in user's key (never the key itself), the endpoints they may pick, and until when they may change it. */
export const getMyKey = query(async () => {
  requireUser();
  return unwrap(await getMyLlmKey({ client: controller() }));
});

/** A page of the key's history, newest first; `before` is the previous page's cursor. */
export const getKeyEvents = query(z.object({ before: z.string().max(200).optional(), limit: z.int().min(1).max(100).default(25) }), async ({ before, limit }) => {
  requireUser();
  return unwrap(await getMyLlmKeyEvents({ client: controller(), query: before === undefined ? { limit } : { before, limit } }));
});

/** Saved, or why not when the form can't show it on a field. */
export type SaveOutcome = { readonly saved: true; readonly endpointName: string; readonly last4: string; readonly missingModels: readonly string[] } | { readonly saved: false; readonly reason: "fresh_session_required" };

export const saveKey = form(KeyInput, async ({ endpointId, _key }, issue): Promise<SaveOutcome> => {
  requireUser();
  const result = await saveMyLlmKey({ client: controller(), body: { endpointId, key: _key } });
  // Refused or not, the attempt is in the history.
  void getKeyEvents({ limit: HISTORY_PAGE }).refresh();
  const refusal = fieldRefusal(result);
  if (refusal !== undefined) invalid(refusal.field === "endpointId" ? issue.endpointId(refusal.message) : issue._key(refusal.message));
  const code = errorCode(result);
  if (code === "fresh_session_required") return { saved: false, reason: code };
  if (code === "too_many_attempts") invalid("You tried 5 keys within the last hour. Try again later.");
  if (code === "key_storage_unavailable") invalid("This deployment can't store keys yet. Ask an administrator.");
  const saved = unwrap(result);
  void getMyKey().refresh();
  return { saved: true, endpointName: saved.key.endpoint.name, last4: saved.key.last4, missingModels: saved.missingModels };
});

export const deleteKey = command(async (): Promise<{ readonly deleted: boolean }> => {
  requireUser();
  const result = await deleteMyLlmKey({ client: controller() });
  if (errorCode(result) === "fresh_session_required") return { deleted: false };
  unwrapEmpty(result);
  void getMyKey().refresh();
  void getKeyEvents({ limit: HISTORY_PAGE }).refresh();
  return { deleted: true };
});
