# ChatGPT OAuth redirect must survive form-action

## Behavior

When a browser submits the Blossom OAuth consent form and Blossom answers 303 to `https://chatgpt.com/connector_platform_oauth_redirect`, the browser must be allowed to follow that redirect and ChatGPT's next hop to `https://platform.openai.com`.

The consent document and the 303 response advertise:

`form-action 'self' https://chatgpt.com https://platform.openai.com`

When one consent POST contains both `decision=approve` and `decision=deny`, Blossom treats it as approval. A denial is only the POST whose decision values are exactly `deny`.

## Does not change

- Studio and other responses keep `form-action 'self'`.
- Deny still returns `error=access_denied` to the registered ChatGPT redirect.
- Tokens, codes, and passwords stay out of diagnostics.

## Setup

No new dependencies. Edit `src/mcp-oauth.mjs` and `test/mcp-oauth.test.mjs` on the current branch. Restart the local server on port 8787 after the change so the Cloudflare tunnel serves it.
