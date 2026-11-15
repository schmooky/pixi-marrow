---
'pixi-marrow': patch
---

Fixes of the render path and the idle cache, found in an audit.

- On WebGPU the uniform buffers that meshes of the mesh mode bind past the 256 slots kept for the scene are static now. Pixi uploads one only when its transform, tint or rounding changed, where it was written and uploaded at every draw. A private field of Pixi that this code reads and that is missing is told once in the console, with the version of pixi.js.
- A renderer of WebGL1 throws a `MarrowError` in every render that draws a skeleton. Every shader is GLSL 3.00, and Pixi falls back to WebGL1 where a browser has no WebGL2.
- `instancing: 'auto'` draws a layout alone whose attachments have more than twice the vertices the setup pose shows, as speedy-ess with 108 against 44. The perf report says so with both counts. The new value `instancing: 'on'` draws such a layout instanced anyway.
- The stats of an instance that draws instanced count no uploads of their own. The pool of its layout counts its uploads, and the row `uploads` of the perf report gives that count.
- The views of a layout with `skinning: 'gpu'` share one GPU buffer of skin data, where each made a copy. The shared bytes of `perf.memory()` count it once.
- Instanced draws let go of layouts, pools and shaders they no longer draw with. The pools of a layout go once no instance holds a slot, so a burst of instances leaves no large textures.
- The idle cache drops an image when a page texture updates or takes another source. It keeps a skeleton live under a filter or a mask, and holds at most 64 MB of images in all. It no longer keeps the last captured skeleton alive.
