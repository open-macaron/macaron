import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ArtifactInvalid, readArtifact } from "../../src/runs/artifact.ts";
import { BASE_SHA, PNG, runResult, text } from "../support/fixtures.ts";

const json = (value: unknown) => strToU8(JSON.stringify(value));

describe("readArtifact", () => {
  it("reads result, changes and media, and ignores unknown entries", () => {
    const zip = zipSync({
      "result.json": json(runResult()),
      "changes.json": json({ baseSha: BASE_SHA, files: [{ action: "upsert", path: "a.ts", mode: "100644", contentBase64: text("x") }] }),
      "media/shot.png": PNG,
      "../../etc/passwd": strToU8("nope"),
      "notes.txt": strToU8("ignored"),
    });

    const artifact = readArtifact(zip);

    expect(artifact.result.action).toBe("commit");
    expect(artifact.changes?.files).toHaveLength(1);
    expect([...artifact.media.keys()]).toEqual(["media/shot.png"]);
  });

  it("requires result.json", () => {
    expect(() => readArtifact(zipSync({ "changes.json": json({ baseSha: BASE_SHA, files: [] }) }))).toThrow("result.json is missing");
  });

  it("rejects results that do not match the contract", () => {
    expect(() => readArtifact(zipSync({ "result.json": json({ action: "push --force" }) }))).toThrow(ArtifactInvalid);
  });

  it("rejects oversized entries before inflating them", () => {
    const zip = zipSync({ "result.json": json(runResult()), "media/big.png": new Uint8Array(2_000) });

    expect(() => readArtifact(zip, { maxZipBytes: 1_000_000, maxEntryBytes: 1_000, maxTotalBytes: 1_000_000 })).toThrow("media/big.png is too large");
  });

  it("rejects garbage", () => {
    expect(() => readArtifact(strToU8("not a zip"))).toThrow(ArtifactInvalid);
  });
});
