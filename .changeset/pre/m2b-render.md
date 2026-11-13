---
'pixi-marrow': minor
---

Draw skeletons in PixiJS v8. `MarrowSpine` from `pixi-marrow` loads a skeleton and its atlas, plays animations with `play`, `queue` and `stop`, and draws in one draw call for most skeletons, on WebGL2 and WebGPU. Additive slots share the draw call. Showing, hiding and reordering slots rewrites the index buffer only. Constraints and clipping are not solved yet.
