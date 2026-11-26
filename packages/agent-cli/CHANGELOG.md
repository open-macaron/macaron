# @open-macaron/agent-cli

## 0.5.8

### Patch Changes

- 07db484: Security fixes: bump `body-parser` (2.3.0 → 2.4.0), `qs` (6.16.0 → 6.17.1), `undici` (6.29.0 → 6.29.1).
- Updated dependencies [07db484]
  - @open-macaron/contracts@0.22.2
  - @open-macaron/review@0.5.6

## 0.5.7

### Patch Changes

- Updated dependencies [b1a417e]
  - @open-macaron/review@0.5.5

## 0.5.6

### Patch Changes

- 8114bef: Bump `@secretlint/secretlint-rule-pattern` (13.0.7 → 13.1.0), `@secretlint/secretlint-rule-preset-recommend` (13.0.7 → 13.1.0), `better-auth` (1.7.11 → 1.7.27), `file-type` (22.1.1 → 22.3.0), `jose` (6.2.12 → 6.2.18), `markdown-table` (3.0.4 → 3.1.0), `unist-util-visit` (5.1.0 → 5.2.0), `zod` (4.6.6 → 4.6.7).
- Updated dependencies [8114bef]
  - @open-macaron/contracts@0.22.1
  - @open-macaron/review@0.5.4

## 0.5.5

### Patch Changes

- Updated dependencies [11df33a]
  - @open-macaron/contracts@0.22.0
  - @open-macaron/review@0.5.3

## 0.5.4

### Patch Changes

- Updated dependencies [8295d64]
  - @open-macaron/contracts@0.21.1
  - @open-macaron/review@0.5.2

## 0.5.3

### Patch Changes

- Updated dependencies [a62e0ea]
  - @open-macaron/contracts@0.21.0
  - @open-macaron/review@0.5.1

## 0.5.2

### Patch Changes

- 4e01949: `finish` collects the working tree's changes only in modes that can commit (#200). A `verify`, `reproduce` or `full_review` no longer fails when a build, or the repository's own Claude Code hooks (a formatter), leaves files changed: those changes can't be published, so they are logged and dropped instead of getting the run's answer refused.

## 0.5.1

### Patch Changes

