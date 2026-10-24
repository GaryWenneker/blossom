# Studio: ChatGPT generation and return path

The Studio Generate button and article-paste flow call `POST /api/studio/projects/:id/chatgpt-lyrics`. On macOS this uses the normal signed-in Safari session, submits an original-song instruction in a fresh ChatGPT tab, waits for a new completed response, parses the structured JSON, and writes it to the original Studio project. This route does not require ChatGPT to choose the Blossom MCP app. The separately connected MCP route remains available and writes through the same Studio store.

## What was broken

The former AppleScript embedded JavaScript selectors inside strings with conflicting quotes. JavaScript exceptions were swallowed as waiting/login states. It also reused any open ChatGPT conversation and could read its previous assistant response before the new response existed. The prompt chose Dutch from the article even when the project requested English. Prepare all used a different local/API route, while image generation always used Draw Things. Suno recipes omitted generated exclusions.

## Current behavior

- Pass tested JavaScript as AppleScript arguments. Use a fresh tab and baseline the assistant message count before submission. Ignore earlier messages and streaming output; require a stable completed response.
- Use explicit lyric language first, then selected artist language, then source language. Include the current Suno controls, creative instructions, artist context and selected Music DNA in generation context.
- Accept an optional `generationParameters` object alongside the ten creative brief fields. Validate its known keys, numeric ranges, booleans and duration preset before updating the brief and controls together. Older ten-field briefs remain accepted. Lyrics and all original project source data remain preserved if generation or validation fails.
- Generated cover/photo prompts populate the editable prompt fields; edits stay independent of lyric edits. The Suno recipe combines selected and generated exclusions, honors instrumental mode and preserves model, vocal, duration and other saved controls. Untitled projects use the first generated title in the recipe and linked track.
- Both image buttons call ChatGPT in signed-in Safari. Read the newly generated rendered image through a canvas, validate the exported PNG header and dimensions, save it with a random filename and register the asset to the project. No Draw Things fallback, API key, cookies, credentials or private provider endpoints are used by this route.
- Prepare all uses ChatGPT for the brief, cover and artist photo in sequence. Each completed stage persists independently, so a later image failure does not discard the song brief or an earlier image.

## Requirements and limits

Run the updated Blossom service on macOS. Sign in to ChatGPT in Safari and allow JavaScript from Apple Events in Safari's Developer settings, plus macOS Automation permission for the Blossom process. ChatGPT image generation availability and usage limits belong to the account. Website UI changes may require selector updates. An image that the browser cannot export because of cross-origin restrictions yields an explicit error, never a fake linked asset; it can still be downloaded from ChatGPT. This implementation does not bypass those browser protections.

Suno is still an authorized manual handoff: the recipe is preparation data, not a generated song or an API request. The selected model should match the model available in the user's actual Suno interface; this change preserves that value rather than inventing model variants. Controls unavailable in that interface cannot be guaranteed by the blueprint. Target duration remains editorial, not a guaranteed output length.

## Validation

`test/studio-chatgpt-roundtrip.test.mjs` executes the actual generated DOM JavaScript against a fake page, rejects stale/streaming replies, checks explicit language, exercises parameter parsing and atomic persistence, checks image validation/error behavior, and runs authenticated HTTP calls through brief generation, both image kinds, asset registration and the Suno recipe. Existing tests cover auth, CSRF, MCP, article import and generation errors. Real signed-in Safari, ChatGPT image generation and Suno account controls must be verified on the user's Mac; Linux unit tests do not establish those external results.

## Asset choices and provenance

Studio image generation now records provider `chatgpt`, the exact visual prompt, and a fingerprint of the song/article context. The request includes the current concept, lyrics, genre and artist context rather than only an old imported news headline. Legacy assets retain unknown provenance; the migration never labels old images as ChatGPT output. The footer identifies ChatGPT instead of the former Draw Things status.

Each saved image is a candidate. Use **Use as cover** or **Use as artist photo** in the project library to select one per role. Uploaded audio has **Use audio**. New generations never replace an explicit choice. Preview panels and the recipe's `selectedAssets` use only selected assets. Context labels distinguish the current brief, an earlier brief and unrecorded legacy context; these labels establish provenance, not a claim of visual quality or semantic analysis. Selection changes preserve unsaved text fields.

**Remove** hides the asset from its project, clears its selection and disables its content URL. Original files and metadata remain recoverable; no other project is affected. POST routes require the normal authenticated/CSRF-protected session and verify that the asset belongs to the project before changes.

The current UI checks `studioVersion: chatgpt-assets-v2` before image generation and asset changes. If the backend is older, it asks for restart/reload instead of sending an image request that an old backend could route to Draw Things. A versioned Studio module import makes the changed frontend dependency explicit on reload. A screenshot still showing the DRAW THINGS panel is an older loaded frontend, not evidence that the current ChatGPT-only route completed.
