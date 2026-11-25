# pixi-marrow

## 0.3.1

### Patch Changes

- [#50](https://github.com/schmooky/pixi-marrow/pull/50) [`0b9424f`](https://github.com/schmooky/pixi-marrow/commit/0b9424f6a4e0b448f1ccce1d3b8c1b42d70aeefa) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `update(0)` poses and draws at once under every `updateRate` and `offscreen` mode, and leaves the phase of the rate as it is. Before, a rate below the display, as in the `fast` preset, left `update(0)` out. A skeleton that no update drew yet counts as on the screen wherever the box of its setup pose is. So the `pause` mode no longer holds it paused for good. The first render after its first drawn update reads the exact box.

## 0.3.0

### Minor Changes

- [#45](https://github.com/schmooky/pixi-marrow/pull/45) [`4adbbec`](https://github.com/schmooky/pixi-marrow/commit/4adbbecc39cee22482b34771cea1c4c67b4290a6) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Skeletons draw on WebGL1, the context Pixi falls back to where a browser has no WebGL2. The batched mode, the mesh mode with `skinning: 'cpu'` and clip masks get a second program of GLSL 1.00, made from the same sources. WebGL2 and WebGPU compile the same programs as before. The warning `this renderer draws no skeleton` now shows on the Canvas renderer alone. A render of another renderer inside a render no longer changes which program the outer render uses.
  
  `skinning: 'gpu'` and instancing still need WebGL2 or WebGPU. On WebGL1 they draw nothing, their clip masks included, and warn once. They upload nothing there and report 0 draw calls. A WebGL1 device without 32-bit indices warns once: a batch or a mesh of more than 65535 vertices draws nothing there.

## 0.2.0

### Minor Changes

- [#41](https://github.com/schmooky/pixi-marrow/pull/41) [`6b719df`](https://github.com/schmooky/pixi-marrow/commit/6b719dfd72820abc7c08940ec058f0e0cbec26fb) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - pixi-marrow needs pixi.js 8.23.0 or later. The peer range is `^8.23.0`. It was `^8.21.0`.
  
  pixi.js 8.23 is the latest release. On 8.21 and 8.22, a WebGL buffer kept one stretch until Pixi bound it, and a data texture uploaded whole. The runtime had a second upload path for those versions, with its own tests and its own CI job. The library is a pre-release, so that path is not worth its cost.
  
  - The upload path for pixi.js 8.21 and 8.22 is gone. Nothing changes on pixi.js 8.23.
  - The rule `MARROW026` is retired, because no game can run the older versions. Its id stays reserved. The rules are `MARROW001` to `MARROW025`.
  - The root import and the mesh mode are smaller.

- [#15](https://github.com/schmooky/pixi-marrow/pull/15) [`17eeba5`](https://github.com/schmooky/pixi-marrow/commit/17eeba5f683c9258afa7fef7bd9fcf02624b6ca2) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Baked animations: an animation can play from frames sampled once, in place of the timelines and the constraints.
  
  - `bake: 'auto'` of a display object bakes an animation the first time it plays alone on track 0. No preset sets it, because a clip keeps 23 KB to 0.9 MB per animation and skin. The clip is kept per asset and skin, and every instance shares it. A list of names bakes those only. A name the skeleton lacks throws a `MarrowError` with the valid names.
  - An update plays baked when one entry plays alone on track 0 at alpha 1 and nothing wrote the pose since the update before. The skin, the place of the skeleton and the physics mode must be those of the clip. Any other update is posed by the engine as before. A skeleton whose skins turn on a physics constraint or a slider is never baked.
  - Events, loops, time scales, reverse and the `start` and `end` options stay exactly as without baking: the engine still runs the tracks and fires the events.
  - A clip keeps the world transforms of the bones that move and the slot values that change, as 32-bit numbers, at 60 frames per second. At a sample time a frame equals the pose of the engine rounded to 32 bits. Between two samples the frame before is shown. The local pose of a bone shows the values of the last update the engine posed.
  - The code loads on demand and adds 0.1 kB to the root import. A display object plays without baking until it is there.
  - The clips of a combined skin go when the skin is freed. `addBakedClips` throws a `MarrowError` for a clip whose arrays do not fit together, and reading the bytes of a file throws on a big-endian host.
  - The new entry `pixi-marrow/bake` bakes in Node at build time: `bakeAnimation`, `bakeAnimations`, `encodeBakedClips` and `decodeBakedClips`. `addBakedClips` hands clips to an asset, whose instances play them in place of baking.
  - The pose engines of `pixi-marrow/core` gain `solo`, `advance`, `holdsSetup` and `source`, and a track entry shows `animationStart` and `animationEnd`.

- [#14](https://github.com/schmooky/pixi-marrow/pull/14) [`2d2c7dc`](https://github.com/schmooky/pixi-marrow/commit/2d2c7dc390ed09f224735ceb1b7f2755400c6360) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Debug overlays: the new entry `pixi-marrow/debug` and its `MarrowDebug` draw over a skeleton.
  
  - Layers: bones, origin, regions, mesh hulls, mesh triangles, bounding boxes, clipping, paths, point attachments, event names and overdraw. Each can be turned on and off at run time, with its own color.
  - The shapes equal what the official runtime computes. The overlay draws again only when the pose or a setting changed, and lines keep their width on the screen.
  - The overdraw layer fills every triangle the skeleton draws, after the cuts of overdraw, with a color that adds up where the GPU paints a pixel more than once.
  - The overlays draw with pixi-silk, now an optional peer dependency. A game that does not import `pixi-marrow/debug` needs neither it nor the overlay code.

- [#15](https://github.com/schmooky/pixi-marrow/pull/15) [`74d18f0`](https://github.com/schmooky/pixi-marrow/commit/74d18f06f72209170a1ebd31b8bab789bcd61036) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - GPU skinning: `skinning: 'gpu'` places the vertices of the mesh mode in the vertex shader, from the bone matrices of the pose.
  
  - A moving skeleton uploads its bone matrices, 24 bytes a bone, in place of the positions of its vertices. Regions, region polygons and meshes are placed on the GPU, weighted meshes with any number of bones a vertex included.
  - The CPU still places a mesh while it has a deform, and a region with a sequence. Both draw in the same draw call as the rest.
  - The colors of the slots live in a palette texture, so a color key writes the 8 bytes of one slot and not the colors of its vertices. Additive slots, multiply, screen and the two color tint draw as before.
  - `auto`, the default, stays `cpu` until phones are measured. The batched mode always places vertices on the CPU.
  - Code that reads the positions on the CPU, such as the bounds and the debug overlays, gets them placed on demand. A layout with opaque rectangles for the cut of covered slots places every vertex on the CPU for that search, and uploads only what the CPU is in charge of.
  - The code loads with the mesh mode, on demand. The root import does not grow.

- [#8](https://github.com/schmooky/pixi-marrow/pull/8) [`2a94aee`](https://github.com/schmooky/pixi-marrow/commit/2a94aeec08a98d9370c3be7f65fd665436a6b081) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Bone handles and containers in a skeleton. `hero.bone(name)` reads and writes the pose of a bone and reads its place in the skeleton. `hero.follow(bone, container)` moves a Pixi container with a bone. `hero.attach(slot, container)` draws a container at the place of a slot in the draw order and moves it with the bone of the slot, as `addSlotObject` of the official runtime does. `unfollow` and `detach` end it. The perf report has a row `links`.
  
  Fixed: in a game whose bundle is tree-shaken and imports no Pixi `Mesh` of its own, the mesh mode threw when its code loaded after the renderer was created. It now gives the renderer the mesh pipe it lacks.
  
  Fixed: the engine for Spine 4.1 and 4.2 lost a write to a bone from outside when `setSkin` was called with the skin that was set already, before the next update.

- [#15](https://github.com/schmooky/pixi-marrow/pull/15) [`a1d71c3`](https://github.com/schmooky/pixi-marrow/commit/a1d71c3ac56aa5a18565854a83792453d04c2ecf) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The idle cache: with `idleCache: 'auto'`, a skeleton at rest is drawn as one image. No preset sets it. Each image is a texture of its own, so many images take memory and split batches, and on a low-end phone small resting symbols drew slower with it. Set it by name where a skeleton is expensive to draw live.
  
  - After 30 updates in which its pose, its layout and its render mode did not change, and two renders at the same place, the skeleton is drawn once into a render texture. The view is hidden and a sprite with that image shows in its place, as one quad in Pixi's batch.
  - The image lies on the pixel grid of the target, so it shows the pixels of the live skeleton. The pixel check holds it to the live skeleton and to the official runtime in both render modes, on WebGL2 and WebGPU.
  - Any change of the pose, the layout or the render mode drops the image in the same frame, and the skeleton draws live. So does a render that puts it elsewhere than whole pixels away, or with an alpha or a blend mode above it. An attached container, another renderer, a multisampled target and a WebGL context that came back drop it too.
  - A skeleton that shows a slot that multiplies or screens, or that would need an image larger than 2048 pixels on a side, draws live. So does one drawn to a multisampled target.
  - A tint above a skeleton with a dark color keeps it live, because the shaders tint the light color alone.
  - An image takes 4 bytes per pixel of its box on the target. A dropped image lets go of its color pixels.
  - The code is a chunk of 2.2 kB gzip that loads with the first display object that has the setting. The root import grows by about 0.1 kB.

- [#16](https://github.com/schmooky/pixi-marrow/pull/16) [`308e867`](https://github.com/schmooky/pixi-marrow/commit/308e8679449900788af13b151c201b07c496edd8) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Instanced draws: with `skinning: 'gpu'`, the skeletons of the mesh mode that follow each other in Pixi's render order and share a layout draw as one instanced draw.
  
  - The new option `instancing: 'auto' | 'off'`, also a setting of `perf`, is `off` in every preset and is set by name. It acts on a skeleton in the mesh mode with `skinning: 'gpu'` and leaves every other one as it is. It pays for many copies of one rig next to each other, and not for a grid of different skeletons. The picture is the same to the bit as with `off`.
  - A run of instances ends where Pixi draws anything else. Inside a run, instances with another layout, draw order, pages or blend mode start another draw, and Pixi builds no instructions again for that.
  - The instances of a layout keep their bones, their slot colors and the vertices the CPU places in data textures they share. A frame uploads each of them once, the stretch that changed from pixi.js 8.23 on. A slot shows one of its attachments, so the vertex shader drops the vertices of the others.
  - A skeleton draws alone while a clipping attachment cuts a visible slot, and while a container attached to a slot is drawn. It always draws alone when a slot multiplies or screens or the atlas has more than 8 pages.
  - `perf.report()` has a row `instancing`: whether the instance draws instanced, in a run of how many and in how many draw calls, or why not. `perf.memory()` counts the slot of an instance in its bytes and the rest of the shared textures as shared.
  - The code is in the chunk of the mesh mode, which loads on demand. Nothing registers with Pixi at import: the pipe goes into a renderer when it first draws an instanced skeleton.

- [#16](https://github.com/schmooky/pixi-marrow/pull/16) [`04c36b8`](https://github.com/schmooky/pixi-marrow/commit/04c36b89b404b3799e176aeff6a21683532b18bc) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `lod: 'auto'` now leaves deform out too, below the same 96 pixels as physics. Every mesh of a skeleton drawn that small shows its setup vertices, and the deform timelines do not run. Both come back at 120 pixels.
  
  - The pose engines have a new switch, `engine.deform`. Set to false, it keeps every deform aside and shows none. Set back to true, the deforms come back and the next update applies the deform timelines again, also for a pose at rest. A slot that showed another attachment meanwhile loses its deform, as in the official runtime.
  - A deform switch or a physics mode `none` that the game set stays as the game set it.
  - Baked playback writes no deform while the switch is off.
  - `PacingStatus.physicsOff` is now `reduced`, because it covers deform as well. The `pacing` row of `perf.report()` says that physics and deform are left out.

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

- [#19](https://github.com/schmooky/pixi-marrow/pull/19) [`1a53040`](https://github.com/schmooky/pixi-marrow/commit/1a53040438b8533779f739ad23e264ce402a8a7b) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Outlines are off by default. A load reads no page image any more unless it asks. Pass the file that `pixi-marrow outlines` writes at build time as `outlines`, or set `outlines: 'auto'` to read the page images in idle time after the load. That scan draws every page into a canvas, 32 MB for a page of 2048 by 2048 for a moment, which a phone with little memory can fail on. Without outlines every region stays a quad and every slot is drawn, so the picture is the same and only the cuts of overdraw are gone.

- [#15](https://github.com/schmooky/pixi-marrow/pull/15) [`0085abe`](https://github.com/schmooky/pixi-marrow/commit/0085abef1ac9f114150b26763308277f61141979) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Performance presets and pacing: `perf: 'exact' | 'balanced' | 'fast'` sets several options at once, and each one is an option of its own too.
  
  - `exact` is the default and changes nothing. The presets set when a skeleton updates, and nothing else. `balanced` sets `offscreen: 'throttle'`. `fast` sets `offscreen: 'pause'` and `updateRate: 30` for batched skeletons. Baking, tight meshes, the idle cache, `lod` and instancing cost memory, vertices or draw calls in a way that depends on the device and the scene, so no preset sets them. Each is set by its own name.
  - A `perf` object starts from its `preset` and changes the settings it names. An option given by name wins over both. A preset or a value that does not exist throws a `MarrowError` with the closest valid name.
  - `offscreen: 'throttle'` updates a skeleton off the screen 4 times a second with the time that passed. `'pause'` stops its time until it is on the screen again. A skeleton is off the screen when its bounds lie outside the screen, or no render reached it for 2 updates and 0.1 seconds. `play`, `queue` and `stop` pose the gathered time first, so its events fire.
  - `updateRate` poses a skeleton at most that many times a second, with the time of the updates in between.
  - `lod: 'auto'` leaves physics out while a skeleton is drawn smaller than 96 pixels across, and resets physics when it grows to 120.
  - `perfSettings` holds the settings in effect, and `pacingStatus()` says how often the skeleton updates right now and why. The first two rows of `perf.report()` say the same.
  - The physics controls of `MarrowSpine` moved to a new base class, `SpinePhysics`. Nothing changes for a game that calls them.

- [#11](https://github.com/schmooky/pixi-marrow/pull/11) [`e3ee547`](https://github.com/schmooky/pixi-marrow/commit/e3ee547bc01a7bf8493878ceb594421ed77b19ab) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Load skeletons through Pixi `Assets`. `registerMarrowAssets()` adds parsers for `.skel` files, Spine `.json` files and `.atlas` files, so aliases, manifests and bundles load them, as AssetPack writes them. `MarrowSpine.from({ skeleton, atlas })` and `MarrowAsset.get` take the aliases and return at once. An atlas named like `hero@0.5x.webp.atlas` counts as resolution 0.5 in WebP for `texturePreference`. The `data` of an atlas takes `images` and `imageMetadata`, as in the official runtime. Unloading an atlas destroys the assets made from it.

- [#19](https://github.com/schmooky/pixi-marrow/pull/19) [`1a53040`](https://github.com/schmooky/pixi-marrow/commit/1a53040438b8533779f739ad23e264ce402a8a7b) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - pixi.js 8.21 or later is needed. The peer range of `pixi.js` is `^8.21.0`, and the checks no longer run on 8.16. The workarounds for the versions before 8.21 stay in the code for now, and nothing relies on them.

- [#13](https://github.com/schmooky/pixi-marrow/pull/13) [`b4c58c1`](https://github.com/schmooky/pixi-marrow/commit/b4c58c1a9ed4fecaf3fc924b1e08ba08cf960cae) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Several skins at once, a slot handle, the setup pose and point conversion on the display object.
  
  - `hero.skins = ['skin-base', 'hair/pink']` makes a list of skins active as one, as `Skin.addSkin` does in the official runtime. The later skin wins where two store an attachment under one slot and name. Instances of an asset share the combined skin, and one that no instance shows is freed after the 8 newest such.
  - `hero.slot(name)` gives a handle with `attachment`, `tint`, `alpha` and `darkTint`. A write stays until an animation keys the slot or the setup pose of the slots is set. Writing the value a slot has changes nothing, so a skeleton at rest stays at rest.
  - `hero.setupPose()` resets the bones and the slots, `'bones'` or `'slots'` one half.
  - `bone.localToWorld(point)` and `bone.worldToLocal(point)` take points between a bone and the skeleton.
  - The pose engines of `pixi-marrow/core` gain `setSkins`, `skins`, `slotPose`, `setAttachment`, `setColor` and `setDarkColor`. A parity family checks all of them against the official cores of 4.1, 4.2 and 4.3.

### Patch Changes

- [#39](https://github.com/schmooky/pixi-marrow/pull/39) [`7b81c32`](https://github.com/schmooky/pixi-marrow/commit/7b81c328b4d38a66354739bb5ddffef0d30ab615) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fixes from an audit of pacing, lod, skins and baking.
  
  - `MarrowAsset.get` and `MarrowSpine.from` read no page images unless `outlines` is `'auto'`, as `MarrowAsset.load` does. The Pixi `Assets` path scanned every page before, about 32 MB for a page of 2048 by 2048.
  - A display object that sets `tightMesh` or `occlusion` by name on an asset without outlines warns once per asset, because those options do nothing then.
  - `offscreen: 'pause'` and `'throttle'` count a skeleton as off the screen when it or a parent has `visible` or `renderable` false. Pixi still calls `onRender` for such a skeleton, so a hidden popup kept its skeletons updating.
  - `lod: 'auto'`: a skeleton that shrinks while an animation with deforms mixes out, then grows again, shows the deform of a skeleton without lod. It showed the deform from before the mix.
  - Setting `skin` or `skins` to the skins that are active changes nothing. It put the slots into their setup pose before, which reset tints and attachments set through slot handles. `skin` reads null while several skins are active, and null written back keeps them.
  - A freed combined skin gives its index to the next one, so the count of skins stays bounded for a game that tries many lists.
  - Baked playback shows the nearest frame. A tick of a 60 Hz screen lands on a sample, give or take its jitter. Playback of the frame at or before the time repeated a frame and skipped the next in most updates.
  - `bake: 'auto'` bakes a clip in idle time, a frame of the animation or more per slice. The object plays live until the clip is there. The bake ran inside the update that first played the animation, a hitch on a phone. The clips are the same.
  - `addBakedClips` refuses a clip whose duration is not that of the animation, which catches a stale clip of a JSON export without the editor hash. It also refuses a draw order that holds a slot twice.

- [#39](https://github.com/schmooky/pixi-marrow/pull/39) [`7b81c32`](https://github.com/schmooky/pixi-marrow/commit/7b81c328b4d38a66354739bb5ddffef0d30ab615) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fixes of the render path and the idle cache, found in an audit.
  
  - On WebGPU the uniform buffers that meshes of the mesh mode bind past the 256 places kept for the scene are static now. Pixi uploads one only when its transform, tint or rounding changed. Before, each draw wrote and uploaded it. When a private field of Pixi that this code reads is missing, the runtime reports it once in the console, with the version of pixi.js.
  - On a renderer of WebGL1 no skeleton draws, and `console.warn` says so once. Every shader is GLSL 3.00, and Pixi uses WebGL1 where a browser has no WebGL2. The rest of the app goes on.
  - `instancing: 'auto'` does not draw a layout instanced when its attachments have more than twice the vertices a pose shows. A pose shows the setup attachments, and the largest attachment of a slot that is empty in the setup pose. One such layout is speedy-ess, with 108 against 44. The perf report says so with both counts. The new value `instancing: 'on'` draws such a layout instanced anyway.
  - The stats of an instance that draws instanced count no uploads of their own. The pool of its layout counts its uploads, and the row `uploads` of the perf report gives that count.
  - The views of a layout with `skinning: 'gpu'` share one GPU buffer of skin data. Before, each view made a copy. The shared bytes of `perf.memory()` count it once.
  - Instanced draws free the layouts, pools and shaders that they no longer draw with. The runtime frees the pools of a layout once no instance holds a place in them. So a burst of instances leaves no large textures.
  - The idle cache drops an image when a page texture updates or takes another source. It keeps a skeleton live under a filter or a mask, and holds at most 64 MB of images in all. It no longer keeps the last captured skeleton alive.

- [#40](https://github.com/schmooky/pixi-marrow/pull/40) [`41728c3`](https://github.com/schmooky/pixi-marrow/commit/41728c3c8df3d3a599a0c9e1efc6e5534e0157a1) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The README on npmjs.com links to the files on GitHub. Its relative links pointed nowhere there. The description of the package names WebGL2 and WebGPU, and the keywords name what people search for.

- [#40](https://github.com/schmooky/pixi-marrow/pull/40) [`41728c3`](https://github.com/schmooky/pixi-marrow/commit/41728c3c8df3d3a599a0c9e1efc6e5534e0157a1) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - A coding agent or a person can now find every skeleton of a scene and name what costs time in it.
  
  Additions:
  
  - The entry `pixi-marrow/diagnose`. `diagnose(root)` walks a Pixi scene tree and returns the causes of cost that one look finds. Each hit has a stable rule id from `MARROW001` to `MARROW025`. It also has the path of the skeleton, the path of the cause, the numbers, a fix and a docs address.
  - `watch(root)` notes the counters of every skeleton. Its `report()` adds the causes that show only over time, such as a parent that moves or fades.
  - `inspect(hero)` reads one skeleton into plain data: counts, render mode, draw calls, cuts, uploads, pacing, physics and memory.
  - `serializeTree(root)` writes the tree as JSON, and `diagnoseTree(json)` runs the static rules on it without Pixi.
  - `installDevtools()` puts the hook `__PIXI_MARROW__` on `globalThis`. The package registers nothing until a game calls it. `installDevtools({ warn: true })` prints each hit once per rule and skeleton.
  - The command line tool has two more commands: `pixi-marrow rules [--json]` and `pixi-marrow diagnose <tree.json> [--json]`.
  - The tarball ships `AGENTS.md` for coding agents that use the package, `perf-rules.json` and `skills/pixi-marrow/SKILL.md`. `pixi-marrow/perf-rules.json` is an export.
  - A row of `perf.report()` can carry `rule`, `docs` and `data`. `rule` is the id of the rule that names its cause, and `data` holds the facts of the row for a program.
  - `MarrowError.docs` is set for the codes `unsupported-version`, `unknown-name`, `not-registered` and `not-loaded`.
  - Each warning of the runtime ends with the address of its docs page.
  
  Fixes:
  
  - The row `motion` of `perf.report()` said "placed no vertex and uploaded nothing" for a pose at rest below a container that moved or faded. It now says what the batch wrote, with the bytes of the frame and the rule id.

- [#40](https://github.com/schmooky/pixi-marrow/pull/40) [`41728c3`](https://github.com/schmooky/pixi-marrow/commit/41728c3c8df3d3a599a0c9e1efc6e5534e0157a1) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fixes from the second audit, in the display object, the pacing and the baked clips.
  
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

- [#40](https://github.com/schmooky/pixi-marrow/pull/40) [`41728c3`](https://github.com/schmooky/pixi-marrow/commit/41728c3c8df3d3a599a0c9e1efc6e5534e0157a1) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The JSDoc says what the code does in four places. `destroy` of a display object ends the asset when that object was its last holder. `stop` with a mix returns the track to what lower tracks give, or to the setup pose. `StopOptions.mix` says the same. `autoUpdate` says that a hidden object with a mix or several tracks is still posed, and that no vertex is placed.

- [#40](https://github.com/schmooky/pixi-marrow/pull/40) [`41728c3`](https://github.com/schmooky/pixi-marrow/commit/41728c3c8df3d3a599a0c9e1efc6e5534e0157a1) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The leftovers of the second audit.
  
  - An asset has a name. `asset.name` is the `name` option of the load. Without that option, it is the file name of the skeleton URL without the extension. It is the empty string for a skeleton in memory. A display object without a `label` gets the label `MarrowSpine:<name>`.
  - `MarrowAsset.fromData` makes an asset from data in memory. `MarrowAsset.from` is the older name and is deprecated. `MarrowAsset.fromCache` gets the asset of files that Pixi `Assets` loaded. `MarrowAsset.get` stays as its first name.
  - More errors have a code of their own. A file or a page image that does not load throws `not-found`. A call before `registerMarrowAssets()` throws `not-registered`. An alias that Pixi `Assets` does not hold throws `not-loaded`. A wrong argument of an engine call, of `createProbe` and of `MarrowDebug` throws `invalid-option`. A destroyed view and a destroyed probe target throw `destroyed`.
  - A baked clip of the JSON export fits the binary export of the same skeleton. The duration of the clip can differ from the animation by 0.0001 seconds.
  - The pacing of `offscreen` and `lod` reads a box that can be 8 renders old. A skeleton with `skinning: 'gpu'` no longer places its vertices on the CPU in each frame. A move, a new scale and a new attachment still count at once.
  - The mesh mode uploads the vertices that changed one time per frame, before the render. Thus `stats.uploadBytes` and `stats.frameBytes` count these bytes after the render.
  - With `idleCache: 'auto'`, a skeleton whose animation ran while it was hidden no longer shows its old image for one frame.
  - A second view of a model does not draft its first layout again.
  - `pnpm build` loads its config as plain JavaScript. The build needs no Node that strips types.

- [#40](https://github.com/schmooky/pixi-marrow/pull/40) [`41728c3`](https://github.com/schmooky/pixi-marrow/commit/41728c3c8df3d3a599a0c9e1efc6e5534e0157a1) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fixes from an audit of loading, assets and file readers.
  
  - An asset counts its holders. Each `MarrowAsset.load` that returns it is one owner, and each live `MarrowSpine` holds it too. `asset.destroy()` lets one owner go. The asset unloads its textures only when no owner and no display object is left. Before, one `destroy` call took the textures from every display object, and the Pixi render crashed.
  - `MarrowSpine.load` gives its hold on the asset to the display object. `hero.destroy()` then unloads the asset when no other holder is left. Before, the model and the textures stayed for the life of the page.
  - Page images are held by absolute URL, in one map for `MarrowAsset.load` and for the `.atlas` parser of Pixi `Assets`. A relative and an absolute URL of one image give one texture. pixi-marrow never unloads an image that the game loaded through Pixi `Assets` itself.
  - Unloading an atlas or a skeleton from Pixi `Assets` lets the assets made from it go. An asset with a display object on the stage keeps its pages until that object is destroyed. An asset of a skeleton that was loaded again no longer stays in memory.
  - `MarrowAsset.load` sends every URL through the resolver of Pixi `Assets`. `basePath` and `defaultSearchParams` of `Assets.init` now apply to the skeleton, the atlas, the outlines file and the pages. Before, they applied to the pages only, and a page path could double.
  - A JSON skeleton is told by its content, not by a `.json` suffix. URLs with a hash, a query or no extension work, and `blob:` URLs too. `importSkeleton` and `sniffSkeleton` take the bytes of a JSON file.
  - When a server answers with an HTML page, the error says so and names the URL. Every load error names its URL. The parsers for Pixi `Assets` throw `MarrowError`.
  - `outlines: 'auto'`: assets that draw from one page image share one scan of it. The scans read the pages one after the other through one WebGL context, and free it when no page waits. Before, 17 assets on one atlas opened 17 contexts. A scan works in slices of 4 ms. A page that fails warns once, with the cause.
  - `MarrowAsset.get` and `MarrowSpine.from` take `outlines` as an object, or as the alias or URL of an outlines file that Pixi `Assets` loaded.
  - `pixi-marrow outlines` has the option `--pages <dir>`. It reads the PNG sources of an atlas with WebP or AVIF pages from that folder, by base name. Without the option, the error for such an atlas names it.
  - `model.hash` is the same for the `.json` and the `.skel` of one export: 16 hex digits. Clips baked from a `.skel` before this release need a new bake.
  - The 4.3 binary reader checks every count against the file size, as the 4.2 reader does. All readers refuse more than 32,767 bones or slots.
  - A dark color timeline on a slot without a dark color fails at the import, for all versions. Before, a 4.3 skeleton threw inside the ticker.
  - A page image that the game loaded before in another alpha mode than its atlas page needs warns once, with the fix.

- [#40](https://github.com/schmooky/pixi-marrow/pull/40) [`41728c3`](https://github.com/schmooky/pixi-marrow/commit/41728c3c8df3d3a599a0c9e1efc6e5534e0157a1) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - A playing pose engine no longer allocates in an update that reports no event. Before, a walking spineboy allocated about 1,400 bytes in each update. An update that reports events allocates the list that `takeEvents` returns and one object for each event. A test now measures the heap of live engines of both kinds while their timelines play.
  
  The 4.3 pose engine now rests in the same states as the 4.2 engine. These states are ended entries on two or more tracks, an ended entry below full alpha, and an ended entry on an upper track only. In these states an update runs no timeline, and `state.version` stays the same.
  
  `configure` follows the same rules in both pose engines. The engine checks all fields before it writes one, so a call that throws changes nothing. A field of a different Spine version throws `unsupported-feature`. A name that no version has throws `unknown-name` with the closest field name. A value of the wrong type throws `invalid-data`. A field with the value `undefined` stays as it is.
  
  The 4.3 engine prepares an animation when a call plays it for the first time. The first engine of a model with 1,500 animations took 70 ms and 38 MB. It now takes 17 ms and 1 MB. An animation that the engine cannot play now throws on its first play, not when you create the engine.
  
  A timeline with more than 32 keys is searched by halves. The search finds the same key as the official search. In the 4.2 engine, an animation with 6,000 keys on each of 30 bones took 265 microseconds for each update. It now takes 22.
  
  A slot without a deform shares one empty array with all other slots. One spineboy instance takes about 10 kB less memory. `engine.bytes` counts the data of the typed arrays. The JSDoc now gives the cost of the objects that it does not count.
  
  The 4.3 engine keeps each entry that a track mixes from while the track changes its animation faster than the mix. The official 4.3.13 runtime does the same, and the pose must be equal to the official pose. A test now records this behavior.
  
  The JSDoc of `takeEvents` and `createPoseEngine` now tells you to call `takeEvents` after each update. An engine keeps its events until that call.

- [#40](https://github.com/schmooky/pixi-marrow/pull/40) [`41728c3`](https://github.com/schmooky/pixi-marrow/commit/41728c3c8df3d3a599a0c9e1efc6e5534e0157a1) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The render path sends fewer bytes, and the stats count what a parent costs. These changes come from the second audit.
  
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

- [#39](https://github.com/schmooky/pixi-marrow/pull/39) [`7b81c32`](https://github.com/schmooky/pixi-marrow/commit/7b81c328b4d38a66354739bb5ddffef0d30ab615) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The optional peer pixi-silk is `^1.0.1` again. The debug overlays work on 1.0.1. The fix of 1.0.2 is for the transform gizmo of the playground of the site, and the site depends on 1.0.2 itself.

- [#11](https://github.com/schmooky/pixi-marrow/pull/11) [`e3ee547`](https://github.com/schmooky/pixi-marrow/commit/e3ee547bc01a7bf8493878ceb594421ed77b19ab) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - First pre-release on npm, under the Spine Runtimes License in `LICENSE`. The pose core is ported from the official Spine Runtimes. Each user of pixi-marrow needs their own Spine Editor licence, as for the official runtimes.

- [#16](https://github.com/schmooky/pixi-marrow/pull/16) [`2323edc`](https://github.com/schmooky/pixi-marrow/commit/2323edcf734f31ea2210c317ca4f5a108b12c040) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The idle cache draws its images in the batches of the batched mode, not as Pixi sprites. An image now shares a batch with the skeletons around it, so a grid where symbols at rest and in play take turns no longer breaks the batch at every image. In the reels of the site a frame of a win took 10 to 14 draw calls with the idle cache on, and now takes 3 or 4, as without it.

- [#10](https://github.com/schmooky/pixi-marrow/pull/10) [`140194e`](https://github.com/schmooky/pixi-marrow/commit/140194e07a08d66b878a13bfd3558617aeafe56c) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fixed: a skeleton that was first drawn while the WebGL context was lost stayed invisible after the context came back. On pixi.js 8.16 it threw inside the render. A skeleton now draws nothing while the context of its renderer is lost, and draws again with the context that comes back. Skeletons that were drawn before the loss came back before this change and still do, at rest too.
  
  The pixel check now loses and restores the context of a running game in both render modes, see `scripts/render/restore-check.mjs`.

- [#21](https://github.com/schmooky/pixi-marrow/pull/21) [`39a5b31`](https://github.com/schmooky/pixi-marrow/commit/39a5b31f8e5418b5969177366c1bc36da8a0e61a) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The optional peer pixi-silk is `^1.0.2`. The debug overlays draw as before. pixi-silk 1.0.2 ends a drag of its transform gizmo on the release wherever it happens, which the playground of the site relied on a workaround for.

- [#9](https://github.com/schmooky/pixi-marrow/pull/9) [`91de488`](https://github.com/schmooky/pixi-marrow/commit/91de488eb1da4d4aa4422e76b352c143230f8b68) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fixed: a display object whose asset was destroyed threw a `TypeError` from Pixi's shared ticker, which then stopped for every skeleton of the page. Its `update` now does nothing, and `autoUpdate` turns off. Destroy the display objects of an asset before the asset, as before.

- [#20](https://github.com/schmooky/pixi-marrow/pull/20) [`639d15e`](https://github.com/schmooky/pixi-marrow/commit/639d15e5005f4a8809d0d0f4f76892bfb2719b6e) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The mesh mode draws more than about 2000 meshes in a frame on WebGPU. Pixi gives every mesh draw a slot of one uniform buffer per frame and threw once it was full, so 1200 instances of a rig with a clip failed. A mesh of pixi-marrow now takes a slot while the buffer has room for the rest of the scene, and binds a small uniform buffer of its own after that. That buffer is uploaded only when its transform, tint or rounding change. Other meshes are drawn by Pixi as before, and WebGL is unchanged.

## 0.1.0-next.1

### Minor Changes

- [#15](https://github.com/schmooky/pixi-marrow/pull/15) [`17eeba5`](https://github.com/schmooky/pixi-marrow/commit/17eeba5f683c9258afa7fef7bd9fcf02624b6ca2) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Baked animations: an animation can play from frames sampled once, in place of the timelines and the constraints.
  
  - `bake: 'auto'` of a display object bakes an animation the first time it plays alone on track 0. No preset sets it, because a clip keeps 23 KB to 0.9 MB per animation and skin. The clip is kept per asset and skin, and every instance shares it. A list of names bakes those only. A name the skeleton lacks throws a `MarrowError` with the valid names.
  - An update plays baked when one entry plays alone on track 0 at alpha 1 and nothing wrote the pose since the update before. The skin, the place of the skeleton and the physics mode must be those of the clip. Any other update is posed by the engine as before. A skeleton whose skins turn on a physics constraint or a slider is never baked.
  - Events, loops, time scales, reverse and the `start` and `end` options stay exactly as without baking: the engine still runs the tracks and fires the events.
  - A clip keeps the world transforms of the bones that move and the slot values that change, as 32-bit numbers, at 60 frames per second. At a sample time a frame equals the pose of the engine rounded to 32 bits. Between two samples the frame before is shown. The local pose of a bone shows the values of the last update the engine posed.
  - The code loads on demand and adds 0.1 kB to the root import. A display object plays without baking until it is there.
  - The clips of a combined skin go when the skin is freed. `addBakedClips` throws a `MarrowError` for a clip whose arrays do not fit together, and reading the bytes of a file throws on a big-endian host.
  - The new entry `pixi-marrow/bake` bakes in Node at build time: `bakeAnimation`, `bakeAnimations`, `encodeBakedClips` and `decodeBakedClips`. `addBakedClips` hands clips to an asset, whose instances play them in place of baking.
  - The pose engines of `pixi-marrow/core` gain `solo`, `advance`, `holdsSetup` and `source`, and a track entry shows `animationStart` and `animationEnd`.

- [#14](https://github.com/schmooky/pixi-marrow/pull/14) [`2d2c7dc`](https://github.com/schmooky/pixi-marrow/commit/2d2c7dc390ed09f224735ceb1b7f2755400c6360) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Debug overlays: the new entry `pixi-marrow/debug` and its `MarrowDebug` draw over a skeleton.
  
  - Layers: bones, origin, regions, mesh hulls, mesh triangles, bounding boxes, clipping, paths, point attachments, event names and overdraw. Each can be turned on and off at run time, with its own color.
  - The shapes equal what the official runtime computes. The overlay draws again only when the pose or a setting changed, and lines keep their width on the screen.
  - The overdraw layer fills every triangle the skeleton draws, after the cuts of overdraw, with a color that adds up where the GPU paints a pixel more than once.
  - The overlays draw with pixi-silk, now an optional peer dependency. A game that does not import `pixi-marrow/debug` needs neither it nor the overlay code.

- [#15](https://github.com/schmooky/pixi-marrow/pull/15) [`74d18f0`](https://github.com/schmooky/pixi-marrow/commit/74d18f06f72209170a1ebd31b8bab789bcd61036) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - GPU skinning: `skinning: 'gpu'` places the vertices of the mesh mode in the vertex shader, from the bone matrices of the pose.
  
  - A moving skeleton uploads its bone matrices, 24 bytes a bone, in place of the positions of its vertices. Regions, region polygons and meshes are placed on the GPU, weighted meshes with any number of bones a vertex included.
  - The CPU still places a mesh while it has a deform, and a region with a sequence. Both draw in the same draw call as the rest.
  - The colors of the slots live in a palette texture, so a color key writes the 8 bytes of one slot and not the colors of its vertices. Additive slots, multiply, screen and the two color tint draw as before.
  - `auto`, the default, stays `cpu` until phones are measured. The batched mode always places vertices on the CPU.
  - Code that reads the positions on the CPU, such as the bounds and the debug overlays, gets them placed on demand. A layout with opaque rectangles for the cut of covered slots places every vertex on the CPU for that search, and uploads only what the CPU is in charge of.
  - The code loads with the mesh mode, on demand. The root import does not grow.

- [#15](https://github.com/schmooky/pixi-marrow/pull/15) [`a1d71c3`](https://github.com/schmooky/pixi-marrow/commit/a1d71c3ac56aa5a18565854a83792453d04c2ecf) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The idle cache: with `idleCache: 'auto'`, a skeleton at rest is drawn as one image. No preset sets it. Each image is a texture of its own, so many images take memory and split batches, and on a low-end phone small resting symbols drew slower with it. Set it by name where a skeleton is expensive to draw live.
  
  - After 30 updates in which its pose, its layout and its render mode did not change, and two renders at the same place, the skeleton is drawn once into a render texture. The view is hidden and a sprite with that image shows in its place, as one quad in Pixi's batch.
  - The image lies on the pixel grid of the target, so it shows the pixels of the live skeleton. The pixel check holds it to the live skeleton and to the official runtime in both render modes, on WebGL2 and WebGPU.
  - Any change of the pose, the layout or the render mode drops the image in the same frame, and the skeleton draws live. So does a render that puts it elsewhere than whole pixels away, or with an alpha or a blend mode above it. An attached container, another renderer, a multisampled target and a WebGL context that came back drop it too.
  - A skeleton that shows a slot that multiplies or screens, or that would need an image larger than 2048 pixels on a side, draws live. So does one drawn to a multisampled target.
  - A tint above a skeleton with a dark color keeps it live, because the shaders tint the light color alone.
  - An image takes 4 bytes per pixel of its box on the target. A dropped image lets go of its color pixels.
  - The code is a chunk of 2.2 kB gzip that loads with the first display object that has the setting. The root import grows by about 0.1 kB.

- [#16](https://github.com/schmooky/pixi-marrow/pull/16) [`308e867`](https://github.com/schmooky/pixi-marrow/commit/308e8679449900788af13b151c201b07c496edd8) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Instanced draws: with `skinning: 'gpu'`, the skeletons of the mesh mode that follow each other in Pixi's render order and share a layout draw as one instanced draw.
  
  - The new option `instancing: 'auto' | 'off'`, also a setting of `perf`, is `off` in every preset and is set by name. It acts on a skeleton in the mesh mode with `skinning: 'gpu'` and leaves every other one as it is. It pays for many copies of one rig next to each other, and not for a grid of different skeletons. The picture is the same to the bit as with `off`.
  - A run of instances ends where Pixi draws anything else. Inside a run, instances with another layout, draw order, pages or blend mode start another draw, and Pixi builds no instructions again for that.
  - The instances of a layout keep their bones, their slot colors and the vertices the CPU places in data textures they share. A frame uploads each of them once, the stretch that changed from pixi.js 8.23 on. A slot shows one of its attachments, so the vertex shader drops the vertices of the others.
  - A skeleton draws alone while a clipping attachment cuts a visible slot, and while a container attached to a slot is drawn. It always draws alone when a slot multiplies or screens or the atlas has more than 8 pages.
  - `perf.report()` has a row `instancing`: whether the instance draws instanced, in a run of how many and in how many draw calls, or why not. `perf.memory()` counts the slot of an instance in its bytes and the rest of the shared textures as shared.
  - The code is in the chunk of the mesh mode, which loads on demand. Nothing registers with Pixi at import: the pipe goes into a renderer when it first draws an instanced skeleton.

- [#16](https://github.com/schmooky/pixi-marrow/pull/16) [`04c36b8`](https://github.com/schmooky/pixi-marrow/commit/04c36b89b404b3799e176aeff6a21683532b18bc) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `lod: 'auto'` now leaves deform out too, below the same 96 pixels as physics. Every mesh of a skeleton drawn that small shows its setup vertices, and the deform timelines do not run. Both come back at 120 pixels.
  
  - The pose engines have a new switch, `engine.deform`. Set to false, it keeps every deform aside and shows none. Set back to true, the deforms come back and the next update applies the deform timelines again, also for a pose at rest. A slot that showed another attachment meanwhile loses its deform, as in the official runtime.
  - A deform switch or a physics mode `none` that the game set stays as the game set it.
  - Baked playback writes no deform while the switch is off.
  - `PacingStatus.physicsOff` is now `reduced`, because it covers deform as well. The `pacing` row of `perf.report()` says that physics and deform are left out.

- [#19](https://github.com/schmooky/pixi-marrow/pull/19) [`1a53040`](https://github.com/schmooky/pixi-marrow/commit/1a53040438b8533779f739ad23e264ce402a8a7b) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Outlines are off by default. A load reads no page image any more unless it asks. Pass the file that `pixi-marrow outlines` writes at build time as `outlines`, or set `outlines: 'auto'` to read the page images in idle time after the load. That scan draws every page into a canvas, 32 MB for a page of 2048 by 2048 for a moment, which a phone with little memory can fail on. Without outlines every region stays a quad and every slot is drawn, so the picture is the same and only the cuts of overdraw are gone.

- [#15](https://github.com/schmooky/pixi-marrow/pull/15) [`0085abe`](https://github.com/schmooky/pixi-marrow/commit/0085abef1ac9f114150b26763308277f61141979) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Performance presets and pacing: `perf: 'exact' | 'balanced' | 'fast'` sets several options at once, and each one is an option of its own too.
  
  - `exact` is the default and changes nothing. The presets set when a skeleton updates, and nothing else. `balanced` sets `offscreen: 'throttle'`. `fast` sets `offscreen: 'pause'` and `updateRate: 30` for batched skeletons. Baking, tight meshes, the idle cache, `lod` and instancing cost memory, vertices or draw calls in a way that depends on the device and the scene, so no preset sets them. Each is set by its own name.
  - A `perf` object starts from its `preset` and changes the settings it names. An option given by name wins over both. A preset or a value that does not exist throws a `MarrowError` with the closest valid name.
  - `offscreen: 'throttle'` updates a skeleton off the screen 4 times a second with the time that passed. `'pause'` stops its time until it is on the screen again. A skeleton is off the screen when its bounds lie outside the screen, or no render reached it for 2 updates and 0.1 seconds. `play`, `queue` and `stop` pose the gathered time first, so its events fire.
  - `updateRate` poses a skeleton at most that many times a second, with the time of the updates in between.
  - `lod: 'auto'` leaves physics out while a skeleton is drawn smaller than 96 pixels across, and resets physics when it grows to 120.
  - `perfSettings` holds the settings in effect, and `pacingStatus()` says how often the skeleton updates right now and why. The first two rows of `perf.report()` say the same.
  - The physics controls of `MarrowSpine` moved to a new base class, `SpinePhysics`. Nothing changes for a game that calls them.

- [#19](https://github.com/schmooky/pixi-marrow/pull/19) [`1a53040`](https://github.com/schmooky/pixi-marrow/commit/1a53040438b8533779f739ad23e264ce402a8a7b) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - pixi.js 8.21 or later is needed. The peer range of `pixi.js` is `^8.21.0`, and the checks no longer run on 8.16. The workarounds for the versions before 8.21 stay in the code for now, and nothing relies on them.

- [#13](https://github.com/schmooky/pixi-marrow/pull/13) [`b4c58c1`](https://github.com/schmooky/pixi-marrow/commit/b4c58c1a9ed4fecaf3fc924b1e08ba08cf960cae) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Several skins at once, a slot handle, the setup pose and point conversion on the display object.
  
  - `hero.skins = ['skin-base', 'hair/pink']` makes a list of skins active as one, as `Skin.addSkin` does in the official runtime. The later skin wins where two store an attachment under one slot and name. Instances of an asset share the combined skin, and one that no instance shows is freed after the 8 newest such.
  - `hero.slot(name)` gives a handle with `attachment`, `tint`, `alpha` and `darkTint`. A write stays until an animation keys the slot or the setup pose of the slots is set. Writing the value a slot has changes nothing, so a skeleton at rest stays at rest.
  - `hero.setupPose()` resets the bones and the slots, `'bones'` or `'slots'` one half.
  - `bone.localToWorld(point)` and `bone.worldToLocal(point)` take points between a bone and the skeleton.
  - The pose engines of `pixi-marrow/core` gain `setSkins`, `skins`, `slotPose`, `setAttachment`, `setColor` and `setDarkColor`. A parity family checks all of them against the official cores of 4.1, 4.2 and 4.3.

### Patch Changes

- [#16](https://github.com/schmooky/pixi-marrow/pull/16) [`2323edc`](https://github.com/schmooky/pixi-marrow/commit/2323edcf734f31ea2210c317ca4f5a108b12c040) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The idle cache draws its images in the batches of the batched mode, not as Pixi sprites. An image now shares a batch with the skeletons around it, so a grid where symbols at rest and in play take turns no longer breaks the batch at every image. In the reels of the site a frame of a win took 10 to 14 draw calls with the idle cache on, and now takes 3 or 4, as without it.

- [#21](https://github.com/schmooky/pixi-marrow/pull/21) [`39a5b31`](https://github.com/schmooky/pixi-marrow/commit/39a5b31f8e5418b5969177366c1bc36da8a0e61a) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The optional peer pixi-silk is `^1.0.2`. The debug overlays draw as before. pixi-silk 1.0.2 ends a drag of its transform gizmo on the release wherever it happens, which the playground of the site relied on a workaround for.

- [#20](https://github.com/schmooky/pixi-marrow/pull/20) [`639d15e`](https://github.com/schmooky/pixi-marrow/commit/639d15e5005f4a8809d0d0f4f76892bfb2719b6e) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The mesh mode draws more than about 2000 meshes in a frame on WebGPU. Pixi gives every mesh draw a slot of one uniform buffer per frame and threw once it was full, so 1200 instances of a rig with a clip failed. A mesh of pixi-marrow now takes a slot while the buffer has room for the rest of the scene, and binds a small uniform buffer of its own after that. That buffer is uploaded only when its transform, tint or rounding change. Other meshes are drawn by Pixi as before, and WebGL is unchanged.

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
