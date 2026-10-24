# Suno style packing

Suno keeps about the first 1000 characters of the style field. Blossom used to join genre, artist DNA, additional styles, the generated style paragraph, Music DNA, and creative instructions in that order and then cut the tail. Music DNA and the operator's closing instructions were past character 1000.

## Behavior

- When the joined style is already within 1000 characters, the text stays in the previous order.
- When it is longer, the 1000 characters are filled in this order: genre and additional styles, the last three creative-instruction clauses, one short brief per Music DNA reference, the rest of the creative instructions, then artist DNA and the generated style with whatever room remains.
- Each Music DNA brief keeps the influence weight, the main genre, up to three instruments, one mood, BPM, and production. Long vocal-delivery essays are left out.
- Lyrics, the instrumental flag, and exclude styles are unchanged.
- Both the Safari handoff and the official Suno API send this packed style. The API still refuses fields it does not document.

## Must not

- Do not drop a later source just because an earlier paragraph is long.
- Do not send weirdness, style influence, or variety to the official API.
- Do not upload reference recordings or copy lyrics from them.
