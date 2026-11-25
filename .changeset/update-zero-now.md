---
'pixi-marrow': patch
---

`update(0)` poses and draws at once under every `updateRate` and `offscreen` mode, and leaves the phase of the rate as it is. Before, a rate below the display, as in the `fast` preset, left `update(0)` out. A skeleton that no update drew yet counts as on the screen wherever the box of its setup pose is. So the `pause` mode no longer holds it paused for good. The first render after its first drawn update reads the exact box.
