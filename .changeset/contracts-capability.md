---
"@open-macaron/contracts": minor
---

Users of the web app: `Capability` (what an admin grants each user: triage, plan, implement, reproduce, verify, review, remember) and `requiredCapability` (what each run mode needs); the `/v1/me` and `/v1/admin` schemas (`Me`, `Invitation`, `UserAccount`, `UsagePage`…); `authUserFields`, the user fields better-auth adds, shared by the controller and the web app. `@open-macaron/contracts/capability` and `/auth` are safe to import in a browser.
