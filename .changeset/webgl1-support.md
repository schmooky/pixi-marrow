---
"pixi-marrow": minor
---

Skeletons draw on WebGL1, the context Pixi falls back to where a browser has no WebGL2. The batched mode, the mesh mode with `skinning: 'cpu'` and clip masks get a second program of GLSL 1.00, made from the same sources. WebGL2 and WebGPU compile the same programs as before. The warning `this renderer draws no skeleton` now shows on the Canvas renderer alone. A render of another renderer inside a render no longer changes which program the outer render uses.

`skinning: 'gpu'` and instancing still need WebGL2 or WebGPU. On WebGL1 they draw nothing, their clip masks included, and warn once. They upload nothing there and report 0 draw calls. A WebGL1 device without 32-bit indices warns once: a batch or a mesh of more than 65535 vertices draws nothing there.
