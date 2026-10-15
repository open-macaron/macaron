import { type Attachment, allowedActions, type Changes, type FileChange, type Mode, type RunContext, type RunResult } from "@open-macaron/contracts";
import { mediaKind, type MediaType, sniffMediaType } from "./media-type.ts";
import { findSecrets } from "./secrets.ts";

export interface GateLimits {
  readonly maxChangedFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_GATE_LIMITS: GateLimits = {
  maxChangedFiles: 300,
  maxFileBytes: 1_000_000,
  maxTotalBytes: 10_000_000,
};

export interface GateInput {
  readonly mode: Mode;
  readonly context: RunContext;
  readonly result: RunResult;
  readonly changes: Changes | undefined;
  /** `media/<file>` → bytes, as found in the artifact. */
  readonly media: ReadonlyMap<string, Uint8Array>;
  readonly limits?: GateLimits;
}

export interface VettedAttachment extends Attachment {
  readonly type: MediaType;
  readonly bytes: Uint8Array;
  readonly previewType?: MediaType;
  readonly previewBytes?: Uint8Array;
}

/** What may be published, once the Gate has said yes. */
export interface Publishable {
  readonly result: RunResult;
  readonly changes: Changes | undefined;
  readonly attachments: readonly VettedAttachment[];
}

export type Verdict = { readonly ok: true; readonly publishable: Publishable } | { readonly ok: false; readonly violations: readonly string[] };

/** Paths the bot must never change, whatever the repo. */
const FORBIDDEN_PATH = /^(\.github\/|\.git\/|\.gitmodules$)|(^|\/)\.git(\/|$)/;
const ATTACHMENT_REF = /attachment:([a-z0-9][a-z0-9-]{0,62})/g;

/**
 * The deterministic policy between an untrusted run and anything public.
 * Pure: same input, same verdict. Collects every violation instead of stopping at the first.
 */
export function gate(input: GateInput): Verdict {
  const limits = input.limits ?? DEFAULT_GATE_LIMITS;
  const violations: string[] = [];
  const { mode, context, result } = input;

  if (!allowedActions[mode].includes(result.action)) violations.push(`action "${result.action}" is not allowed in mode "${mode}"`);
  if (result.action === "escalate" && (result.escalateTo === mode || result.escalateTo === "retro")) {
    violations.push(`cannot escalate from "${mode}" to "${result.escalateTo}"`);
  }

  // Changes: only with a commit, and only within limits.
  if (result.action === "commit") {
    if (input.changes === undefined || input.changes.files.length === 0) violations.push("action is commit but there are no changes");
    else violations.push(...checkChanges(input.changes, context, limits));
  } else if (input.changes !== undefined && input.changes.files.length > 0) {
    violations.push(`changes are only accepted with action "commit", got "${result.action}"`);
  }

  // Replies may only target comments the agent was shown.
  const known = new Set([...context.thread.map((comment) => comment.id), ...context.reviewComments.map((comment) => comment.id)]);
  for (const reply of result.replies) {
    if (!known.has(reply.inReplyTo)) violations.push(`reply targets unknown comment ${String(reply.inReplyTo)}`);
  }

  // Texts must not leak credentials.
  const texts = [result.message, result.summary, result.commitMessage, result.pr?.title, result.pr?.body, ...result.replies.map((reply) => reply.body)];
  for (const text of texts) {
    if (text !== undefined) for (const secret of findSecrets(text)) violations.push(`text contains a ${secret}`);
  }

  // Attachments: real types, within limits, and every reference resolves.
  const { attachments, problems } = checkAttachments(result, input.media, context);
  violations.push(...problems);

  return violations.length > 0 ? { ok: false, violations } : { ok: true, publishable: { result, changes: input.changes, attachments } };
}

function checkChanges(changes: Changes, context: RunContext, limits: GateLimits): string[] {
  const violations: string[] = [];
  if (changes.baseSha !== context.baseSha) violations.push("changes were made on another base commit");
  if (changes.files.length > limits.maxChangedFiles) violations.push(`${String(changes.files.length)} files changed, limit is ${String(limits.maxChangedFiles)}`);

  const seen = new Set<string>();
  let total = 0;
  for (const file of changes.files) {
    if (seen.has(file.path)) violations.push(`${file.path}: changed twice`);
    seen.add(file.path);
    if (FORBIDDEN_PATH.test(file.path)) violations.push(`${file.path}: this path may not be changed by the bot`);
    if (file.action === "upsert") {
      const bytes = decode(file);
      total += bytes.length;
      if (bytes.length > limits.maxFileBytes) violations.push(`${file.path}: ${String(bytes.length)} bytes, limit is ${String(limits.maxFileBytes)}`);
      if (bytes.subarray(0, 8_192).includes(0)) violations.push(`${file.path}: binary files are not accepted`);
      for (const secret of findSecrets(Buffer.from(bytes).toString("utf8"))) violations.push(`${file.path}: contains a ${secret}`);
    }
  }
  if (total > limits.maxTotalBytes) violations.push(`${String(total)} bytes changed in total, limit is ${String(limits.maxTotalBytes)}`);
  return violations;
}

function decode(file: Extract<FileChange, { action: "upsert" }>): Uint8Array {
  return Buffer.from(file.contentBase64, "base64");
}

function checkAttachments(
  result: RunResult,
  media: ReadonlyMap<string, Uint8Array>,
  context: RunContext,
): { attachments: VettedAttachment[]; problems: string[] } {
  const problems: string[] = [];
  const attachments: VettedAttachment[] = [];
  const limits = context.attachments;

  if (result.attachments.length > limits.maxFiles) problems.push(`${String(result.attachments.length)} attachments, limit is ${String(limits.maxFiles)}`);
  let total = 0;

  const load = (path: string, expected: "image" | "video" | "preview", owner: string): { type: MediaType; bytes: Uint8Array } | undefined => {
    const bytes = media.get(path);
    if (bytes === undefined) {
      problems.push(`${owner}: ${path} is missing from the artifact`);
      return undefined;
    }
    total += bytes.length;
    if (bytes.length > limits.maxFileBytes) problems.push(`${owner}: ${path} is ${String(bytes.length)} bytes, limit is ${String(limits.maxFileBytes)}`);
    const type = sniffMediaType(bytes);
    if (type === undefined) {
      problems.push(`${owner}: ${path} is not an allowed image or video type`);
      return undefined;
    }
    const kind = expected === "preview" ? "image" : expected;
    if (mediaKind[type] !== kind) problems.push(`${owner}: ${path} is a ${type}, expected an ${kind}`);
    return { type, bytes };
  };

  for (const attachment of result.attachments) {
    const main = load(attachment.path, attachment.kind, `attachment ${attachment.id}`);
    const preview = attachment.preview === undefined ? undefined : load(attachment.preview, "preview", `attachment ${attachment.id}`);
    if (main !== undefined) {
      attachments.push({
        ...attachment,
        type: main.type,
        bytes: main.bytes,
        ...(preview === undefined ? {} : { previewType: preview.type, previewBytes: preview.bytes }),
      });
    }
  }
  if (total > limits.maxTotalBytes) problems.push(`attachments total ${String(total)} bytes, limit is ${String(limits.maxTotalBytes)}`);

  const ids = new Set(result.attachments.map((attachment) => attachment.id));
  const bodies = [result.message, result.pr?.body, ...result.replies.map((reply) => reply.body)];
  for (const body of bodies) {
    for (const match of body?.matchAll(ATTACHMENT_REF) ?? []) {
      const id = match[1];
      if (id !== undefined && !ids.has(id)) problems.push(`reference to unknown attachment "${id}"`);
    }
  }
  return { attachments, problems };
}
