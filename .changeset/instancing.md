---
'pixi-marrow': minor
---

Instanced draws: with `skinning: 'gpu'`, the skeletons of the mesh mode that follow each other in Pixi's render order and share a layout draw as one instanced draw.

- The new option `instancing: 'auto' | 'off'`, also a setting of `perf`, is `off` in every preset and is set by name. It acts on a skeleton in the mesh mode with `skinning: 'gpu'` and leaves every other one as it is. It pays for many copies of one rig next to each other, and not for a grid of different skeletons. The picture is the same to the bit as with `off`.
- A run of instances ends where Pixi draws anything else. Inside a run, instances with another layout, draw order, pages or blend mode start another draw, and Pixi builds no instructions again for that.
- The instances of a layout keep their bones, their slot colors and the vertices the CPU places in data textures they share. A frame uploads each of them once, the stretch that changed from pixi.js 8.23 on. A slot shows one of its attachments, so the vertex shader drops the vertices of the others.
- A skeleton draws alone while a clipping attachment cuts a visible slot, and while a container attached to a slot is drawn. It always draws alone when a slot multiplies or screens or the atlas has more than 8 pages.
- `perf.report()` has a row `instancing`: whether the instance draws instanced, in a run of how many and in how many draw calls, or why not. `perf.memory()` counts the slot of an instance in its bytes and the rest of the shared textures as shared.
- The code is in the chunk of the mesh mode, which loads on demand. Nothing registers with Pixi at import: the pipe goes into a renderer when it first draws an instanced skeleton.
