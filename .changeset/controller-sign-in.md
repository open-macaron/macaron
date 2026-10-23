---
"@open-macaron/controller": minor
---

Sign-in for the web app: better-auth with the org GitHub App, by invitation only (or the operator's `MACARON_ADMIN_USER_IDS`). GitHub's OAuth tokens are never stored and no IP address is kept. New routes for the web app only: `/v1/me` (profile, capabilities, usage history) and `/v1/admin` (invitations, users' capabilities, audited). Runs record the GitHub id of who asked for them. Sign-in stays off until `BETTER_AUTH_SECRET`, `GITHUB_LOGIN_CLIENT_ID`, `GITHUB_LOGIN_CLIENT_SECRET` and `MACARON_ADMIN_USER_IDS` are set.
