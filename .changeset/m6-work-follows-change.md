---
'pixi-marrow': minor
---

Work follows change. A skeleton at rest costs close to nothing: its update runs no timeline, poses no bone, places no vertex and uploads nothing. A skeleton that moves a little costs a little: only the bones whose inputs changed are posed, and only the slots that changed are placed, colored and uploaded.

A pose state carries what changed: `version`, `boneStamps`, `slotStamps` and `drawOrderStamp`, with `isNewer`, `nextVersion` and `touchPose` in `pixi-marrow/core`. Code that writes the arrays of a pose state itself now calls `touchPose(state)` or sets the stamps of what it wrote. The engines and the views skip their work otherwise.

The root import is smaller. The mesh mode, the clip code and the cuts of overdraw load when a skeleton needs them. The new load option `renderMode: 'mesh'` loads the mesh mode with the asset. An instance that asks for meshes before they are loaded draws in the batch until they arrive.

`await spine.perf.report()` has a row `motion`: how much of the skeleton moved in the last update and whether the view rested. `stats` has `skips`, `placedSlots` and `coloredSlots`, and the probe counts `skippedUpdates` and `placedSlots`.

Fixed: the mesh mode drew stale triangles on pixi.js before 8.20 after a skin change, or after two updates between two draws. Partial uploads are used from pixi.js 8.23 only: 8.20 to 8.22 lose all but the last one of a frame.
