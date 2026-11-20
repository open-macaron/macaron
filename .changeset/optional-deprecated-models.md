---
"@open-macaron/contracts": patch
"@open-macaron/config-cli": patch
"@open-macaron/controller": patch
---

A configuration may leave out the deprecated per-mode `models`, global defaults included: they default to none. Until now, dropping `models.review` from open-macaron/config's `global.yaml` failed validation ("defaults.models: expected record").
