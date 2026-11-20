---
"@open-macaron/contracts": minor
"@open-macaron/config-cli": minor
"@open-macaron/controller": patch
---

The configuration's per-mode `models` are gone (#209): each user picks the model that checks the knowledge rules, and open-macaron/config no longer uses them. A configuration that still sets `models` is now refused, like any unknown key.
