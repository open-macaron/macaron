import { OwnersFile } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { type ApprovalInput, decide, type Review, touchedFolders } from "../src/approval.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const owners = (...entries: [string, number][]): OwnersFile => OwnersFile.parse({ owners: entries.map(([login, id]) => ({ login, id })) });

const AXEL = 42_176_370;
const BOT = 180_758_136;
const ALICE = 1001;

const approve = (userId: number, login: string, commitId = HEAD): Review => ({ userId, login, state: "APPROVED", commitId });

function input(overrides: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    headSha: HEAD,
    authorId: BOT,
    files: [{ path: "projects/sandbox/rules/no-runtime-json-read.md" }],
    reviews: [approve(AXEL, "axel7083")],
    ownersOnMain: new Map([["projects/sandbox", owners(["axel7083", AXEL])]]),
    formatValid: true,
    ...overrides,
  };
}

describe("decide", () => {
  it("merges a valid PR approved by an owner of every touched folder on the head commit", () => {
    expect(decide(input())).toEqual({
      ready: true,
      formatValid: true,
      unownedFiles: 0,
      folders: [{ folder: "projects/sandbox", state: "approved", by: ["axel7083"] }],
    });
  });

  it("matches owners by id, never by login (a renamed or re-registered login doesn't count)", () => {
    expect(decide(input({ reviews: [approve(9999, "axel7083")] })).ready).toBe(false);
    expect(decide(input({ reviews: [approve(AXEL, "new-name")] })).ready).toBe(true);
  });

  it("ignores approvals on an older commit: pushing again needs a new approval", () => {
    const decision = decide(input({ reviews: [approve(AXEL, "axel7083", OLD)] }));
    expect(decision.ready).toBe(false);
    expect(decision.folders).toEqual([{ folder: "projects/sandbox", state: "waiting", owners: ["axel7083"] }]);
  });

  it("never counts the author's own approval", () => {
    expect(decide(input({ authorId: AXEL })).ready).toBe(false);
  });

  it("ignores approvals from people who aren't owners of that folder", () => {
    expect(decide(input({ reviews: [approve(ALICE, "alice")] })).ready).toBe(false);
  });

  it("requires an owner's approval for every touched folder", () => {
    const decision = decide(
      input({
        files: [{ path: "projects/sandbox/rules/a.md" }, { path: "repos/axel7083/foobar-tmp-demo/lessons/b.md" }],
        ownersOnMain: new Map([
          ["projects/sandbox", owners(["axel7083", AXEL])],
          ["repos/axel7083/foobar-tmp-demo", owners(["alice", ALICE])],
        ]),
      }),
    );
    expect(decision.ready).toBe(false);
    expect(decision.folders).toContainEqual({ folder: "repos/axel7083/foobar-tmp-demo", state: "waiting", owners: ["alice"] });
  });

  it("is blocked by an owner's standing change request, and unblocked when that owner approves later", () => {
    const changes: Review = { userId: ALICE, login: "alice", state: "CHANGES_REQUESTED", commitId: HEAD };
    const ownedByBoth = new Map([["projects/sandbox", owners(["axel7083", AXEL], ["alice", ALICE])]]);
    expect(decide(input({ ownersOnMain: ownedByBoth, reviews: [approve(AXEL, "axel7083"), changes] })).folders).toEqual([
      { folder: "projects/sandbox", state: "changes_requested", by: ["alice"] },
    ]);
    expect(decide(input({ ownersOnMain: ownedByBoth, reviews: [changes, approve(ALICE, "alice")] })).ready).toBe(true);
  });

  it("keeps a reviewer's approval when they only comment afterwards, and drops it when dismissed", () => {
    const comment: Review = { userId: AXEL, login: "axel7083", state: "COMMENTED", commitId: HEAD };
    const dismissed: Review = { userId: AXEL, login: "axel7083", state: "DISMISSED", commitId: HEAD };
    expect(decide(input({ reviews: [approve(AXEL, "axel7083"), comment] })).ready).toBe(true);
    expect(decide(input({ reviews: [approve(AXEL, "axel7083"), dismissed] })).ready).toBe(false);
  });

  it("leaves to the platform team any path outside an owned folder that exists on main", () => {
    expect(decide(input({ files: [{ path: ".github/workflows/merge.yml" }] }))).toMatchObject({ ready: false, unownedFiles: 1 });
    expect(decide(input({ files: [{ path: "README.md" }, { path: "projects/sandbox/rules/a.md" }] }))).toMatchObject({ ready: false, unownedFiles: 1 });
    // A new project: no OWNERS.yaml on main yet.
    expect(decide(input({ files: [{ path: "projects/new/OWNERS.yaml" }], ownersOnMain: new Map([["projects/new", undefined]]) }))).toMatchObject({
      ready: false,
      unownedFiles: 1,
    });
  });

  it("counts both sides of a rename: moving a file out of a folder needs that folder's owners too", () => {
    const decision = decide(
      input({
        files: [{ path: "projects/sandbox/rules/a.md", previousPath: "projects/other/rules/a.md" }],
        ownersOnMain: new Map([
          ["projects/sandbox", owners(["axel7083", AXEL])],
          ["projects/other", owners(["alice", ALICE])],
        ]),
      }),
    );
    expect(decision.ready).toBe(false);
  });

  it("never merges an invalid format or an empty change", () => {
    expect(decide(input({ formatValid: false })).ready).toBe(false);
    expect(decide(input({ files: [] })).ready).toBe(false);
  });
});

describe("touchedFolders", () => {
  it("maps paths to their owned folder and refuses malformed ones", () => {
    expect(
      touchedFolders([
        { path: "global/rules/a.md" },
        { path: "projects/sandbox/OWNERS.yaml" },
        { path: "repos/axel7083/foobar-tmp-demo/overview.md" },
        { path: "projects/Not_Kebab/rules/a.md" },
        { path: "projects/global/rules/a.md" },
        { path: "repos/axel7083/../x/y.md" },
        { path: "LICENSE" },
      ]),
    ).toEqual({ folders: ["global", "projects/sandbox", "repos/axel7083/foobar-tmp-demo"], outside: 4 });
  });
});
