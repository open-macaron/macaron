export type MediaType = "png" | "jpeg" | "gif" | "webp" | "webm" | "mp4";
export type MediaKind = "image" | "video";

export const mediaKind: Readonly<Record<MediaType, MediaKind>> = {
  png: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  webm: "video",
  mp4: "video",
};

export const contentType: Readonly<Record<MediaType, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  webm: "video/webm",
  mp4: "video/mp4",
};

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string): number[] => Array.from(Buffer.from(text, "latin1"));

/**
 * Identifies a file by its magic bytes only; file names and declared kinds are never trusted.
 * Anything not on this allow-list (SVG, HTML, PDF…) is undefined and therefore rejected.
 */
export function sniffMediaType(bytes: Uint8Array): MediaType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (startsWith(bytes, ascii("ftyp"), 4)) return "mp4";
  return undefined;
}
