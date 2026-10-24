# Artist create dialog and per-photo focus

Tier 2. Spec approval: obtained (user: "approved.").

Isolation: this working tree. Uncommitted artist-banner CSS already lives here, and a fresh worktree would drop it. No checkpoint commits unless asked. No new dependencies.

API scope: internal Studio admin (existing session cookie). Existing artist-image surface. Additive response fields only.

## Create artist

The Artists page no longer shows the create form above the roster.

- The page shows one button, `Create artist`, in that spot.
- Activating it opens a dialog with the same fields as today: name, primary genre, language (default `en`), target countries, voice, artist DNA, and a `Create artist` submit button.
- Submit still creates the artist through the existing create request, closes the dialog, and the new artist appears in the roster.
- Close, Escape, and the backdrop dismiss the dialog and create nothing.
- Validation messages stay the same as the current form.

## Photo focus

Each artist photo stores its own focus. The banner crop uses that point. The face in a portrait is no longer forced through one shared `object-position: center 35%`.

- New and existing photos start at `focusX = 50`, `focusY = 35`. That matches the current banner crop until someone saves a different point.
- `focusX` and `focusY` are integers from 0 through 100. `0` is the left or top edge of the photo. `100` is the right or bottom edge.
- The hero, the Studio artist-photo preview, and each 16:9 gallery thumb use `object-position: {focusX}% {focusY}%` for that photo.
- Each gallery photo has a `Set focus` button. It opens a dialog showing that photo in the same wide crop as the hero (`object-fit: cover`).
- Dragging the photo pans the crop. Releasing the pointer does not save. `Save focus` stores the point and the open banners update. `Cancel`, Escape, and the backdrop close the dialog and leave the stored point unchanged.
- A second save with the same values leaves the stored point unchanged.
- `POST /api/studio/artists/{artistId}/images/{imageId}/focus` with `{ "focusX": 20, "focusY": 15 }` returns that artist's photo list, and the updated photo has `focusX: 20` and `focusY: 15`.
- The selected-banner payload for that artist also includes `focusX` and `focusY`.
- Unknown photo, or a photo that belongs to another artist: `404` and the stored points stay unchanged.
- `focusX` or `focusY` missing, not an integer, or outside 0–100: `400` and the stored points stay unchanged.
- Drag math, given a container, the photo's natural size, the current focus, and a pointer delta in pixels, returns the new clamped percents. Concrete case: container 1600×900, photo 800×1200, focus 50/35, drag down 100px. The result is `focusX` 50 and `focusY` 28. A drag that would pass 0 or 100 clamps to that edge.

## Does not change

- Choosing, generating, or removing a photo does not change another photo's focus.
- Removing a photo still leaves the Studio project file in place.
- Album covers stay square and have no focus point.
- Names, genre, and DNA stay CSS text. They are not drawn into the photo.
- Public MCP and OAuth routes are unchanged.
- No new package.
