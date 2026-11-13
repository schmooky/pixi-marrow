---
'pixi-marrow': minor
---

`lod: 'auto'` now leaves deform out too, below the same 96 pixels as physics. Every mesh of a skeleton drawn that small shows its setup vertices, and the deform timelines do not run. Both come back at 120 pixels.

- The pose engines have a new switch, `engine.deform`. Set to false, it clears every deform at once. Set back to true, the next update applies the deform timelines again, also for a pose at rest.
- Baked playback writes no deform while the switch is off.
- `PacingStatus.physicsOff` is now `reduced`, because it covers deform as well. The `pacing` row of `perf.report()` says that physics and deform are left out.
