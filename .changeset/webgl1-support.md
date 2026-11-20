---
"pixi-marrow": minor
---

Skeletons draw on WebGL1, the context Pixi falls back to where a browser has no WebGL2. The batched mode, the mesh mode with `skinning: 'cpu'` and clip masks get a second program of GLSL 1.00, made from the same sources. WebGL2 and WebGPU compile the same programs as before. `skinning: 'gpu'` and instancing still need WebGL2 or WebGPU: on WebGL1 they draw nothing and warn once. The warning `this renderer draws no skeleton` now shows on the Canvas renderer alone.
