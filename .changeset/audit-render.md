---
'pixi-marrow': patch
---

Fixes of the render path and the idle cache, found in an audit.

- On WebGPU the uniform buffers that meshes of the mesh mode bind past the 256 places kept for the scene are static now. Pixi uploads one only when its transform, tint or rounding changed. Before, each draw wrote and uploaded it. When a private field of Pixi that this code reads is missing, the runtime reports it once in the console, with the version of pixi.js.
- On a renderer of WebGL1 no skeleton draws, and `console.warn` says so once. Every shader is GLSL 3.00, and Pixi uses WebGL1 where a browser has no WebGL2. The rest of the app goes on.
- `instancing: 'auto'` does not draw a layout instanced when its attachments have more than twice the vertices a pose shows. A pose shows the setup attachments, and the largest attachment of a slot that is empty in the setup pose. One such layout is speedy-ess, with 108 against 44. The perf report says so with both counts. The new value `instancing: 'on'` draws such a layout instanced anyway.
- The stats of an instance that draws instanced count no uploads of their own. The pool of its layout counts its uploads, and the row `uploads` of the perf report gives that count.
- The views of a layout with `skinning: 'gpu'` share one GPU buffer of skin data. Before, each view made a copy. The shared bytes of `perf.memory()` count it once.
- Instanced draws free the layouts, pools and shaders that they no longer draw with. The runtime frees the pools of a layout once no instance holds a place in them. So a burst of instances leaves no large textures.
- The idle cache drops an image when a page texture updates or takes another source. It keeps a skeleton live under a filter or a mask, and holds at most 64 MB of images in all. It no longer keeps the last captured skeleton alive.
