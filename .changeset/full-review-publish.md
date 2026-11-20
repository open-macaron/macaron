---
"@open-macaron/contracts": minor
"@open-macaron/controller": minor
"@open-macaron/review": minor
"@open-macaron/agent-cli": patch
---

A `full_review` run gets its context, its Gate and its single GitHub review (#189, part of #186), still unreachable until #190. Its context carries the pull request and its rules, as a review's, plus the lessons, as a verify's; the rules are checked on the repository's review model (`review.model`, from `models.review`), which the run's key allows. The Gate verifies its verdicts like a review's and checks its answer like a reply. It is published as one review: the verify answer and its screenshots first, then the rule checks, the rules' model in the footer. Over GitHub's size limit, the table keeps its violations and warnings only (`attentionOnly` in `renderMarkdown`), and as a last resort the answer is cut.
