---
"@open-macaron/contracts": minor
"@open-macaron/controller": minor
"@open-macaron/config-cli": patch
---

The controller now owns the bot's forks, so onboarding a repository is just the open-macaron/config pull request. When a configuration goes live, and at every boot, the controller does four things for each repository:

- It forks the upstream under a random name, or adopts the bot's existing fork of that fork network.
- It switches off the fork's Actions, wiki, issues and projects.
- It records the fork by repository id in a new `forks` table.
- It comments on the config pull request with the fork's link, or with why there is none.

Requests on a repository are refused until its fork is ready. A repository file's `fork` key is now ignored, so a configuration can't point a repository at another of the bot's repositories. The comment needs `GH_ORG` to have Pull requests write on open-macaron/config.
