# Clear the Music DNA analysis queue

The In progress list can hold dozens of queued recordings. The worker finishes the current one, then keeps taking the rest in order. Clearing the queue lets one recording be analyzed on its own.

## Behavior

- A **Clear queue** button appears beside **Start analysis** when at least one recording is queued.
- The button asks for confirmation. Cancelling leaves the queue unchanged.
- Confirming deletes every job whose status is `queued`, including a running job whose lease has already expired.
- A running job with a live lease keeps going.
- Completed jobs, failed jobs, profiles, and saved analyses stay.
- The response is `{ cleared, running }`. A second clear returns `cleared: 0`.
- After a clear, Analyze on one recording queues only that recording.

## Must not

- Do not delete profiles or analysis versions.
- Do not cancel a job that is still inside its lease.
- Do not add a new job status.

## Route

`POST /api/music-dna/jobs/clear` with a JSON body. Same local session gate as the other Music DNA routes. Repeating the call is safe.
