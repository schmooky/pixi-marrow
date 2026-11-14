---
'pixi-marrow': minor
---

Debug overlays: the new entry `pixi-marrow/debug` and its `MarrowDebug` draw over a skeleton.

- Layers: bones, origin, regions, mesh hulls, mesh triangles, bounding boxes, clipping, paths, point attachments, event names and overdraw. Each can be turned on and off at run time, with its own color.
- The shapes equal what the official runtime computes. The overlay draws again only when the pose or a setting changed, and lines keep their width on the screen.
- The overdraw layer fills every triangle the skeleton draws, after the cuts of overdraw, with a color that adds up where the GPU paints a pixel more than once.
- The overlays draw with pixi-silk, now an optional peer dependency. A game that does not import `pixi-marrow/debug` needs neither it nor the overlay code.
