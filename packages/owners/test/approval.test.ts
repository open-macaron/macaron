import { OwnersFile } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { type ApprovalInput, decide } from "../src/approval.ts";
import type { OwnersLayout } from "../src/layout.ts";

const HEAD = "a".repeat(40);
const AXEL = 42_176_370;
/** Folders directly under the root; root files belong to none. */
const layout: OwnersLayout = { folderOf: (path) => (/^([a-z]+)\//.exec(path)?.[1] === undefined ? undefined : { path: path.split("/")[0] ?? "" }) };

function input(overrides: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    headSha: HEAD,
    authorId: 1,
    files: [{ path: "team/file.yaml" }],
    reviews: [{ userId: AXEL, login: "axel7083", state: "APPROVED", commitId: HEAD }],
    ownersOnMain: new Map([["team", OwnersFile.parse({ owners: [{ login: "axel7083", id: AXEL }] })]]),
    formatValid: true,
    ...overrides,
  };
}

describe("decide, whatever the layout", () => {
  it("merges what the folder's owners approved", () => {
    expect(decide(input(), layout)).toMatchObject({ ready: true, unownedFiles: 0, platformFiles: 0 });
  });

  it("leaves to the platform team the paths its policy reserves, even when owners approved", () => {
    expect(decide(input({ platformPaths: ["team/file.yaml", "team/file.yaml"] }), layout)).toMatchObject({ ready: false, platformFiles: 1 });
  });

  it("leaves root files to the platform team", () => {
    expect(decide(input({ files: [{ path: "global.yaml" }] }), layout)).toMatchObject({ ready: false, unownedFiles: 1 });
  });
});
