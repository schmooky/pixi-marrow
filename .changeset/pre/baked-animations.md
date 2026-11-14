---
'pixi-marrow': minor
---

Baked animations: an animation can play from frames sampled once, in place of the timelines and the constraints.

- `bake: 'auto'` of a display object bakes an animation the first time it plays alone on track 0. No preset sets it, because a clip keeps 23 KB to 0.9 MB per animation and skin. The clip is kept per asset and skin, and every instance shares it. A list of names bakes those only. A name the skeleton lacks throws a `MarrowError` with the valid names.
- An update plays baked when one entry plays alone on track 0 at alpha 1 and nothing wrote the pose since the update before. The skin, the place of the skeleton and the physics mode must be those of the clip. Any other update is posed by the engine as before. A skeleton whose skins turn on a physics constraint or a slider is never baked.
- Events, loops, time scales, reverse and the `start` and `end` options stay exactly as without baking: the engine still runs the tracks and fires the events.
- A clip keeps the world transforms of the bones that move and the slot values that change, as 32-bit numbers, at 60 frames per second. At a sample time a frame equals the pose of the engine rounded to 32 bits. Between two samples the frame before is shown. The local pose of a bone shows the values of the last update the engine posed.
- The code loads on demand and adds 0.1 kB to the root import. A display object plays without baking until it is there.
- The clips of a combined skin go when the skin is freed. `addBakedClips` throws a `MarrowError` for a clip whose arrays do not fit together, and reading the bytes of a file throws on a big-endian host.
- The new entry `pixi-marrow/bake` bakes in Node at build time: `bakeAnimation`, `bakeAnimations`, `encodeBakedClips` and `decodeBakedClips`. `addBakedClips` hands clips to an asset, whose instances play them in place of baking.
- The pose engines of `pixi-marrow/core` gain `solo`, `advance`, `holdsSetup` and `source`, and a track entry shows `animationStart` and `animationEnd`.
