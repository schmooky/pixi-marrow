---
'pixi-marrow': patch
---

The mesh mode draws more than about 2000 meshes in a frame on WebGPU. Pixi gives every mesh draw a slot of one uniform buffer per frame and threw once it was full, so 1200 instances of a rig with a clip failed. A mesh of pixi-marrow now takes a slot while the buffer has room for the rest of the scene, and binds a small uniform buffer of its own after that. That buffer is uploaded only when its transform, tint or rounding change. Other meshes are drawn by Pixi as before, and WebGL is unchanged.
