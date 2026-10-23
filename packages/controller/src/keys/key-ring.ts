import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A user's key as stored: AES-256-GCM under the key-encryption key `kekVersion`. */
export interface Sealed {
  readonly kekVersion: number;
  readonly iv: Buffer;
  readonly ciphertext: Buffer;
  readonly tag: Buffer;
}

/** A ciphertext that doesn't open: tampered, bound to another user or endpoint, or under a retired version. */
export class SealBroken extends Error {
  override readonly name = "SealBroken";
}

const VERSION_FILE = /^v([1-9]\d{0,5})$/;
const HEX_KEY = /^[0-9a-f]{64}$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The key-encryption keys (KEKs), read once from a directory: the Secret `macaron-llm-kek` mounted
 * as files `v1`, `v2`…, each 32 random bytes in hex. The newest version seals; every version opens,
 * so a rotation adds a version, re-seals (`rotate-llm-keys`), then retires the old one.
 * They live in memory only: never in Postgres, its dumps, an environment variable or a log line.
 */
export class KeyRing {
  readonly current: number;

  private constructor(private readonly keks: ReadonlyMap<number, Buffer>) {
    this.current = Math.max(...keks.keys());
  }

  static fromDirectory(directory: string): KeyRing {
    const keks = new Map<number, Buffer>();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // Kubernetes mounts a Secret's files as symlinks into a timestamped directory, alongside `..data`.
      const match = VERSION_FILE.exec(entry.name);
      if (match?.[1] === undefined) continue;
      const hex = readFileSync(join(directory, entry.name), "utf8").trim().toLowerCase();
      if (!HEX_KEY.test(hex)) throw new Error(`LLM_KEK_DIR: ${entry.name} isn't 32 bytes in hex (openssl rand -hex 32)`);
      keks.set(Number(match[1]), Buffer.from(hex, "hex"));
    }
    if (keks.size === 0) throw new Error(`LLM_KEK_DIR: no key-encryption key (files v1, v2…) in ${directory}`);
    return new KeyRing(keks);
  }

  /** For tests: versions and their 32-byte keys. */
  static of(keks: ReadonlyMap<number, Buffer>): KeyRing {
    if (keks.size === 0 || [...keks.values()].some((kek) => kek.length !== 32)) throw new Error("expected 32-byte keys");
    return new KeyRing(keks);
  }

  has(version: number): boolean {
    return this.keks.has(version);
  }

  seal(plain: string, aad: string): Sealed {
    const kek = this.kek(this.current);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", kek, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return { kekVersion: this.current, iv, ciphertext, tag: cipher.getAuthTag() };
  }

  open(sealed: Sealed, aad: string): string {
    if (!this.keks.has(sealed.kekVersion)) throw new SealBroken(`key-encryption key v${String(sealed.kekVersion)} is not in the key ring`);
    // Node accepts tags down to 4 bytes: a stored row with a short one would weaken the check.
    if (sealed.iv.length !== IV_BYTES || sealed.tag.length !== TAG_BYTES) throw new SealBroken("the sealed key has an IV or tag of the wrong length");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.kek(sealed.kekVersion), sealed.iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(sealed.tag);
      return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      throw new SealBroken("the sealed key doesn't open", { cause: error });
    }
  }

  private kek(version: number): Buffer {
    const kek = this.keks.get(version);
    if (kek === undefined) throw new SealBroken(`key-encryption key v${String(version)} is not in the key ring`);
    return kek;
  }
}

/** What a sealed key is bound to: its owner and its endpoint. */
export function keyAad(userId: string, endpointId: string): string {
  return `macaron/llm-key/v1\u0000${userId}\u0000${endpointId}`;
}
