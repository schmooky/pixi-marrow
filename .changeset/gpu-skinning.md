---
'pixi-marrow': minor
---

GPU skinning: `skinning: 'gpu'` places the vertices of the mesh mode in the vertex shader, from the bone matrices of the pose.

- A moving skeleton uploads its bone matrices, 24 bytes a bone, in place of the positions of its vertices. Regions, region polygons and meshes are placed on the GPU, weighted meshes with any number of bones a vertex included.
- The CPU still places a mesh while it has a deform, and a region with a sequence. Both draw in the same draw call as the rest.
- The colors of the slots live in a palette texture, so a color key writes the 8 bytes of one slot and not the colors of its vertices. Additive slots, multiply, screen and the two color tint draw as before.
- `auto`, the default, stays `cpu` until phones are measured. The batched mode always places vertices on the CPU.
- Code that reads the positions on the CPU, such as the bounds and the debug overlays, gets them placed on demand. A layout with opaque rectangles for the cut of covered slots places every vertex on the CPU for that search, and uploads only what the CPU is in charge of.
- The code loads with the mesh mode, on demand. The root import does not grow.
