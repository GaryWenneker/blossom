# Stop the running studio operation and start the next one

Status: waiting for approval. Do not implement until this file is explicitly approved.

Tier: 2. Isolation: the current checkout, because the running Studio server loads this tree. No new dependencies. No commit unless asked.

## Request

When a studio operation is still running, a new paste or Studio click asks: "Stop the current studio operation and start this one?" Yes stops the running operation and starts the new one. No leaves the running operation alone.

The question is left-aligned in the Studio panel. Its text and buttons stay on the left. There is no centered caption and no browser confirm dialog.

## Scenarios

1. Nothing is running. A Studio click or URL paste does not ask, and behaves as it does today.
2. An operation is running. The next Studio click or URL paste shows the left-aligned question and does not start until the answer.
3. The user chooses No. The running operation continues. The new action does not start. The toast "Current studio operation is still running" is not shown. The question goes away.
4. The user chooses Yes. Blossom stops the operation it started, then runs the action that was clicked. A result that arrives from the stopped operation is not saved.
5. Cancelling ChatGPT lyrics kills that osascript, rejects with operation_cancelled, clears the lyrics busy flag, and lets a second lyrics run start. The first run cannot clear the second run's busy flag and cannot save its brief.
6. Cancelling ChatGPT image generation does the same for the image osascript: no PNG is written after cancel, and a second image run can start.
7. Cancelling a busy Suno browser handoff closes that handoff so another Suno browser operation can start.
8. POST /api/studio/operations/cancel while nothing Blossom-started is running returns 200 and {"stopped":[]}.
9. A Suno Platform API job that Suno has already accepted is not described as cancelled. This control stops local Blossom work only.
10. The question block uses text-align:left. Yes and No are inline at the start of the line. The question is not a window.confirm and not a centered dialog.

## Must not

- Do not delete the project, the artist, or lyrics and images that were already saved.
- Do not start the new action when the answer is No.
- Do not persist a brief or image produced after cancel.
- Do not leave a busy flag set so the next start stays blocked.
- Do not expose this route outside the existing local Studio API session.
- Do not center the question text or its buttons.

## Approach

Show the question as a left-aligned row in the Studio panel: the sentence, then Yes and No. Track the in-flight Studio call with an AbortController. On Yes, abort that call, POST /api/studio/operations/cancel, wait until the old call releases the UI lock, then run the new action. Suppress the abort error so it does not look like a failure.

The cancel route stops whichever of lyrics, images, and the Suno browser handoff is busy. Each runner receives an AbortSignal and the returned child process is killed. A run id makes a cancelled run's cleanup ignore a newer run.

## Tests

- test/studio-replace-operation.test.mjs for the confirm, No, and Yes ordering, and for left alignment of the question.
- Existing ChatGPT lyrics and image tests gain a cancel case: the child is killed or the signal aborts, busy can be taken again, and no result is saved.
- A Suno browser cancel case when that handoff is busy.

## Out of scope

Music DNA analysis queue, Draw Things, and remote Suno Platform jobs already accepted by Suno.

## Revision

2026-10-24: Replaced the window.confirm approach. The question is left-aligned in the panel because centered question text is out.
