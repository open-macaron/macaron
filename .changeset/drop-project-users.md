---
"@open-macaron/contracts": minor
"@open-macaron/config-cli": patch
---

A project file no longer accepts a `users` list (deprecated and ignored since who may trigger the bot became an account of the web app): one with it is refused. open-macaron/config dropped its lists. config-cli no longer reserves `users` for the platform team: the schema refuses it outright.