- 85081d0: A `full_review` run gets its context, its Gate and its single GitHub review (#189, part of #186), still unreachable until #190. Its context carries the pull request and its rules, as a review's, plus the lessons, as a verify's; the rules are checked on the repository's review model (`review.model`, from `models.review`), which the run's key allows. The Gate verifies its verdicts like a review's and checks its answer like a reply. It is published as one review: the verify answer and its screenshots first, then the rule checks, the rules' model in the footer. Over GitHub's size limit, the table keeps its violations and warnings only (`attentionOnly` in `renderMarkdown`), and as a last resort the answer is cut.
- Updated dependencies [85081d0]
  - @open-macaron/contracts@0.20.0
  - @open-macaron/review@0.5.0

## 0.5.0

### Minor Changes

- 3d796b8: A `full_review` run (#188, part of #186) runs the verify session and the rule review in parallel, each in its own session (the rules' stays read-only, without MCP servers), and merges them into one result.json: a review whose message is the verify answer. When only one of them completes, its part is published, saying the other didn't complete; when neither does, the run fails and can be retried.

## 0.4.0

### Minor Changes

- bdba764: A `full_review` mode, not reachable yet (#187, part of #186): a verify session and the rule review in one run, published as one GitHub review. It needs both the `verify` and `review` capabilities (`requiredCapabilities` replaces `requiredCapability`), sets the project up, and is budgeted as a verify plus a review, so the configuration has no budget of its own for it. A review result may carry the verify answer in `message`.

### Patch Changes

- Updated dependencies [bdba764]
  - @open-macaron/contracts@0.19.0
  - @open-macaron/review@0.4.1

## 0.3.9

### Patch Changes

- Updated dependencies [e6659ea]
  - @open-macaron/review@0.4.0

## 0.3.8

### Patch Changes

- Updated dependencies [cfb4f0f]
  - @open-macaron/contracts@0.18.0
  - @open-macaron/review@0.3.19

## 0.3.7

### Patch Changes

- Updated dependencies [5eabb9c]
  - @open-macaron/contracts@0.17.0
  - @open-macaron/review@0.3.18

## 0.3.6

### Patch Changes

- Updated dependencies [b4e2518]
  - @open-macaron/contracts@0.16.0
  - @open-macaron/review@0.3.17

## 0.3.5

### Patch Changes

- 487eefa: `macaron-agent finish` keeps the file `attach` copied when result.json lists the same attachment again (only its caption is taken), and refuses an attachment whose file isn't in the output, which the Gate would refuse after the run.

## 0.3.4

### Patch Changes

- 1f265cf: The prompt shows how to place a screenshot: a picture (`![caption](attachment:id)`) on a line of its own, with a right and a wrong example.

## 0.3.3

### Patch Changes

- Updated dependencies [75749f8]
  - @open-macaron/contracts@0.15.0
  - @open-macaron/review@0.3.16

## 0.3.2

### Patch Changes

- 9dfb39a: `macaron-agent finish` refuses a result that would read badly once published: an attachment no text places (it would never be shown) and a reply to anything but a review comment (it would be quoted after the message, repeating it), each with the exact change to make. The prompt says so too. The last check, after the session, repairs instead of failing the run: unplaced attachments are added after the message, and an unthreadable reply becomes the message when there is none. The pattern of `attachment:<id>` references is shared from contracts (`ATTACHMENT_REFERENCE`).
- Updated dependencies [9dfb39a]
  - @open-macaron/contracts@0.14.1
  - @open-macaron/review@0.3.15

## 0.3.1

### Patch Changes

- Updated dependencies [b401fb2]
  - @open-macaron/contracts@0.14.0
  - @open-macaron/review@0.3.14

## 0.3.0

### Minor Changes

- 005ca3a: `reproduce` and `verify` answers end with a Verdict: an overall ✅ / ❌ / ⚠️ line in fixed words (Verified, Not verified, Partially verified, Could not verify; Reproduced, Not reproduced, …), then one line per claim when several were asked.

### Patch Changes

- Updated dependencies [5d473ba]
  - @open-macaron/contracts@0.13.0
  - @open-macaron/review@0.3.13

## 0.2.1

### Patch Changes

- Updated dependencies [96f4b99]
  - @open-macaron/contracts@0.12.0
  - @open-macaron/review@0.3.12

## 0.2.0

### Minor Changes

- 9e9b47f: `implement` and `address_review` runs get the project's rules from open-macaron/knowledge: an index in the system prompt, the full text in a file per rule, and the instruction to check their changes against the rules that match before finishing.

### Patch Changes

- Updated dependencies [9e9b47f]
  - @open-macaron/contracts@0.11.0
  - @open-macaron/review@0.3.11

## 0.1.10

### Patch Changes

- Updated dependencies [9ca6995]
  - @open-macaron/contracts@0.10.0
  - @open-macaron/review@0.3.10

## 0.1.9

### Patch Changes

- Updated dependencies [a71ccab]
  - @open-macaron/contracts@0.9.0
  - @open-macaron/review@0.3.9

## 0.1.8

### Patch Changes

- Updated dependencies [703d412]
  - @open-macaron/contracts@0.8.0
  - @open-macaron/review@0.3.8

## 0.1.7

### Patch Changes

- Updated dependencies [acf0af5]
  - @open-macaron/contracts@0.7.0
  - @open-macaron/review@0.3.7

## 0.1.6

### Patch Changes

- Updated dependencies [3a1032a]
  - @open-macaron/contracts@0.6.0
  - @open-macaron/review@0.3.6

## 0.1.5

### Patch Changes

- Updated dependencies [fbd5b6e]
  - @open-macaron/contracts@0.5.0
  - @open-macaron/review@0.3.5

## 0.1.4

### Patch Changes

- Updated dependencies [7dfb14e]
  - @open-macaron/contracts@0.4.0
  - @open-macaron/review@0.3.4

## 0.1.3

### Patch Changes

- Updated dependencies [9ab8f08]
- Updated dependencies [b6b02bf]
- Updated dependencies [47abc60]
  - @open-macaron/contracts@0.3.0
  - @open-macaron/review@0.3.3

## 0.1.2

### Patch Changes

- ecfe30f: The controller client is generated for `POST /v1/bootstrap` only: the web app's routes stay out of the runner.
- Updated dependencies [6b1ed0d]
  - @open-macaron/contracts@0.2.0
  - @open-macaron/review@0.3.2

## 0.1.1

### Patch Changes

- Updated dependencies [92b7ca5]
- Updated dependencies [f238b34]
  - @open-macaron/contracts@0.1.0
  - @open-macaron/review@0.3.1
