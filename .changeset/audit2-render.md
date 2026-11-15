---
'pixi-marrow': patch
---

The render path sends fewer bytes, and the stats count what a parent costs. These changes come from the second audit.

- A batch keeps 256 stretches per buffer, not 32. When more skeletons change, it uploads one stretch around all of them, not the whole buffer.
- A slot that changes only its color writes only its own vertices to the batch. Before, the batch uploaded the static data of the whole skeleton.
- A region whose slot changes only its color keeps its vertices. Before, the view placed them again and uploaded their positions.
- `stats.transformReplaces` counts the frames of the batched mode that placed each vertex again because a display object above the skeleton moved.
- `stats.tintRewrites` counts the frames that wrote the static data again because the tint or the alpha above the skeleton changed.
- `stats.instructionBuilds` counts how often Pixi built the instructions of the render group with the skeleton in a batch.
- `stats.uploadBytes` holds the bytes that the view sent to the GPU, as `positions`, `statics`, `indices`, `bones` and `masks`.
- `stats.frameBytes` holds the bytes of all kinds since the last update of the view began. It is 0 after a frame in which nothing moved.
- A skeleton in a batch that shows no slot stays in its batch and draws triangles without area. Before, Pixi built the instructions of the render group again each time the skeleton became empty or visible.
- The room of a batch for cut triangles grows by a factor of two when a pose needs more. A loop with a clip builds the instructions fewer times.
- A skeleton with a clip that rests below a display object that moves keeps its cut triangles. The batch places them again and cuts nothing.
- With `skinning: 'gpu'` and outlines, the CPU places the vertices only for a search for covered slots, one time in 4 to 64 updates. While a slot is covered, the CPU still follows each pose.
- With `skinning: 'gpu'` and no instancing, the textures of bones and colors upload one time per frame, before Pixi draws the view. A hidden view uploads nothing.
- On WebGPU the mesh mode finds the uniform buffer of Pixi one time per renderer, not for each mesh in each frame.
- A renderer that is not WebGL2 and not WebGPU, such as the Canvas renderer of Pixi, draws no skeleton. `console.warn` says so one time, and the view counts no draw call.
