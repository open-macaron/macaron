# @open-macaron/agent-cli

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
