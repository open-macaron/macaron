---
"@open-macaron/contracts": minor
"@open-macaron/knowledge-cli": patch
"@open-macaron/controller": patch
---

`parseConfigTree`, `readConfigFiles` and `loadConfigTree` move to contracts, so config-cli validates open-macaron/config with the controller's own checks. knowledge-cli's owner-approved merge now comes from the shared `@open-macaron/owners` package, with the same behavior and the same status comments. New: `@open-macaron/config-cli` (validate, build the Pages snapshot, owner-approved merges that leave changes to trust and spending settings to the platform team).
