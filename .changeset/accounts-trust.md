---
"@open-macaron/controller": minor
"@open-macaron/contracts": minor
---

Who may trigger the bot is an account of the web app, no longer open-macaron/config's `users` lists: a mention counts only from someone with an account (by their GitHub id) or a review bot the configuration lists. A run's mode needs the capability `requiredCapability` names, held by the account it runs for: explicit commands, retries and the bot's own escalations alike; a review bot's comments count for whoever asked for the thread's last run. Asking for something one's account can't is refused with a reply that names the capability. `MACARON_ALLOWED_USER_IDS` is gone (invitations do its job); a project's `users` list is deprecated and ignored.
