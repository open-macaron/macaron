# @open-macaron/review

## 0.5.5

### Patch Changes

- b1a417e: Bump `@playwright/test` (1.64.1 → 1.65.1), `@swc/core` (1.16.18 → 1.16.22), `@testcontainers/postgresql` (12.2.0 → 12.2.2), `@vitest/coverage-v8` (5.0.4 → 5.1.1), `eslint` (10.12.0 → 10.15.0), `globals` (17.13.0 → 17.14.0), `msw` (3.0.3 → 3.0.7), `typescript-eslint` (8.71.1 → 8.73.0), `vitest` (5.0.4 → 5.1.1).

## 0.5.4

### Patch Changes

- 8114bef: Bump `@secretlint/secretlint-rule-pattern` (13.0.7 → 13.1.0), `@secretlint/secretlint-rule-preset-recommend` (13.0.7 → 13.1.0), `better-auth` (1.7.11 → 1.7.27), `file-type` (22.1.1 → 22.3.0), `jose` (6.2.12 → 6.2.18), `markdown-table` (3.0.4 → 3.1.0), `unist-util-visit` (5.1.0 → 5.2.0), `zod` (4.6.6 → 4.6.7).
- Updated dependencies [8114bef]
  - @open-macaron/contracts@0.22.1

## 0.5.3

### Patch Changes

- Updated dependencies [11df33a]
  - @open-macaron/contracts@0.22.0

## 0.5.2

### Patch Changes

- Updated dependencies [8295d64]
  - @open-macaron/contracts@0.21.1

## 0.5.1

### Patch Changes

- Updated dependencies [a62e0ea]
  - @open-macaron/contracts@0.21.0

## 0.5.0

### Minor Changes

- 85081d0: A `full_review` run gets its context, its Gate and its single GitHub review (#189, part of #186), still unreachable until #190. Its context carries the pull request and its rules, as a review's, plus the lessons, as a verify's; the rules are checked on the repository's review model (`review.model`, from `models.review`), which the run's key allows. The Gate verifies its verdicts like a review's and checks its answer like a reply. It is published as one review: the verify answer and its screenshots first, then the rule checks, the rules' model in the footer. Over GitHub's size limit, the table keeps its violations and warnings only (`attentionOnly` in `renderMarkdown`), and as a last resort the answer is cut.

### Patch Changes

- Updated dependencies [85081d0]
  - @open-macaron/contracts@0.20.0

## 0.4.1

### Patch Changes

- Updated dependencies [bdba764]
  - @open-macaron/contracts@0.19.0

## 0.4.0

### Minor Changes

- e6659ea: Reviews no longer report code a change only moves: a violation quoting a line the diff removes elsewhere (moved or re-indented code) is ignored, and the judge is told that what an edited line already had isn't the change's doing. Explanations say what the quoted code is before the fix. `macaron-review` prints what needs attention in full and the rules that passed or don't apply on one line (`--verbose` shows them all), without the repeated severity, with short quotes and costs rounded to the cent plus a total.

## 0.3.19

### Patch Changes

- Updated dependencies [cfb4f0f]
  - @open-macaron/contracts@0.18.0

## 0.3.18

### Patch Changes

- Updated dependencies [5eabb9c]
  - @open-macaron/contracts@0.17.0

## 0.3.17

### Patch Changes

- Updated dependencies [b4e2518]
  - @open-macaron/contracts@0.16.0

## 0.3.16

### Patch Changes

- Updated dependencies [75749f8]
  - @open-macaron/contracts@0.15.0

## 0.3.15

### Patch Changes

- Updated dependencies [9dfb39a]
  - @open-macaron/contracts@0.14.1

## 0.3.14

### Patch Changes

- Updated dependencies [b401fb2]
  - @open-macaron/contracts@0.14.0

## 0.3.13

### Patch Changes

- Updated dependencies [5d473ba]
  - @open-macaron/contracts@0.13.0

## 0.3.12

### Patch Changes

- Updated dependencies [96f4b99]
  - @open-macaron/contracts@0.12.0

## 0.3.11

### Patch Changes

- Updated dependencies [9e9b47f]
  - @open-macaron/contracts@0.11.0

## 0.3.10

### Patch Changes

- Updated dependencies [9ca6995]
  - @open-macaron/contracts@0.10.0

## 0.3.9

### Patch Changes

- Updated dependencies [a71ccab]
  - @open-macaron/contracts@0.9.0

## 0.3.8

### Patch Changes

- Updated dependencies [703d412]
  - @open-macaron/contracts@0.8.0

## 0.3.7

### Patch Changes

- Updated dependencies [acf0af5]
  - @open-macaron/contracts@0.7.0

## 0.3.6

### Patch Changes

- Updated dependencies [3a1032a]
  - @open-macaron/contracts@0.6.0

## 0.3.5

### Patch Changes

- Updated dependencies [fbd5b6e]
  - @open-macaron/contracts@0.5.0

## 0.3.4

### Patch Changes

- Updated dependencies [7dfb14e]
  - @open-macaron/contracts@0.4.0

## 0.3.3

### Patch Changes

- Updated dependencies [9ab8f08]
- Updated dependencies [b6b02bf]
- Updated dependencies [47abc60]
  - @open-macaron/contracts@0.3.0

## 0.3.2

### Patch Changes

- Updated dependencies [6b1ed0d]
  - @open-macaron/contracts@0.2.0

## 0.3.1

### Patch Changes

- Updated dependencies [92b7ca5]
- Updated dependencies [f238b34]
  - @open-macaron/contracts@0.1.0
