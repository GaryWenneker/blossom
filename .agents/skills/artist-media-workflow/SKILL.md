---
name: artist-media-workflow
description: "Generate and manage responsive artist-owned wide banners in Blossom"
alwaysApply: false
priority: 88
scope: project
group: music
enabled: true
status: approved
triggers: ["generate artist photo","artist images","artist banner","background artist","wide artist cover"]
tags: ["artist","image","design","media"]
---

# artist-media-workflow

## Procedure

1. Identify or create the artist in Blossom, including name, genre, musical DNA and identity. Distinguish fictional artist identity from any real musician reference.
2. On Artists, generate a photo directly from the artist identity; optional editorial lighting/staging prompt may be provided. In News to Song, first select an artist before generating an artist-photo.
3. Use a wide 16:9 editorial/panoramic composition with facial subjects clear and negative space at lower left. Request no text or logos in the generated image.
4. Record the image in the artist's independent media library. Maintain links to a source Studio asset when originating from a song project; ensure new variants do not replace an already selected image without selection.
5. Render the selected artist image as the responsive full-width hero background. Overlay artist name in large, accessible CSS typography and genre lower left; use gradients for legibility.
6. Allow alternate artist images to be chosen or removed from the artist gallery. Preserve source Studio asset and handle legacy migrations idempotently.
7. Keep album covers 1:1 and never move cover artwork to the artist library automatically. Never add fake verification badges or listener numbers.
8. Test the artist ID boundary, API auth, generated photo linkage, image persistence after project removal, responsive layout and safe fallback when no image exists.
