---
"@open-macaron/contracts": minor
"@open-macaron/controller": minor
---

Compact mode, on by default: a request gets 👀 and then a single answer, with its loop, mode, runner, run and the thread's spending in a `<sub>` footer, instead of a status comment as soon as the run starts. Set `compact: false` in a project or repository of open-macaron/config to keep the status comment. Failures are posted in both modes, now including a run that couldn't be started, which is no longer retried automatically. A review's footer names its loop and runner.
