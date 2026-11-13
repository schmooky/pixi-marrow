---
'pixi-marrow': minor
---

Solve physics constraints (Spine 4.2 and 4.3) and sliders (4.3), with the same pose as the official runtime, bit for bit. Every constraint of the three versions is solved now. The load option `constraints` and the option of `createPoseEngine` are gone: there is nothing left to ignore.

Physics control on the display object: `physics` (`update`, `pose`, `reset`, `none`), `resetPhysics()`, `physicsTranslate(x, y)` and `physicsRotate(x, y, degrees)`. On a pose engine: `physics`, `physicsTranslate`, `physicsRotate`, and in its state `yDown`, `windX`, `windY`, `gravityX` and `gravityY`.

More play options: `additive`, `start`, `end`, `shortestRotation`, `eventThreshold`, and `entry` for any other field of the official track entry by its official name. `Track` has `configure(fields)` and `additive`. Options are checked before anything plays.

`await spine.perf.report()` lists what the runtime decided for an instance and why. `await spine.perf.memory()` gives the bytes shared per asset, per instance and on the GPU. Both load their code at the first call.

The new entry `pixi-marrow/perf` has `createProbe(spine)`: it times the pose, geometry and event work of every update and counts what the renderer did.
