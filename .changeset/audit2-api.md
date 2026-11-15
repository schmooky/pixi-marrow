---
'pixi-marrow': patch
---

Fixes from the second audit, in the display object, the pacing and the baked clips.

Breaking changes:

- `Track.finished` resolves with a reason: `'complete'`, `'interrupted'`, `'stopped'` or `'destroyed'`. It resolved with nothing before. It still never rejects.
- After `destroy()` a display object throws a `MarrowError` with the code `destroyed`. `play`, `queue`, `stop`, `setMix`, `bone`, `slot`, `skin`, `skins`, `setupPose`, `follow`, `attach` and `autoUpdate = true` throw. `update`, `destroy`, `unfollow` and `detach` do nothing.
- `new MarrowSpine`, `MarrowSpine.load` and `MarrowSpine.from` throw for a key that is no option, with the closest option. `scale`, `darkTint` and `boundsProvider` get a message that says what to use here. A wrong `occlusion` or `autoUpdate` value throws, and so does an unknown key of a `perf` object.
- `MarrowErrorCode` has five more codes: `invalid-option`, `not-found`, `not-registered`, `not-loaded` and `destroyed`. A wrong option, setter value or argument now has the code `invalid-option`. It had `invalid-data`, and an unknown key of the play options had `unknown-name`. A destroyed asset passed to `new MarrowSpine` has the code `destroyed`.
- `on`, `once` and `off` of a `MarrowSpine` are typed from `MarrowSpineEvents` and the Pixi container events. A wrong event name does not compile. For an event of your own, call `on` of the object as a Pixi `Container`.
- `offscreen: 'pause'` keeps the time of a hidden skeleton moving. Its tracks, its events and `Track.finished` go on, and nothing is posed or drawn. The time stood still before, so `await hero.play('win').finished` could wait for ever.
- An update from the ticker does not pose or draw a display object that Pixi does not draw. That is an object without a parent, or with `visible` or `renderable` false or an alpha of 0, on itself or on a parent. Its tracks, events and `Track.finished` go on. The render that shows it again poses it first. An `update` that you call yourself always poses.
- `timeScale`, `defaultMix` and the seconds of `setMix` throw for a value that is no finite number.
- `update(seconds)` throws for seconds that are no finite number. `update(Infinity)` never returned on a skeleton with physics.
- The messages of some errors changed, such as `speed got NaN.` for a wrong option value.

Fixes and additions:

- `updateRate` holds its rate. Rate 30 on a 60 Hz display gave 20 to 23 poses a second, because the time over a step was dropped. A step is now due in the frame nearest to it, and the rhythm is even on displays of 60, 90, 120 and 144 Hz.
- An update of more than 10 seconds starts the physics again, as `resetPhysics` does. An hour of physics in one update took 20 to 130 milliseconds.
- The `ticker` option names the ticker that updates the object. Pass `app.ticker` so that its `speed`, `maxFPS` and `stop()` reach the skeleton. The default stays `Ticker.shared`. `hero.ticker` reads it.
- Clips that a game bakes while it plays hold at most 4 MB per skeleton. The clip that played longest ago goes first, and a clip in use never goes. `setBakeBudget` of `pixi-marrow/bake` sets the limit. `perf.memory()` reports `baked` and `bakeBudget`.
- The idle cache draws at most 4 images per frame over all display objects. 200 symbols that came to rest together made 200 render passes in one frame.
- A display object warns once when an option has no effect: `instancing` without `skinning: 'gpu'`, and `skinning: 'gpu'` or `instancing` on a batched skeleton. The warning for options that need outlines has the same form now.
- `follow` warns once for a container that is no child of the display object.
- `play()` and `queue()` without a name say that the name is missing. The error for an unknown attachment of a slot reads as a sentence.
- A `MarrowSpine` has the Pixi label `MarrowSpine`, or the `label` option, and the field `isMarrowSpine`.
- `MarrowError` has an optional `docs` field for the address of a docs page.
- An update keeps no event that nobody listens for.
- The root exports the types `TrackEnd`, `ResolvedPerf`, `PacingStatus`, `DrawMode`, `PoseEngine`, `PoseEngineFactory`, `SkeletonModel`, `AtlasModel`, `SpineTicker`, `SpineEventName` and `SpineListener`. The constructors of `Bone`, `Slot` and `MarrowPerf` are internal.
- The JSDoc says where vertices are placed: on the CPU, or in the vertex shader with `skinning: 'gpu'`, meshes with weights too.
