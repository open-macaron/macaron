---
"@open-macaron/agent-cli": patch
---

`finish` collects the working tree's changes only in modes that can commit (#200). A `verify`, `reproduce` or `full_review` no longer fails when a build, or the repository's own Claude Code hooks (a formatter), leaves files changed: those changes can't be published, so they are logged and dropped instead of getting the run's answer refused.
