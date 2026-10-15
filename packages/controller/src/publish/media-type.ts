import { fileTypeFromBuffer } from "file-type";

export type MediaKind = "image" | "video";

/** The only media we publish, by detected MIME type. Anything else (SVG, HTML, PDF, MKV…) is rejected. */
const ALLOWED: ReadonlyMap<string, MediaKind> = new Map([
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["image/gif", "image"],
  ["image/webp", "image"],
  ["video/webm", "video"],
  ["video/mp4", "video"],
]);

export interface DetectedMedia {
  readonly mime: string;
  readonly ext: string;
  readonly kind: MediaKind;
}

/** Identifies a file from its content with `file-type`; names and declared kinds are never trusted. */
export async function detectMedia(bytes: Uint8Array): Promise<DetectedMedia | undefined> {
  const detected = await fileTypeFromBuffer(bytes);
  if (detected === undefined) return undefined;
  const kind = ALLOWED.get(detected.mime);
  return kind === undefined ? undefined : { mime: detected.mime, ext: detected.ext, kind };
}
