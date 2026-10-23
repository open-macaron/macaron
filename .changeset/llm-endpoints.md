---
"@open-macaron/controller": minor
"@open-macaron/contracts": minor
"@open-macaron/web": minor
---

Approved LLM endpoints: the APIs users may send their own key to. Administrators approve them from the web app (Administration → Endpoints: a name, an https base URL whose host resolves to public addresses, an optional pricing note), then disable or enable them; a base URL never changes, and every change is recorded in `admin_audit`. `LLM_ENDPOINT_DEFAULTS` (a JSON list in the settings) approves the deployment's defaults at start, adding those missing and never updating one.
