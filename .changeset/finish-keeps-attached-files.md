---
"@open-macaron/agent-cli": patch
---

`macaron-agent finish` keeps the file `attach` copied when result.json lists the same attachment again (only its caption is taken), and refuses an attachment whose file isn't in the output, which the Gate would refuse after the run.
