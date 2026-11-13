---
'pixi-marrow': minor
---

Performance presets and pacing: `perf: 'exact' | 'balanced' | 'fast'` sets several options at once, and each one is an option of its own too.

- `exact` is the default and changes nothing. `balanced` sets `tightMesh: 'on'`, `bake: 'auto'`, `idleCache: 'auto'` and `offscreen: 'throttle'`. `fast` adds `offscreen: 'pause'`, `updateRate: 30` for batched skeletons and `lod: 'auto'`.
- A `perf` object starts from its `preset` and changes the settings it names. An option given by name wins over both. A preset or a value that does not exist throws a `MarrowError` with the closest valid name.
- `offscreen: 'throttle'` updates a skeleton off the screen 4 times a second with the time that passed. `'pause'` stops its time until it is on the screen again. A skeleton is off the screen when its bounds lie outside the screen, or no render reached it for 2 updates and 0.1 seconds. `play`, `queue` and `stop` pose the gathered time first, so its events fire.
- `updateRate` poses a skeleton at most that many times a second, with the time of the updates in between.
- `lod: 'auto'` leaves physics out while a skeleton is drawn smaller than 96 pixels across, and resets physics when it grows to 120. It does not leave deform out.
- `perfSettings` holds the settings in effect, and `pacingStatus()` says how often the skeleton updates right now and why. The first two rows of `perf.report()` say the same.
- The physics controls of `MarrowSpine` moved to a new base class, `SpinePhysics`. Nothing changes for a game that calls them.
