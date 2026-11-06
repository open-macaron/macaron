import { RunResult } from "@open-macaron/contracts";
import { describe, expect, it } from "vitest";
import { presentationProblems, repairPresentation } from "../src/presentation.ts";

const REVIEW_COMMENT = 501;
const CONVERSATION_COMMENT = 777;
const reviewCommentIds: ReadonlySet<number> = new Set([REVIEW_COMMENT]);
const shot = (id: string, caption: string) => ({ id, path: `media/${id}.png`, kind: "image", caption });
const result = (fields: Record<string, unknown>): RunResult => RunResult.parse({ action: "reply", summary: "Verified.", replies: [], attachments: [], learnings: [], ...fields });

describe("presentationProblems", () => {
  it("accepts attachments placed in any text readers see, and replies to review comments", () => {
    const placed = result({
      message: "Before:\n![a](attachment:image-1)",
      pr: { title: "fix", body: "- After:\n\n  ![b](attachment:image-2)" },
      replies: [{ inReplyTo: REVIEW_COMMENT, body: "Fixed.\n\n![c](attachment:image-3)\n\nThanks." }],
      attachments: [shot("image-1", "a"), shot("image-2", "b"), shot("image-3", "c")],
    });

    expect(presentationProblems(placed, reviewCommentIds)).toEqual([]);
  });

  it("names each unplaced attachment with the markdown that places it, and each reply that can't be threaded", () => {
    const sloppy = result({
      message: "Six screenshots.",
      replies: [{ inReplyTo: CONVERSATION_COMMENT, body: "Six screenshots, again." }],
      attachments: [shot("image-1", "The [new] dropdown")],
    });

    expect(presentationProblems(sloppy, reviewCommentIds)).toEqual([
      "attachment image-1 is in no text, so it won't be shown: add ![The new dropdown](attachment:image-1) to message (or pr.body) where it shows the point",
      "the reply to comment 777 can't be threaded (only review comments can): answer it in message and remove it from replies",
    ]);
  });

  it("names each attachment linked, left bare or set inside a sentence, with the markdown that shows it", () => {
    const sloppy = result({
      message: "- 1000x700: complete ([screenshot](attachment:image-1)).\n- 640x700: see ![b](attachment:image-2) here.\n- Logs: attachment:image-3",
      attachments: [shot("image-1", "1000x700"), shot("image-2", "640x700"), shot("image-3", "Logs")],
    });

    expect(presentationProblems(sloppy, reviewCommentIds)).toEqual([
      "attachment image-1 is linked or inside a sentence, so it won't read as a picture: replace it with ![1000x700](attachment:image-1) on a line of its own, after the text it illustrates",
      "attachment image-2 is linked or inside a sentence, so it won't read as a picture: replace it with ![640x700](attachment:image-2) on a line of its own, after the text it illustrates",
      "attachment image-3 is linked or inside a sentence, so it won't read as a picture: replace it with ![Logs](attachment:image-3) on a line of its own, after the text it illustrates",
    ]);
  });
});

describe("repairPresentation", () => {
  it("moves attachments linked inside a sentence after the message, as pictures", () => {
    const sloppy = result({
      message: "- 1000x700: complete ([screenshot](attachment:image-1)).\n- 640x700: complete.",
      attachments: [shot("image-1", "1000x700")],
    });

    const repaired = repairPresentation(sloppy, reviewCommentIds);

    expect(repaired.message).toBe("- 1000x700: complete.\n- 640x700: complete.\n\n![1000x700](attachment:image-1)");
    expect(presentationProblems(repaired, reviewCommentIds)).toEqual([]);
  });

  it("adds unplaced attachments after the message, captions as alt text", () => {
    const repaired = repairPresentation(result({ message: "Verified.", attachments: [shot("image-1", "Dropdown open"), shot("image-2", "Filtered")] }), reviewCommentIds);

    expect(repaired.message).toBe("Verified.\n\n![Dropdown open](attachment:image-1)\n\n![Filtered](attachment:image-2)");
    expect(presentationProblems(repaired, reviewCommentIds)).toEqual([]);
  });

  it("adds them to the pull request's body when there is no message", () => {
    const repaired = repairPresentation(result({ action: "commit", commitMessage: "fix", pr: { title: "fix", body: "Fixes #1." }, attachments: [shot("image-1", "Fixed")] }), reviewCommentIds);

    expect(repaired.pr?.body).toBe("Fixes #1.\n\n![Fixed](attachment:image-1)");
    expect(repaired.message).toBeUndefined();
  });

  it("makes a reply that can't be threaded the message when there is none, keeping replies to review comments", () => {
    const repaired = repairPresentation(
      result({
        replies: [
          { inReplyTo: CONVERSATION_COMMENT, body: "Verified." },
          { inReplyTo: REVIEW_COMMENT, body: "Done." },
        ],
      }),
      reviewCommentIds,
    );

    expect(repaired.message).toBe("Verified.");
    expect(repaired.replies).toEqual([{ inReplyTo: REVIEW_COMMENT, body: "Done." }]);
  });

  it("leaves such a reply beside an existing message: the publisher quotes it after the message", () => {
    const sloppy = result({ message: "Verified.", replies: [{ inReplyTo: CONVERSATION_COMMENT, body: "Also verified." }] });

    expect(repairPresentation(sloppy, reviewCommentIds)).toEqual(sloppy);
  });
});
