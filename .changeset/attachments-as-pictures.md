---
"@open-macaron/agent-cli": patch
---

`finish` refuses an attachment that is linked, left bare or set inside a sentence, and names the `![caption](attachment:id)` line that shows it; once the agent can't fix it, the attachment is moved after the text as a picture. The prompt asks for it on a line of its own.
