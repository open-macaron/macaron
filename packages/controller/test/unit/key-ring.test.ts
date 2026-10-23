import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KeyRing, keyAad, SealBroken } from "../../src/keys/key-ring.ts";

const kek = (fill: number): Buffer => Buffer.alloc(32, fill);
const ring = KeyRing.of(new Map([[1, kek(1)], [2, kek(2)]]));
const aad = keyAad("user-a", "endpoint-1");

describe("KeyRing", () => {
  it("seals under the newest version and opens what it sealed", () => {
    const sealed = ring.seal("sk-ant-secret-value", aad);
    expect(sealed.kekVersion).toBe(2);
    expect(sealed.ciphertext.toString("utf8")).not.toContain("secret");
    expect(ring.open(sealed, aad)).toBe("sk-ant-secret-value");
  });

  it("never reuses an IV", () => {
    expect(ring.seal("a", aad).iv.equals(ring.seal("a", aad).iv)).toBe(false);
  });

  it("refuses a ciphertext moved to another user or endpoint", () => {
    const sealed = ring.seal("sk-ant-secret-value", aad);
    expect(() => ring.open(sealed, keyAad("user-b", "endpoint-1"))).toThrow(SealBroken);
    expect(() => ring.open(sealed, keyAad("user-a", "endpoint-2"))).toThrow(SealBroken);
  });

  it("refuses a tampered ciphertext or tag", () => {
    const sealed = ring.seal("sk-ant-secret-value", aad);
    const flipped = Buffer.from(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => ring.open({ ...sealed, ciphertext: flipped }, aad)).toThrow(SealBroken);
    const tag = Buffer.from(sealed.tag);
    tag[0] = (tag[0] ?? 0) ^ 1;
    expect(() => ring.open({ ...sealed, tag }, aad)).toThrow(SealBroken);
  });

  it("opens an older version until it is retired", () => {
    const old = KeyRing.of(new Map([[1, kek(1)]])).seal("sk-old", aad);
    expect(ring.open(old, aad)).toBe("sk-old");
    expect(() => KeyRing.of(new Map([[2, kek(2)]])).open(old, aad)).toThrow(/v1 is not in the key ring/);
  });

  it("reads versions from a directory, ignoring Kubernetes' bookkeeping entries", () => {
    const directory = mkdtempSync(join(tmpdir(), "kek-"));
    writeFileSync(join(directory, "v1"), `${"a".repeat(64)}\n`);
    writeFileSync(join(directory, "v3"), "B".repeat(64));
    writeFileSync(join(directory, "..data"), "ignored");
    const loaded = KeyRing.fromDirectory(directory);
    expect(loaded.current).toBe(3);
    expect(loaded.has(1)).toBe(true);
  });

  it("refuses a directory without a key or with a malformed one", () => {
    const empty = mkdtempSync(join(tmpdir(), "kek-"));
    expect(() => KeyRing.fromDirectory(empty)).toThrow(/no key-encryption key/);
    writeFileSync(join(empty, "v1"), "too-short");
    expect(() => KeyRing.fromDirectory(empty)).toThrow(/isn't 32 bytes in hex/);
  });
});
