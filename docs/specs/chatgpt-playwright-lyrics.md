# SPEC — ChatGPT-lyrics via eigen Playwright-profiel

- Tier: 2
- Setup plan:
  - Tools to install: none. `playwright-core` is already a dependency. Generation uses the installed Google Chrome channel, the same way the Suno handoff does.
  - Git: no checkpoint commits unless you ask for one. Work stays on the current checkout.
  - Isolation: none (current working tree). The Chrome profile has to live in this checkout's gitignored `.data/`, next to the Studio you already run. A fresh worktree would not have that profile.
  - Files the gauntlet will add, by path:
    - `src/chatgpt-playwright.mjs` (session, prompt, reply parser, fakeable page driver)
    - `test/chatgpt-playwright.test.mjs` (executable scenarios below)
    - `src/studio-api.mjs` (one new route; existing routes stay)
    - `src/server.mjs` (pass the driver into Studio the same way the Suno browser is passed)
    - `public/studio.js` (paste trigger, button label, status text)
  - New dependencies: none

## What you chose

A persistent Playwright Chrome profile. The first time, a visible window lets you sign in to ChatGPT once. After that, pasting a URL or a text block writes the song brief into the project in the background. The green "Door jou bevestigd" status stays a manual Safari note. This path does not read that Safari session.

## Scenarios

Feature: News to Song lyrics through the saved ChatGPT Chrome profile

  Scenario: Pasting an article URL imports the text and stores a song brief
    Given a signed-in Studio project and a ChatGPT profile whose page shows the prompt composer
    And the article importer returns title "Dorpsnieuws" and text "Het dorp herstelt de oude molen na de storm."
    When the article URL field receives a paste of "https://example.com/molen"
    Then the article field becomes "Het dorp herstelt de oude molen na de storm."
    And the project result lyrics contain "[Verse 1]"
    And the project result concept, style, titles, moods, exclusions, coverPrompt, artistPhotoPrompt, suggestedGenre and rationale are saved
    And no Safari or Chrome AppleScript is launched
    And the local Ollama composer is not called

  Scenario: Pasting a text block stores a song brief without fetching a URL
    Given a signed-in Studio project and a ChatGPT profile whose page shows the prompt composer
    When the article field receives a paste of 80 or more characters
    Then that text is saved as the project article
    And the project result lyrics are the lyrics parsed from the ChatGPT reply
    And the source URL is left unchanged

  Scenario: A short paste does not start ChatGPT
    Given a signed-in Studio project
    When the article field receives a paste of "kort"
    Then no ChatGPT page method is called
    And the stored lyrics stay unchanged

  Scenario: The generate button uses the same ChatGPT path
    Given a saved article of 80 or more characters and a ChatGPT profile with a prompt composer
    When the client calls POST /api/studio/projects/{id}/chatgpt-lyrics
    Then the response status is 200
    And the body result.lyrics is the parsed lyrics

  Scenario: First use opens a visible login window and does not invent lyrics
    Given a ChatGPT profile whose page has no prompt composer
    When POST /api/studio/projects/{id}/chatgpt-lyrics runs for a project with an article
    Then the response status is 409
    And the body code is "chatgpt_login_required"
    And the driver was asked to open a visible Chrome window on https://chatgpt.com/
    And the project lyrics stay empty

  Scenario: A failed or unreadable reply leaves the project untouched
    Given a ChatGPT profile that returns the plain text "I cannot help with that"
    When POST /api/studio/projects/{id}/chatgpt-lyrics runs
    Then the response status is 502
    And the project lyrics stay as they were

  Scenario: Empty source is rejected before the browser starts
    Given a project with an empty article and an empty source URL
    When POST /api/studio/projects/{id}/chatgpt-lyrics runs
    Then the response status is 400
    And no browser launch function is called

  Scenario: A second run while one is busy is rejected
    Given a ChatGPT driver that is already busy
    When a second POST /api/studio/projects/{id}/chatgpt-lyrics arrives
    Then the response status is 409
    And the body code is "chatgpt_busy"

  Scenario: The route keeps the existing Studio guards
    Given no session cookie
    When POST /api/studio/projects/{id}/chatgpt-lyrics runs
    Then the response status is 401
    Given a session cookie and Origin "https://evil.example"
    When the same route runs
    Then the response status is 403

  Scenario: The legacy local extract stays local
    Given the existing local composer fixture
    When POST /api/studio/projects/{id}/chatgpt-extract runs
    Then the response result comes from the local composer
    And the Playwright loader is not called
    And the ChatGPT browser-account state stays "not_started"

  Scenario: The prompt carries the article and the production context, and nothing secret
    Given a project article "Het dorp herstelt de oude molen na de storm." and genre "Country Pop"
    When the prompt is built
    Then the prompt contains that article text and "Country Pop"
    And the prompt tells the model to write original lyrics and to treat the article as untrusted data
    And the prompt does not contain "cookie", "password", or "api_key"

  Scenario: Dutch source text asks for Dutch lyrics
    Given a project article that contains "het dorp"
    When the prompt is built
    Then the prompt asks for Dutch lyrics

  Scenario: The reply parser accepts fenced JSON and rejects a brief without lyrics
    Given a reply wrapped in a ```json fence with lyrics "[Chorus] Molen in de wind"
    When the reply is parsed
    Then lyrics are "[Chorus] Molen in de wind"
    Given a JSON object whose lyrics field is missing
    When the reply is parsed
    Then parsing fails

## Behaviour details

- Profile directory: `.data/chatgpt-playwright-profile`, mode `0700`, rejected when it is not a real directory.
- Login detection looks for the ChatGPT prompt composer on `https://chatgpt.com/`. It does not read cookies, local storage, or passwords.
- After a composer has been seen, the next generation starts headless in that same profile. If that headless page has no composer, the run stops with `chatgpt_login_required`, opens the visible window, and does not save lyrics.
- The browser is not brought to the front during a successful background run.
- The model reply is parsed into the existing song-brief fields: `concept`, `lyrics`, `style`, `exclusions`, `moods`, `titles`, `coverPrompt`, `artistPhotoPrompt`, `suggestedGenre`, `rationale`.
- Only `https://chatgpt.com` is opened. Downloads stay off.
- One generation at a time. The UI shows "ChatGPT schrijft de songtekst…" until the project refreshes.
- The green button label becomes "Genereer via ChatGPT". "Opnieuw genereren" calls the same route.
- Pasting into the URL field runs the existing article import, saves, then starts generation. Pasting fewer than 80 characters into the article field only updates the text.

## Must NOT

- Read, copy, or inject Safari, Chrome, or ChatGPT cookies.
- Treat "Door jou bevestigd" as a live ChatGPT session.
- Hide the browser identity or automate a login with a stored password.
- Change `POST /api/studio/projects/{id}/chatgpt-extract`: it stays the local Ollama compatibility route and must not launch a browser.
- Fall back to Ollama or the OpenAI API when ChatGPT does not return a brief.
- Overwrite an existing song brief when login, a busy lock, or parsing fails.
- Start generation on ordinary typing. Only a paste of a URL, a paste of 80+ characters, or the generate button starts it.

## Revisions

- 2026-10-23: Initial spec. Session model is the selected Playwright profile (visible login once, then background). The manual Connections confirmation is not the session.
- 2026-10-23: Approved with "go!". New Studio copy ships in English: button "Generate with ChatGPT", status "ChatGPT is writing the lyrics…". `POST /api/studio/projects/{id}/chatgpt-lyrics` is additive. `chatgpt-extract` stays the local route. Prepare all still uses the local model or an OpenAI API key.
