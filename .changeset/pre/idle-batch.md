---
'pixi-marrow': patch
---

The idle cache draws its images in the batches of the batched mode, not as Pixi sprites. An image now shares a batch with the skeletons around it, so a grid where symbols at rest and in play take turns no longer breaks the batch at every image. In the reels of the site a frame of a win took 10 to 14 draw calls with the idle cache on, and now takes 3 or 4, as without it.
