---
"@open-macaron/contracts": minor
"@open-macaron/controller": minor
---

The controller can load its configuration from open-macaron/config's GitHub Pages snapshot (`CONFIG_URL`, `CONFIG_REPO_ID`) instead of `CONFIG_DIR`. It reloads when that repository's Pages deployment succeeds, applies a snapshot only if it is valid and the active LLM backend prices its models, and starts on the last applied snapshot (`config_snapshots`) when Pages is unavailable. contracts gains `PublishedConfig` and `parseConfigTree`'s shared validation.
