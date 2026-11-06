---
"@open-macaron/contracts": minor
"@open-macaron/controller": minor
"@open-macaron/web": minor
---

Each user has a monthly token cap for their runs on free models, which cost $0 and so never meet the dollar cap. It starts at 500M tokens for everyone (`DEFAULT_MONTHLY_TOKEN_CAP`, existing users included), and the key page shows it beside the dollar cap: tokens used this month, tokens reserved by runs in progress, and a field in millions of tokens that can be changed or cleared for no cap. A run on free models that could pass it is refused with the same words as for dollars: `this run may use up to 50M tokens, and your monthly token cap of 500M has 20M left: raise it on macaron (…), or wait for next month`. Each run records its token ceiling (`runs.token_limit`), reserved until it settles. `MyMonth` gains `monthlyTokenCap`, `tokensUsed` and `tokensReserved`; `PUT /v1/me/monthly-token-cap` sets the cap.
