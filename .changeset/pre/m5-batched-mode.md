---
'pixi-marrow': minor
---

A batched render mode: skeletons of one render group share draw calls. 200 instances of a small rig draw in one call, where each took one or more before. The new option and property `renderMode` is `auto` by default, which batches every skeleton of up to 1024 vertices. `mesh` and `batched` force one side. `stats.renderMode` and a row of `await spine.perf.report()` name the mode in use and the reason.

In batched mode a draw order, visibility, attachment or color change rewrites data in place. Pixi does not rebuild the instructions of the render group for it.

Clipping no longer stops batching. In batched mode a clip is cut on the CPU, with the same triangles as the official runtime, bit for bit. The code for it loads with an asset that has a clipping attachment. Mesh mode keeps its stencil mask.

Less memory per instance. The static part of a layout is shared between the instances of an asset, and one shader serves all views of the same pages. A batched instance holds no Pixi mesh, geometry or buffer of its own.

The clip polygon of a region without weights or deform is triangulated once per attachment, not on every update.

Fixed: 1200 instances of a rig with a clip no longer fail on WebGPU with `ubo batch got too big`. They draw in one call.
