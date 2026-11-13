---
'pixi-marrow': minor
---

Solve IK, transform and path constraints for Spine 4.1, 4.2 and 4.3, with the same pose as the official runtime, bit for bit. `constraints: 'ignore'` now skips physics and slider constraints only, and only those throw without it.

Clipping attachments clip, through a stencil mask. A skeleton without a clip pays nothing for it.

Cut overdraw. After a load the page images are read in idle time (`asset.optimized` resolves when that is done). A region without a visible pixel is then not drawn, and a slot behind the opaque part of a later slot is skipped, with the same picture. The new option `tightMesh: 'on'` also draws regions as polygons around their visible pixels. The new command `pixi-marrow outlines <atlas>` writes the outlines at build time, for the new load option `outlines`.

`stats` has new counters: `clips`, `maskDraws`, `maskUploads`, `maskRebuilds`, `tightRanges` and `coveredSlots`. `clippingIgnored` is gone.
