# pixi-marrow

## 0.1.0-next.0

### Minor Changes

- [#8](https://github.com/schmooky/pixi-marrow/pull/8) [`2a94aee`](https://github.com/schmooky/pixi-marrow/commit/2a94aeec08a98d9370c3be7f65fd665436a6b081) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Bone handles and containers in a skeleton. `hero.bone(name)` reads and writes the pose of a bone and reads its place in the skeleton. `hero.follow(bone, container)` moves a Pixi container with a bone. `hero.attach(slot, container)` draws a container at the place of a slot in the draw order and moves it with the bone of the slot, as `addSlotObject` of the official runtime does. `unfollow` and `detach` end it. The perf report has a row `links`.
  
  Fixed: in a game whose bundle is tree-shaken and imports no Pixi `Mesh` of its own, the mesh mode threw when its code loaded after the renderer was created. It now gives the renderer the mesh pipe it lacks.
  
  Fixed: the engine for Spine 4.1 and 4.2 lost a write to a bone from outside when `setSkin` was called with the skin that was set already, before the next update.

- [#1](https://github.com/schmooky/pixi-marrow/pull/1) [`06a882c`](https://github.com/schmooky/pixi-marrow/commit/06a882ce98a230806a6e186c6db5ef078dc9be9a) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Import Spine 4.1, 4.2 and 4.3 skeletons (JSON and binary) and texture atlases into a model, with `importSkeleton` and `importAtlas` from `pixi-marrow/core`. Add `describeSkeleton`, and `generateNames` plus the `pixi-marrow` command line tool (`info`, `typegen`) in `pixi-marrow/optimize`.

- [#2](https://github.com/schmooky/pixi-marrow/pull/2) [`825fe74`](https://github.com/schmooky/pixi-marrow/commit/825fe7432730c4295c4c691afd4c353026f8835b) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Play skeletons without a renderer. `createPoseEngine` from `pixi-marrow/core` gives a pose engine for Spine 4.1, 4.2 and 4.3 with tracks, queue, mixing, skins and events. Its pose equals the official runtime exactly. Constraints are not solved yet. Add the geometry functions that turn a pose into vertex positions and texture coordinates. Setup values in the model are now 64-bit.

- [#3](https://github.com/schmooky/pixi-marrow/pull/3) [`46c686e`](https://github.com/schmooky/pixi-marrow/commit/46c686e930b3d8cabf2daa05bc7316f970e12f3c) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Draw skeletons in PixiJS v8. `MarrowSpine` from `pixi-marrow` loads a skeleton and its atlas, plays animations with `play`, `queue` and `stop`, and draws in one draw call for most skeletons, on WebGL2 and WebGPU. Additive slots share the draw call. Showing, hiding and reordering slots rewrites the index buffer only. Constraints and clipping are not solved yet.

- [#4](https://github.com/schmooky/pixi-marrow/pull/4) [`5673491`](https://github.com/schmooky/pixi-marrow/commit/567349174f6f974879b7ef1ab1c719c5f6ca2552) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Solve IK, transform and path constraints for Spine 4.1, 4.2 and 4.3, with the same pose as the official runtime, bit for bit. `constraints: 'ignore'` now skips physics and slider constraints only, and only those throw without it.
  
  Clipping attachments clip, through a stencil mask. A skeleton without a clip pays nothing for it.
  
  Cut overdraw. After a load the page images are read in idle time (`asset.optimized` resolves when that is done). A region without a visible pixel is then not drawn, and a slot behind the opaque part of a later slot is skipped, with the same picture. The new option `tightMesh: 'on'` also draws regions as polygons around their visible pixels. The new command `pixi-marrow outlines <atlas>` writes the outlines at build time, for the new load option `outlines`.
  
  `stats` has new counters: `clips`, `maskDraws`, `maskUploads`, `maskRebuilds`, `tightRanges` and `coveredSlots`. `clippingIgnored` is gone.

- [#5](https://github.com/schmooky/pixi-marrow/pull/5) [`159e97f`](https://github.com/schmooky/pixi-marrow/commit/159e97f43754f95757cd030ac85cf99119b21374) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Solve physics constraints (Spine 4.2 and 4.3) and sliders (4.3), with the same pose as the official runtime, bit for bit. Every constraint of the three versions is solved now. The load option `constraints` and the option of `createPoseEngine` are gone: there is nothing left to ignore.
  
  Physics control on the display object: `physics` (`update`, `pose`, `reset`, `none`), `resetPhysics()`, `physicsTranslate(x, y)` and `physicsRotate(x, y, degrees)`. On a pose engine: `physics`, `physicsTranslate`, `physicsRotate`, and in its state `yDown`, `windX`, `windY`, `gravityX` and `gravityY`.
  
  More play options: `additive`, `start`, `end`, `shortestRotation`, `eventThreshold`, and `entry` for any other field of the official track entry by its official name. `Track` has `configure(fields)` and `additive`. Options are checked before anything plays.
  
  `await spine.perf.report()` lists what the runtime decided for an instance and why. `await spine.perf.memory()` gives the bytes shared per asset, per instance and on the GPU. Both load their code at the first call.
  
  The new entry `pixi-marrow/perf` has `createProbe(spine)`: it times the pose, geometry and event work of every update and counts what the renderer did.

- [#6](https://github.com/schmooky/pixi-marrow/pull/6) [`52cd049`](https://github.com/schmooky/pixi-marrow/commit/52cd049b127a560c53538b311bd0b52f69605923) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - A batched render mode: skeletons of one render group share draw calls. 200 instances of a small rig draw in one call, where each took one or more before. The new option and property `renderMode` is `auto` by default, which batches every skeleton of up to 1024 vertices. `mesh` and `batched` force one side. `stats.renderMode` and a row of `await spine.perf.report()` name the mode in use and the reason.
  
  In batched mode a draw order, visibility, attachment or color change rewrites data in place. Pixi does not rebuild the instructions of the render group for it.
  
  Clipping no longer stops batching. In batched mode a clip is cut on the CPU, with the same triangles as the official runtime, bit for bit. The code for it loads with an asset that has a clipping attachment. Mesh mode keeps its stencil mask.
  
  Less memory per instance. The static part of a layout is shared between the instances of an asset, and one shader serves all views of the same pages. A batched instance holds no Pixi mesh, geometry or buffer of its own.
  
  The clip polygon of a region without weights or deform is triangulated once per attachment, not on every update.
  
  Fixed: 1200 instances of a rig with a clip no longer fail on WebGPU with `ubo batch got too big`. They draw in one call.

- [#7](https://github.com/schmooky/pixi-marrow/pull/7) [`eeb8673`](https://github.com/schmooky/pixi-marrow/commit/eeb867354245fce06b4c72ef84955fed9cd50f4f) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Work follows change. A skeleton at rest costs close to nothing: its update runs no timeline, poses no bone, places no vertex and uploads nothing. A skeleton that moves a little costs a little: only the bones whose inputs changed are posed, and only the slots that changed are placed, colored and uploaded.
  
  A pose state carries what changed: `version`, `boneStamps`, `slotStamps` and `drawOrderStamp`, with `isNewer`, `nextVersion` and `touchPose` in `pixi-marrow/core`. Code that writes the arrays of a pose state itself now calls `touchPose(state)` or sets the stamps of what it wrote. The engines and the views skip their work otherwise.
  
  The root import is smaller. The mesh mode, the clip code and the cuts of overdraw load when a skeleton needs them. The new load option `renderMode: 'mesh'` loads the mesh mode with the asset. An instance that asks for meshes before they are loaded draws in the batch until they arrive.
  
  `await spine.perf.report()` has a row `motion`: how much of the skeleton moved in the last update and whether the view rested. `stats` has `skips`, `placedSlots` and `coloredSlots`, and the probe counts `skippedUpdates` and `placedSlots`.
  
  Fixed: the mesh mode drew stale triangles on pixi.js before 8.20 after a skin change, or after two updates between two draws. Partial uploads are used from pixi.js 8.23 only: 8.20 to 8.22 lose all but the last one of a frame.

- Load skeletons through Pixi `Assets`. `registerMarrowAssets()` adds parsers for `.skel` files, Spine `.json` files and `.atlas` files, so aliases, manifests and bundles load them, as AssetPack writes them. `MarrowSpine.from({ skeleton, atlas })` and `MarrowAsset.get` take the aliases and return at once. An atlas named like `hero@0.5x.webp.atlas` counts as resolution 0.5 in WebP for `texturePreference`. The `data` of an atlas takes `images` and `imageMetadata`, as in the official runtime. Unloading an atlas destroys the assets made from it.

### Patch Changes

- First pre-release on npm, under the Spine Runtimes License in `LICENSE`. The pose core is ported from the official Spine Runtimes. Each user of pixi-marrow needs their own Spine Editor licence, as for the official runtimes.

- [#10](https://github.com/schmooky/pixi-marrow/pull/10) [`140194e`](https://github.com/schmooky/pixi-marrow/commit/140194e07a08d66b878a13bfd3558617aeafe56c) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fixed: a skeleton that was first drawn while the WebGL context was lost stayed invisible after the context came back. On pixi.js 8.16 it threw inside the render. A skeleton now draws nothing while the context of its renderer is lost, and draws again with the context that comes back. Skeletons that were drawn before the loss came back before this change and still do, at rest too.
  
  The pixel check now loses and restores the context of a running game in both render modes, see `scripts/render/restore-check.mjs`.

- [#9](https://github.com/schmooky/pixi-marrow/pull/9) [`91de488`](https://github.com/schmooky/pixi-marrow/commit/91de488eb1da4d4aa4422e76b352c143230f8b68) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fixed: a display object whose asset was destroyed threw a `TypeError` from Pixi's shared ticker, which then stopped for every skeleton of the page. Its `update` now does nothing, and `autoUpdate` turns off. Destroy the display objects of an asset before the asset, as before.
