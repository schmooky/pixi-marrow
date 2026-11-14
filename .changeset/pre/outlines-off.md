---
'pixi-marrow': minor
---

Outlines are off by default. A load reads no page image any more unless it asks. Pass the file that `pixi-marrow outlines` writes at build time as `outlines`, or set `outlines: 'auto'` to read the page images in idle time after the load. That scan draws every page into a canvas, 32 MB for a page of 2048 by 2048 for a moment, which a phone with little memory can fail on. Without outlines every region stays a quad and every slot is drawn, so the picture is the same and only the cuts of overdraw are gone.
