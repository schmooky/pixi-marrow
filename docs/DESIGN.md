# pixi-marrow design

Draft 3, 2026-11-11. A Spine runtime for PixiJS v8 with its own pose core and its own render path. It plays 4.1, 4.2 and 4.3 skeletons.

Change from draft 1: the runtime does not ship `spine-core`. The pose core is ours. The official cores are used in tests only, as the reference every frame is compared against.

Change from draft 2: memory is a goal of the same weight as speed (section 8.6). Milestone M0 is built.

Change with M1: the model is a faithful import with no conversion between versions (sections 5.2 and 10). Milestone M1 is built.

Change with M2b: the render path uses Pixi meshes with a custom geometry and shader, one mesh per draw range, not a custom render pipe (section 16). Additive slots leave the destination alpha untouched, so on a transparent target the alpha differs from the official runtime while the colors match.

Change with M2a: there are two pose engines, one for 4.1 and 4.2 and one for 4.3, because the official runtimes mix animations differently (section 5.3). Pose numbers are 64-bit and parity is exact, not within a tolerance (section 15). M2 is split into M2a, which is built, and M2b.

Change with M3: IK, transform and path constraints are solved in both engines, and clipping works through a stencil mask (sections 5.3, 7.5 and 10). Tight meshes turned out not to be exact to the bit, so they are an option and not the default (section 7.4). The overdraw cuts that are exact are on by default.

Change with M4: physics constraints and sliders are solved, so every constraint of the three versions is (sections 5.3 and 10). The option to ignore constraints is gone. The perf report loads on demand and is asynchronous (section 8.5). The A/B bench lives in this repository and runs on one desktop machine. Numbers per device class wait for spine-benchmark (section 16). That bench moved the batched render mode up: it is M5 now, before pose skipping (sections 7.2 and 16.1).

Change with M5: the batched render mode is built, and `renderMode: 'auto'` picks it for every skeleton of up to 1024 batch vertices (section 7.2). Clips are cut on the CPU in that mode, by a port of the official clipper (section 7.5). The static part of a layout is shared between the instances of an asset (section 8.6). The heap numbers of M4 were wrong and are corrected (section 16.1).

Change with M6: work follows change. A pose state carries a version and stamps per bone and slot. The engines skip what would repeat, and a view does only what a stamp asks for (sections 2, 5.3 and 7.3). A skeleton at rest costs close to nothing and uploads nothing. The mesh mode, the clip code and the cuts of overdraw load on demand (section 11). Sharing one pose between instances is not built, and neither is a keyframe cursor: section 2 says why.

Change after M6: the display object has bone handles, `follow` and `attach` (section 7.6), and there is a first docs site (section 13). The symbol rigs of a real slot game are fixtures now (section 15). A tree-shaken game could not use the mesh mode: that is fixed and has a check of its own (section 15).

This document is the plan. Every performance number in it is an estimate until the benchmark measures it. Section 0 lists what has been verified.

## 0. Verified facts this design rests on

| Fact | How it was checked |
|---|---|
| Three official `spine-core` versions (4.1.55, 4.2.106, 4.3.13) run side by side in one process | One Node process imported all three. Each loaded its own spineboy-pro export (`.json` and `.skel`) and posed 30 frames. Hip world position matched across versions. This is what makes one test process able to compare our core against all three. |
| The 4.3 core cannot read 4.2 files | 4.2.22 exports of spineboy and celestial-circus throw in `spine-core@4.3.13` for both `.json` and `.skel`. |
| Size of the official core without comments | 4.1: 9,287 lines. 4.2: 10,392. 4.3: 12,141. |
| Solvers barely changed from 4.1 to 4.2 | Changed lines: IK 56, transform constraint 37, path constraint 18. Physics is new in 4.2 (259 lines). |
| 4.2 to 4.3 is a restructure | Poses split from objects, constraints unified, sliders added. Most files differ in hundreds of lines. How much of that is changed math is not known yet. |
| The official core finds the current keyframe by a linear scan from the first key on every call | `Timeline.search` in 4.3.13. |
| 4.1 to 4.2 JSON is additive | Key diff of the two parsers: 4.2 adds physics keys, `inherit`, `referenceScale`. Nothing was removed. |
| 4.2 to 4.3 JSON is not | 4.3 drops `offsets`, `order`, `relative`, `uniform`. It adds a unified `constraints` list, sliders and generalized transform constraint properties. |
| The official binary readers ignore the offset of a typed array view | `new DataView(data.buffer)` in all three versions. A small file read in Node, which is a view into a pool, fails to load. |
| The official deform timeline packs Bezier curves with its own arithmetic | `DeformTimeline.setBezier` differs from `CurveTimeline.setBezier` in all three versions. Using the generic one changes floats in 168 of 246 deform curves of the 4.1 and 4.2 fixtures. |
| The official 4.1 JSON reader has a bug in transform constraint timelines | It never carries the shearY mix from key to key. Every key stores the first key's value. The importer reproduces it for 4.1 files. |
| The official 4.3 JSON and binary readers disagree on a slider with a bone | For `diamond-pro` the JSON reader leaves `max` at 0 and the binary reader stores 2. Each importer follows its own official reader. |
| The official 4.3 loader overwrites the size of a linked mesh with its parent's | `setSourceMesh`. In 4.1 and 4.2 a linked mesh keeps its own size. |
| The official atlas reader misreads a file that starts with an empty line and has header fields | The first loop treats `''` as "no line". The importer does not copy this. Real exports are not affected. |
| Pixi's batcher starts a new batch when the blend mode changes | `Batcher.mjs`: `breakRequired = blendMode !== adjustedBlendMode`. |
| The official Pixi runtime maps each slot blend mode to a Pixi blend mode | `SpinePipe.js` in 4.3.13. An additive slot between normal slots costs two extra batches. |
| The official Pixi runtime repacks every vertex attribute each animated frame | `updateRenderable` calls `updateElement` for every visible slot. |
| The official Pixi runtime runs a full pose and vertex pass every tick, even with nothing playing | `_updateAndApplyState` sets `_stateChanged` unconditionally (4.3.13). |
| It computes vertices for alpha 0 slots, and each visibility flip rebuilds the instructions | `transformAttachments` in 4.3.13. |

Not verified: anything in a browser, any timing, and behaviour on rigs other than the official examples.

## 1. Goals and non-goals

Goals, in priority order:

1. Correct playback of 4.1, 4.2 and 4.3 skeletons in one runtime, mixed in one scene.
2. Three render wins from the first usable release: less overdraw, fewer batch breaks, one premultiplied pipeline with additive in the same batch.
3. A pose core built for speed and low memory: typed arrays, no per-frame allocation, shared data stored once, work skipped when it cannot change the picture.
4. Optimizations that are on by default when they are exact, and one knob for the rest.
5. A small API that a person or an AI agent can use correctly from one page of docs.
6. Every performance claim backed by spine-benchmark.

Non-goals:

- Canvas 2D or WebGL1.
- Spine 3.8 and 4.0. The model can take more importers later.
- Editing or authoring skeletons.
- A runtime dependency on `spine-core`.

## 2. The pose core is ours

The runtime has two halves. The pose half turns time into bone transforms, slot colors, attachments and draw order. The render half turns a pose into pixels.

Decision: both halves are written here. Nothing from Esoteric ships in the package.

What the official cores are still used for, as dev dependencies only:

- Reference for pose: every bone, slot and event of every frame is compared against the official core of the file's own version.
- Reference for pixels: frames are compared against `spine-pixi-v8` for 4.2 and 4.3.
- Baseline for the benchmark A/B.

What an own core makes possible that a wrapped core does not:

| Item | Official core | Own core | Exact |
|---|---|---|---|
| Keyframe lookup | Linear scan from the first key on every call | The same scan. A cursor was measured in M6: a lookup scans 2.4 keys on average, the ceiling is 8.6 percent of an update on two animations, and a trial build was inside the noise. Not built. | |
| Data layout | One object per bone, slot, pose | Typed arrays. The renderer reads them directly, with no copy step. | Yes, within float tolerance |
| Allocation | The core mostly reuses its arrays. The Pixi layer allocates in places, for example a new clipper per bounds call. | None after warm-up, proven by a test | Yes |
| Constant timelines | Evaluated every frame | Since M6 an apply that would repeat the one before is left out: an entry past its end, or a clip whose timelines all hold one value. A constant timeline inside a clip that moves is still applied. | Yes |
| Bones that did not change | Every bone transformed every frame | Since M6 a bone is posed again only when its own pose, its parent or the placement of the skeleton changed. No bone is left out because nobody looks: the pose state is public and equals the official one in every number. | Yes |
| Timelines nobody needs | All applied | All applied while the pose changes, for the same reason. | |
| Path constraints | Curve lengths recomputed every frame | Since M6 a constraint with the bones it writes is left out while nothing it reads changed. A cache inside a path that moves was measured as not worth it: its inputs stay only when the whole group rests. | Yes |
| Many copies of one rig | One pose each | One pose each. Sharing is not built: it needs a clone of an engine with its track state, events fanned out to several objects and a fork on every command. The gain shows in a bench of identical instances and is small for a few dozen symbols. | |
| Baking | At run time through the engine | At build time in Node, from the same core | Yes |
| Worker or WASM later | Object graph, hard to move | Plain buffers, ready to share | Later |

Price:

- The core is the largest piece of work in the project. The official one is 9,000 to 12,000 lines per version.
- Every Spine release has to be ported.
- Correctness has to be proven, not assumed. Section 15 is the plan for that.
- Features arrive in stages. Until a feature is ported, a rig that uses it fails with a typed error that names the feature. It never plays wrong silently.

## 3. What changes versus the official Pixi runtime

| Area | Official `spine-pixi-v8` | pixi-marrow |
|---|---|---|
| Versions | One version per package, 4.2 or 4.3 | 4.1, 4.2, 4.3 together |
| Additive slots | New batch at every change of blend mode | Same batch as normal slots |
| Atlas pages | Batch by texture, up to the batcher limit | The same in batched mode. In mesh mode up to 8 pages in one draw per skeleton. |
| Vertex data | All attributes repacked each frame | UVs, indices and weights uploaded once. Positions only when needed. |
| Attachment or draw-order key | Full instruction rebuild | Index rewrite in place, in both modes. No instruction rebuild. |
| Rigid region attachments | Positions computed on CPU and uploaded | Placed in the vertex shader from bone matrices (GPU mode) |
| Hidden slots (alpha 0) | Left out of the batch, but their vertices are still computed, and each change of visibility rebuilds the instructions | Left out by an index rewrite. No vertex work, no rebuild. |
| Overdraw | Quads as authored | Invisible regions left out, covered slots skipped. Tight outlines as an option. |
| Clipping | CPU triangle clipping always, so vertex counts change every frame and the instructions are rebuilt | Batched mode: CPU clipping into a room of constant size, no rebuild. Mesh mode: stencil mask. |
| Idle skeleton | Full pose and vertex pass every tick | Sleeps: no pose work, no upload |
| Pose work | Every timeline and every bone, every frame | Only what can change the picture (section 2) |
| Setup | Extensions register on import | Nothing to call. First use registers. |
| Errors | Throws from deep inside the parser | Typed errors with cause, fix and valid names |
| Names | Plain strings | Plain strings, or generated literal types |

## 4. Architecture

```
file bytes
   |  sniff version
   v
Importer (JSON or binary, 4.1 | 4.2 | 4.3)
   |
   v
SkeletonModel  (immutable, typed arrays, shared by all instances)
   |                         \
   |  analyze                 \  build once
   v                           v
PoseProgram                 GeometryTemplate (static buffers)
(ordered ops for the           |
 active skins)                 |
   |                           |
   v                           |
PoseState  <-- AnimationPlayer (tracks, mixing, events)
(typed arrays per instance:    |
 local, world, slots, order)   |
   |                           |
   +----------> DrawPlan <-----+
                   |
              MarrowPipe  ->  Pixi renderer (WebGL2 or WebGPU)
```

Layers and the rule between them. A layer imports only from layers above it in this list.

| Layer | Folder | Knows about |
|---|---|---|
| base | `src/base` | Errors, typed-array helpers, math. No Pixi. |
| model | `src/model` | `SkeletonModel` and its tables |
| formats | `src/formats` | Importers. One module per format and version, loaded on demand. |
| pose | `src/pose` | Timelines, player, pose program, constraint kernels, skinning kernels |
| geometry | `src/geometry` | Templates, tight meshes, clipping |
| render | `src/render` | Pixi. The only place that imports `pixi.js` renderer internals. |
| api | `src/api` | `MarrowSpine`, handles, options |
| features | `src/bake`, `src/debug`, `src/perf`, `src/optimize` | Optional entry points |

`base`, `model`, `formats` and `pose` never import Pixi. They form `pixi-marrow/core`, which runs in Node. The rule is checked in CI.

## 5. Classes

### 5.1 Public (root import)

| Symbol | Kind | Responsibility |
|---|---|---|
| `MarrowSpine` | class, extends Pixi `ViewContainer` | The display object. Play, queue, skins, bones, slots, events, perf. |
| `MarrowAsset` | class | Model, atlas textures, geometry template and analysis flags. Shared by all instances. |
| `Track` | class | One playing or queued animation. Loop, speed, alpha, mix, promise for completion. |
| `Bone` | class | Read and write local transform, read world transform, convert points. Built after M6, points since the slot handle. |
| `Slot` | class | Attachment, tint, alpha and dark tint of one slot. Built after the first pre-release. A slot has no visibility of its own in Spine: no attachment or an alpha of 0 hides it. |
| `MarrowError` | class | `code`, message with cause and fix, `validNames` when a name was wrong. |
| `MarrowOptions`, `PlayOptions`, `PerfOptions`, `PerfReport`, `SkeletonInfo`, `MarrowNames` | types | Options and results. Literal unions, no numeric enums. |
| `registerMarrowAssets` | function | Optional: adds parsers to Pixi `Assets` for aliases, manifests, bundles and the output of AssetPack. `MarrowSpine.from` then takes the aliases and returns at once. |

Target: at most 20 exported symbols from the root.

### 5.2 Model and formats

Built in M1. The model is plain data described by interfaces, not classes. The importers are functions.

| Piece | Responsibility |
|---|---|
| `SkeletonModel` | Header plus the parts below. Immutable after import. A faithful import: a 4.1 file keeps its 4.1 fields. |
| `BoneTable` | Names, parent index, setup transform (7 floats per bone), inherit mode, length. One typed array per property. Parents come before children. |
| `SlotTable` | Names, bone index, setup color and dark color, setup attachment, blend mode, visibility. One typed array per property. |
| `SkinData` | Attachments sorted by slot and name, each with its data. Bones and constraints the skin turns on. |
| `AttachmentData` | Region, mesh, bounding box, path, point or clipping. Vertices and weights in the official encoding. A linked mesh holds a reference to its parent and no geometry. |
| `AttachmentRef` | Skin, slot and name. Attachments have no global index. |
| `ConstraintData` | One list for all constraints, each tagged with its type. Fields that exist for some versions only are optional. |
| `AnimationData`, `TimelineData` | Timelines in the order the official runtime applies them. `frames` and `curves` equal the official arrays bit for bit. |
| `AtlasModel` | Pages, plus regions as 11 integers each. Texture coordinates are not stored. |
| `sniffSkeleton` | Reads format and version from JSON or the binary header. |
| `importSkeleton` | Picks the reader for the format and version and loads it on demand. |
| `importJson42`, `importJson43` | JSON to model. 4.1 and 4.2 share one reader because 4.2 only adds keys. |
| `importBinary42`, `importBinary43` | Binary to model. 4.1 and 4.2 share helpers. Their byte layouts differ in most records. |
| `importAtlas` | Atlas text to `AtlasModel`. |
| `describeSkeleton` | Names, counts and features of a model as plain JSON. |
| `TimelineWriter`, `BinaryInput` | Shared by the readers. Each is tested bit for bit against the official class it mirrors. |

Limits of the model today: indices are 16-bit. A file with more than 32,767 bones or slots, or a mesh with more than 65,535 vertices, is rejected with a typed error.

### 5.3 Pose

Built in M2a, with constraints since M3 and M4:

| Piece | Responsibility |
|---|---|
| `PoseState` | Per instance, in typed arrays: local pose (7 numbers per bone), inherit mode, bone activity, world transforms (6 numbers per bone), slot colors and dark colors, sequence index, deform and draw order. The numbers are 64-bit. |
| `PoseEngine` | The interface of a pose engine. It mirrors the official `AnimationState` and `Skeleton` calls: tracks, queue, mixing, skins, setup pose, update, events. |
| `createPoseEngine` | Picks the engine for the model's version and loads it on demand. |
| `src/pose/legacy` | The engine for 4.1 and 4.2. Their differences are branches on the version. |
| `src/pose/v43` | The engine for 4.3. The official 4.3 runtime mixes animations with other arguments in every timeline, so it cannot share the 4.1 and 4.2 player. |
| `createAttachmentLookup`, `meshSource` | Find attachments by skin, slot and name, and the mesh that owns the geometry of a linked mesh. |

IK, transform and path constraints are solved since M3, physics constraints and sliders since M4. Each engine ports the solvers and the update order of its own official runtime, so there is no shared kernel with version modes. The 4.3 engine includes the generalized transform constraints, because 4.3 has no other kind.

Physics has state: the simulation of each constraint and the time of the skeleton. `engine.physics` is the official `Physics` argument: `update`, `pose`, `reset` or `none`. `physicsTranslate` and `physicsRotate` are the official calls of those names. `PoseState.yDown` is the official static `Skeleton.yDown`, which the official Pixi runtime turns on. It decides which way gravity pulls when a physics constraint rotates or scales a bone. That is apart from the scale of -1 that flips the pose. The display object sets both.

A slider of 4.3 applies an animation to the applied pose, not to the animated one. So a bone, a slot, a constraint or the draw order that a slider touches has two poses in the 4.3 engine. `PoseState` holds what is drawn: the applied values of slots and of the draw order, and the world transform of the applied bone pose. `local` stays the animated bone pose. A skeleton without sliders has one pose and pays nothing.

The official runtime is the specification, with its quirks. Three that the engines keep: a slider writes the animated pose of the extra slots that a deform timeline reaches through a linked mesh. A physics reset key inside a slider never fires. In 4.1 and 4.2 a gap in the order numbers of constraints drops the constraints after it.

Three rules of the update path, found by profiling in M3:

- Timelines are applied through a `switch` on a small operation number, not through one closure per timeline.
- No function on the update path takes or returns a fractional number. Time, alpha and sampled values go through one shared `Float64Array`, and kernels get indices. V8 puts a double on the heap when it crosses a call that is not inlined.
- A bone that is not turned skips its trigonometry. The cosine of 0 is 1 and the sine of 0 is 0, so the result is the same to the bit.

Measured on an Apple M4, in Node 24: the whole update of each rig's longest animation, against the official core doing the same work. The rows without physics were measured in M3 and did not move in M4.

| Engine | Rigs | Time, ours as a share of official |
|---|---|---|
| 4.3, rigs without physics or sliders | 19 | 27 to 97 percent |
| 4.3, rigs with physics or a slider | 6 | 67 to 92 percent |
| 4.1 and 4.2, rigs without physics | 8 | 80 to 99 percent |
| 4.2, rigs with physics | 4 | 77 to 88 percent |

An update that fires no event allocates nothing once V8 has optimized the path. The official cores allocate 17 to 8,359 bytes per update on the same rigs. The rigs nearest to the official time are bound by the same trigonometry calls: a physics step is mostly `cos`, `sin`, `atan2` and `pow`, which both runtimes call with the same arguments.

One step goes beyond the official code and stays exact. The official 4.2 runtime computes the applied transform of a bone after every physics constraint. The 4.2 engine does that only when a later bone update or constraint reads it. A test runs every physics fixture both ways and compares the world transforms to the bit.

Since M6 the engines skip what would repeat. What they tell a renderer is in the pose state:

- `version` rises in every update and command that changed something a renderer reads. `boneStamps`, `slotStamps` and `drawOrderStamp` hold the version at which each last changed. A stamp may move although the values stayed. A value never changes without its stamp. The parity suite checks that after every call of every script.
- An update that would repeat the one before runs no timeline: every entry is past its end or holds one value, and nothing mixes. Times, events and the skeleton time go on as in the official runtime. Such an update takes 27 to 70 nanoseconds, 0.3 to 7 percent of an update that plays.
- A bone is posed again only when its inputs changed. A constraint and the bones it writes form a group that runs whole when something it reads changed. When most bones move the engine stops looking for a while and poses everything, as before M6.
- Slot stamps are tight: a timeline that writes the value that is there does not stamp. On the fixtures 4 to 8 percent of the slots are stamped per update.
- Code that writes an array of the state itself raises the version or calls `touchPose`. The plain fields `x`, `y`, `scaleX`, `scaleY`, `yDown` and the wind and gravity directions need no call.

What it costs and what it does not reach:

- An animation that moves every bone pays for the stamps: 1 to 7 percent more engine time than in M5 on some rigs, 11 percent on the one rig with a slider. Animations that move little take up to 74 percent less (raptor-pro `gun-grab`, spineboy-pro `shoot`, tank-pro `shoot`).
- Physics in mode `update` does not rest. The official arithmetic almost never reaches a fixed point: the world goes still, the offsets and velocities keep changing in their last bits. An engine that parked it would differ. A physics group is skipped only when one more step gives the same bits, which happens for physics that was never disturbed. The stamps stay tight there, so the view rests while the engine works.
- The engines hold 5.7 percent more bytes per instance for the stamps and the notes of what changed.

Planned for the later milestones:

| Class | Responsibility |
|---|---|
| `AnimationPlayer` | Tracks, queue, mixing, hold logic, events. The counterpart of the official `AnimationState`. |
| `TrackState` | One entry: animation, times, loop, alpha, mix, timeline modes, keyframe cursors. |
| `TimelineKernels` | One function per timeline kind. Reads frames, writes into `PoseState`. |
| `PoseProgram` | The ordered list of operations for the active skins: transform a range of bones, solve one constraint. Compiled once, recompiled when skins or the needed set change. |
| `NeededSet` | Which bones and slots can affect the picture: animated, constrained, visible, or held by a handle. Stable for the length of an animation. |
| `IkKernel`, `TransformKernel`, `PathKernel`, `PhysicsKernel`, `SliderKernel` | Constraint math. A version mode selects older behaviour where the official solvers differ. |
| `SkinKernel` | World positions for region and mesh vertices from `PoseState`. |
| `EventQueue` | Preallocated ring of fired events. |

### 5.4 Geometry and render

| Class | Responsibility |
|---|---|
| `GeometryTemplate` | Static vertex ranges for every attachment the active skins can show: UVs, page id, slot id, bone ids, weights, rest positions. |
| `GeometryInstance` | Per-instance dynamic data: position buffer, bone matrix block, slot palette. |
| `GpuSkinner` | Uploads bone matrices. The vertex shader places vertices. |
| `SlotPalette` | Light and dark color per slot in a small data texture. A color key costs a few floats, not a vertex rewrite. |
| `DrawPlan` | Builds the index buffer in draw order and the list of draw ranges. Rebuilt only on attachment, draw-order or visibility change. |
| `MarrowPipe` | Pixi render pipe. Mesh mode draws ranges. Batched mode feeds `MarrowBatcher`. |
| `MarrowBatcher` | Pixi batcher for small skeletons, with the premultiplied shader. |
| `MarrowShader` | One program, GLSL and WGSL. Multi-page sampling, optional dark tint, additive through alpha. |
| `ClipCpu`, `ClipStencil` | Two clipping strategies behind one interface. |
| `TightMesher` | Builds a tight outline for a region from its alpha. Used by the optimizer and at load time. |
| `OcclusionIndex` | Opaque inner shapes per attachment. Answers whether a slot is fully covered. |

Built so far, under other names: `SkeletonView` with its template, ranges and shader (M2b). Clip masks, `AtlasOutlines` with `buildAtlasOutlines`, and the covered-slot test (M3). There is one clipping strategy, the stencil mask.

### 5.5 Control and features

| Class | Responsibility |
|---|---|
| `SleepController` | Decides when an instance needs no update. |
| `Optimizer` | Chooses a strategy for each feature from the model analysis, the device and the options. Records the reason. |
| `Baker`, `BakedClip`, `BakedPlayer` | Sample an animation into a pose texture and play it without the pose core. |
| `InstanceGroup` | Draws many instances of one asset in one call. |
| `PerfProbe` | Timers and counters per bucket for spine-benchmark. Built in M4: `createProbe` of `pixi-marrow/perf`. |

## 6. Life of a frame

Load, once per asset:

1. Sniff the version. Import the matching importer module.
2. Import skeleton and atlas into a `SkeletonModel`. Fold constant timelines.
3. Build `GeometryTemplate`. Apply tight meshes from a sidecar file if one exists.
4. Analyze: weighted vertices, clipping, physics, deform keys, dark tint, blend modes, bake eligibility per animation.
5. `Optimizer` picks strategies. Cache the asset by URL.

Each tick, per instance:

1. Sleep check. Nothing playing, physics at rest, no handle written: skip to step 6.
2. `AnimationPlayer` advances tracks and applies the timelines that are needed.
3. `PoseProgram` runs: bone ranges and constraints in order. World matrices land in `PoseState`. Change flags are set as values are written.
4. Skin. GPU mode uploads the bone matrix block as it is. CPU mode writes positions for weighted or deformed ranges only.
5. If attachments, draw order or visibility changed: rebuild the index buffer. Nothing else.
6. Pixi asks the pipe to validate. The answer is "no rebuild" unless the skin set changed.
7. Draw. One call per range.

Baked animations replace steps 2 to 4 with one number: the clip time.

## 7. Render path

### 7.1 One premultiplied pipeline

- Every texture is premultiplied on the GPU. Straight atlases are premultiplied on upload. Premultiplied atlases are used as they are.
- One blend state for normal and additive: source `ONE`, destination `ONE_MINUS_SRC_ALPHA`.
- The shader multiplies color by alpha. For an additive slot it then writes alpha 0, which makes the same blend state add.
- Multiply and screen need a different blend state. They start a new draw range. The perf report counts them.
- Test: the same rig exported straight and premultiplied must render the same pixels within tolerance.

### 7.2 Two render modes

Both are built, the batched mode in M5.

| Mode | For | Draw calls | Vertices are placed |
|---|---|---|---|
| batched | Skeletons of up to 1024 batch vertices | Shared with the other pixi-marrow skeletons of the render group | On the CPU, into the buffer of the batch |
| mesh | Larger skeletons | One per draw range of every instance | In the vertex shader |

`renderMode: 'auto'` is the default. It picks the batched mode when the skeleton needs at most 1024 vertices in a batch and the renderer can sample the pages of a run. `mesh` and `batched` force one side. The property can change at run time. `await spine.perf.report()` names the mode and the reason: `small`, `large`, `limit` or `option`.

How the batched mode works:

- Two batchers of our own, one with dark tint, feed Pixi's batch pipe. They carry the premultiplied pipeline of 7.1: normal and additive slots share a batch, multiply and screen break it. A skeleton without dark colors joins an open batch with dark tint.
- A skeleton is one element per run of slots that share a blend state and a group of up to 16 pages. An element has a constant size: every slot has room for its largest attachment, and unused indices are degenerate triangles.
- So a change of draw order, visibility, attachment or color rewrites data in place. Pixi does not rebuild the instructions of the render group. Pixi's own batcher packs indices only when a batch is built, which is why the batcher is ours. The official runtime rebuilds on most frames.
- An instance holds no Pixi mesh, geometry, buffer or shader. It holds one view container and its elements.
- Nothing is registered at import. The pipe installs itself into a renderer at the first render of a skeleton, and the batchers are registered then.

Why 1024: on WebGL2 on the bench machine a batch saves about 2.7 microseconds per instance and costs about 5 nanoseconds per vertex, which crosses near 570 vertices. On WebGPU the batched frame takes 0.64 to 0.76 of the mesh frame from 44 to 819 vertices. A draw call costs more on a phone than on this desktop, so the limit sits above the WebGL2 crossover. The rig raptor-pro has 667 vertices. It pays 3 percent of frame time for the limit on WebGL2 and gains 27 percent on WebGPU.

Limits, stated:

- A Pixi object between two skeletons in draw order breaks our batch. It does not break the batch of the official runtime, which uses Pixi's default batcher.
- The two modes are not equal to the bit, because one places vertices in 64-bit on the CPU and the other in 32-bit on the GPU. Each passes the pixel check against the official runtime. Against each other they differ by 5 levels at most, on 0.006 percent of pixels by more than 1.
- Mesh mode on WebGPU fails above 2047 mesh draws in a frame: Pixi's uniform buffer batch is full then. The batched mode has no such limit.
- A skeleton can grow its room, which rebuilds the instructions once. A clipped animation settles within its first turn.

The batched mode relies on these parts inside Pixi, checked against the source of 8.16.0 and 8.23.0. The `Batcher` base class and the fields of a batch element. `renderPipes.batch` and the protocol of a render pipe. `Container.onRender` and `ViewContainer`. The bind layout of the batch adaptors and `renderer.limits.maxBatchableTextures`. The official runtime builds on the same parts.

Both modes rely on two more parts for a lost context, see 8.7. The `prerender` runner of a renderer. `Container.isRenderable`, which Pixi's mesh pipe asks right before it draws a mesh.

### 7.3 Stable plan

The template holds a vertex range for every attachment that can appear in the active skins. Showing, hiding or reordering slots changes which ranges the index buffer points at. Vertex data does not move. A skin change extends or rebuilds the template.

Limit: a skin set with thousands of alternative attachments makes a large template. The template covers active skins only.

Since M6 a view follows the stamps of the pose state (section 5.3):

- The version is the one the view saw: `update` returns at once. No vertex, no color, no pack, no upload, and Pixi is not told that anything changed. That costs 13 nanoseconds per instance.
- A slot is placed again when it or one of its bones has a newer stamp. A weighted mesh keeps the list of its bones for that test. Colors are written for newer slots only. The visible list is made again for a newer draw order, another attachment or an alpha that reached or left zero.
- Uploads follow: only buffers that changed, and from pixi.js 8.23 only the stretch that changed. In a batch that is the stretch of the slots that moved. Pixi's own batcher uploads the whole buffer of a batch when one element changed.
- A move of the display object alone places no vertex again in skeleton space.

For 200 instances at rest the update takes 0.02 ms. In M5 it took 52 to 95 percent of the update while playing, and up to 1.3 MB went to the GPU per frame for an unchanged picture.

Found on the way: a draw range counted on zeros behind its last index, and those did not always reach the GPU. On pixi.js before 8.20, which draws the whole index buffer, the mesh mode drew stale triangles after a skin change or after two updates between two draws. Each range now knows how far the GPU copy can hold something other than zero.

### 7.4 Overdraw

1. Hidden slots are never drawn: alpha 0, no attachment, inactive bone. Always on.
2. Invisible regions: a region attachment whose atlas region shows no pixel is not drawn. Exact. On by default.
3. Covered slots: a slot fully inside the opaque rectangle of a later slot is skipped. Exact. On by default.
4. Tight meshes: a region quad becomes a convex polygon of at most 8 vertices around its visible pixels. Fewer shaded pixels, more vertices. Not exact to the bit, so it is an option: `tightMesh: 'on'`.
5. Later, experimental: an opaque pass with depth test. Not promised for version 1.

Outlines and opaque rectangles come from the atlas pixels, as `AtlasOutlines`. Three sources: a sidecar file written by `pixi-marrow outlines`, an object, or a scan of the page textures in idle time after the load. The scan reads a premultiplied page through a WebGL context, because a 2D canvas loses color under alpha 0, and that color adds light. A page that cannot be read keeps its quads.

Built in M3. What was measured on the 34 example rigs of the pixel check:

| Cut | Triangle area drawn | Picture against no cuts |
|---|---|---|
| Invisible regions and covered slots | 100.0 percent. Covered slots appear in one rig. | Equal, every pixel of 384 frames |
| Tight meshes | 90.5 percent, per rig 80.6 to 96.8 | At most 0.08 percent of pixels off by more than 1 of 255 levels |

Why tight meshes are not exact: a GPU interpolates texture coordinates per triangle, from corners it has moved to its subpixel grid. Other triangles give other last bits. The same quad split along its other diagonal already changes up to 12.5 percent of its pixels by one level. A pixel on the outer edge of a region can also fall to the other side of that edge. One or two pixels per frame do, by up to 53 levels measured. The pixel check bounds both effects for `tightMesh: 'on'`.

The example rigs are mostly meshes, which no outline touches, and their artists left little hidden art. Rigs made of large regions gain more: the regions of the dragon alone lose 78 percent of their area. The default stays exact until the benchmark shows on devices what the polygons buy.

When a cut is off:

- A page keeps its quads when its texture differs from the atlas page in pixel size, has mipmaps or anisotropic filtering, or repeats where the page does not. The one pixel margin of an outline holds for bilinear filtering at full size only.
- Sequences and meshes keep their geometry.
- An occluder is a region attachment with normal blending and alpha 255, outside every clip, among the 4 largest opaque rectangles.
- Covered slots are drawn again in the frame in which any alpha from the object up to the stage is not 1. That is checked again at draw time, after every user callback has run.
- A view drawn with pixel rounding or to a multisampled target uses no cuts.

Cost: the search for covered slots backs off while it finds nothing, from every 4th to every 64th frame. It then costs under 3 percent of the view update. Building outlines takes 7 to 28 ms per megapixel of page. In Chrome a one-page atlas has its outlines 17 to 33 ms after the load.

### 7.5 Clipping

Built in M3 with one strategy, the stencil mask. The slots a clip cuts draw inside a Pixi container whose mask is a mesh of the clip polygon. The polygon is placed and shaped each update as the official `SkeletonClipping` of the file's version does it, and triangulated by a port of the official ear clipping.

| | |
|---|---|
| Cost per clip that cuts a visible slot | Two mask draws, one small upload per update, and one draw range per blend or page stretch inside |
| Cost without a clip | None: the same meshes, buffers and draw calls |
| Picture | Clipped frames match the official runtime within 2 of 255 levels, at three picture sizes |
| Not exact | A clip polygon that crosses itself. The official clipper and a stencil mask disagree about such a shape. |

Built in M5, the second strategy: in batched mode a clip is cut on the CPU, because a mask breaks every batch. The kernel in `src/geometry/clip-triangles.ts` is a port of the official `SkeletonClipping` of each version. Its output equals the official one to the bit, on every clipped fixture and on 27,000 random cases per version. It is 2.3 to 5 times as fast as the official clipper per triangle.

- A verdict per slot comes first: nothing is left, the slot is whole, or it is cut. A whole slot draws with its shared vertices. Only a cut slot runs the clipper. On spineboy-pro 214 of 216 slots inside a clip need no cut.
- Cut vertices go into a room behind the rooms of the slots. The room is a high-water mark per model, so vertex counts that change every frame rebuild nothing once the room has settled.
- The clip polygon of a region without weights or deform is triangulated once per attachment, not once per pose. That was 64 percent of the update of coin-pro.
- The kernel loads on demand, with an asset that has a clipping attachment.
- The picture: clipped frames in batched mode equal the official runtime in every pixel. The stencil path is within 1 level.

The rules that differ between versions, all ported: 4.3 can use a convex polygon whole, can replace a concave one by its hull, and can keep the outside (`inverse`). In 4.3 an end slot that shows a clip ends the active clip and starts the new one. In 4.2 the first clip then runs to the end of the draw order.

### 7.6 Objects attached to slots

Built after M6, for games that put their own Pixi objects into a rig.

- `hero.bone(name)` is the handle of a bone. `x`, `y`, `rotation`, `scaleX` and `scaleY` are the pose next to the parent bone, as the Spine editor shows it, and can be written. `worldX`, `worldY`, `worldRotation` and `worldMatrix()` say where the bone is in the space of the display object after the last update. A write takes effect with the next update and stays until an animation that keys the bone writes it again, as in the official runtime.
- `hero.follow(bone, container)`: the container gets the transform of the bone after every update, in the space of the display object, so it belongs inside it. It stays where it is in the display list. It costs no draw call.
- `hero.attach(slot, container)`: the container becomes a part of the skeleton, drawn at the place of the slot in the draw order, after the attachment of that slot. It moves with the bone of the slot and its alpha is that of the slot. `followAttachment` hides it while the slot is empty, `followColor` tints it. It mirrors `addSlotObject` of the official runtime. A slot holds one container. A clip does not clip it.
- Cost of `attach`: one more draw call per container that is drawn, in both render modes, because a foreign object ends a batch. A draw order key that moves slots across an attached slot rewrites indices and rebuilds nothing. The official runtime rebuilds 15 times in the scene that measures this.
- A skeleton at rest with containers still rests: a container moves only when the stamp of its bone is newer.
- The code that draws attached containers is a chunk of 1.4 kB that loads with the first `attach` of a page. The container is hidden for a frame or two until then.

## 8. Optimizations

### 8.1 Always on (exact, no option)

Render:

- Premultiplied pipeline with additive in the same batch
- Atlas pages in one draw
- Static UVs, indices and weights
- Stable plan
- Hidden slots left out
- Dark tint only for skeletons that use it

Pose:

- An apply that would repeat the one before is left out (M6)
- A bone is posed again only when its own pose, its parent or the placement of the skeleton changed (M6)
- A constraint and the bones it writes are left out while nothing it reads changed (M6)
- Sleep when idle: a view whose pose version did not change places, colors and uploads nothing (M6)
- No allocation per update after warm-up
- One model shared by all instances

Planned here and not built, each with its measurement in section 2: keyframe cursors, constant timelines folded at load, and leaving out bones or timelines that nobody reads. The pose state is public and must equal the official one in every number.

Each item is held by a check. Pose parity is exact, with the stamp check after every call. A test proves that an update allocates nothing. The pixel check compares both render modes with the official runtime.

### 8.2 Automatic with override

`auto` is the default. The override forces one side.

| Option | Values | `auto` decides by | Exact |
|---|---|---|---|
| `renderMode` | `auto`, `mesh`, `batched` | Batch vertices of the skeleton: up to 1024 is batched | Within the pixel check. The modes differ in rare pixels, see 7.2. |
| `tightMesh` | `auto`, `on`, `off` | `auto` drops regions without a visible pixel. `on` is opt-in, see 8.3. | Yes for `auto` |
| `occlusion` | `auto`, `off` | Opaque rectangles present, the 4 largest occluders, world area of at least 1024 | Yes |

Planned and not built yet: `skinning` (`auto`, `cpu`, `gpu`) comes with GPU skinning in M7, and `instancing` with baked clips in M8. `sharedPose` was measured in M6 and not built, see section 2.

### 8.3 Opt-in (changes timing, memory or look)

Only `tightMesh: 'on'` is built. `bake` and `offscreen` come with M8 and the `balanced` preset. `idleCache`, `updateRate` and `lod` come with M9 and the `fast` preset.

| Option | Values | Trade |
|---|---|---|
| `tightMesh: 'on'` | | Regions drawn as polygons around their visible pixels. Less fill, more vertices. Some pixels move by 1 of 255 levels, a few edge pixels by more (section 7.4). |
| `bake` | `off`, `auto`, list of animations | No pose cost. Loses long mixes and runtime bone control on baked clips. `auto` bakes only eligible animations: no physics, no handle writes, no layered tracks. |
| `idleCache` | `off`, `auto` | Idle skeleton drawn as one quad. Uses texture memory. |
| `offscreen` | `update`, `throttle`, `pause` | Less work off screen. Events fire late or not at all while paused. |
| `updateRate` | `display` or a number of Hz | Fewer pose updates. Motion steps at low rates. |
| `lod` | `off`, `auto` | Drops physics and deform below an on-screen size. Visible on close inspection. |

### 8.4 One knob

`perf: 'exact' | 'balanced' | 'fast'`, or a `PerfOptions` object that starts from a preset. Not built yet. `balanced` comes with M8 and `fast` with M9. A skeleton today does what `exact` describes.

| Preset | Sets |
|---|---|
| `exact` (default) | Everything in 8.1 and 8.2. Nothing from 8.3. |
| `balanced` | `exact` plus `tightMesh: 'on'`, `bake: 'auto'`, `idleCache: 'auto'`, `offscreen: 'throttle'` |
| `fast` | `balanced` plus `lod: 'auto'`, `offscreen: 'pause'`, `updateRate: 30` for small skeletons |

### 8.5 The report

`await spine.perf.report()` returns every decision the runtime made for one instance, with its reason and the counters behind it:

```ts
[
  { feature: 'drawCalls', value: '3', reason: '3 draw ranges: a range ends where the blend state, the group of 8 pages or the clip changes' },
  { feature: 'blend', value: '2 extra ranges', reason: 'slots "glow", "fx" use screen' },
  { feature: 'tightMesh', value: 'off', reason: 'the option tightMesh is "auto": regions keep their quads' },
  { feature: 'occlusion', value: '1 covered slot', reason: 'slot "small" lies behind the opaque part of a later slot and adds no index. The layout has 2 opaque rectangles' },
  { feature: 'outlines', value: 'scanning', reason: 'the page images are being read in idle time' },
]
```

Built in M4 with 15 rows: draw calls, blend ranges, pages, clipping, tight meshes, covered slots, outlines, dark tint, physics, constraints by kind, bones, slots, vertices, uploads and the layout. Every reason is read from the state of the instance when the call resolves. The rows about skinning mode, active bones and baking wait for the milestones that build those.

The report and `spine.perf.memory()` are asynchronous. Their code is 4.4 kB gzipped and most games never call it, so it loads at the first call and not with the root import.

`createProbe(spine)` from `pixi-marrow/perf` times every update of one instance in three buckets: the pose, the geometry and the events. It also counts what the renderer did. Without a probe an update pays one check of a field.

This is the main tool for people and for agents: no guessing why something is slow.

### 8.6 Memory

Memory is a goal of the same weight as speed. These rules apply to every milestone.

| Rule | Effect |
|---|---|
| One model per asset | Bones, slots, attachments, animations and names are stored once, however many instances exist. |
| Static GPU buffers per asset | In mesh mode all instances of an asset share UVs, indices, weights and rest positions. An instance adds bone matrices and a slot palette. |
| Per-instance state in typed arrays | No object per bone or slot. The byte size of an instance follows from its counts. |
| Narrow types | 16-bit indices and ids where counts allow, 8-bit flags, 32-bit floats. |
| Allocate on first use | The deform pool exists only when an animation deforms. Physics state exists only with physics. Dark colors exist only when the rig uses them. |
| No copies during import | The binary importer writes straight into the tables. Parsed JSON is released after import. |
| Templates follow the active skins | Geometry for skins that are not active is not built. It is freed when a skin is removed. |
| Shared scratch buffers | Kernels use one set of scratch arrays, not one per instance. |
| Textures | No CPU copy is kept after upload. Compressed formats pass through. Pages are released with the last asset that uses them. |
| Baked clips | Only bones that move are stored. |

Measured, not assumed:

- `await spine.perf.memory()` reports bytes shared per asset, bytes per instance and GPU bytes, built in M4. It counts typed arrays, GPU buffers and page textures, not JavaScript objects.
- A memory baseline in `ci/` works like the size baseline. Growth of more than 10 percent in bytes per instance on the fixtures fails the build.
- Since M3 the baseline counts `engine.bytes`: the pose state and what constraints add to an instance. A constrained bone costs 56 bytes more in 4.1 and 4.2 and 104 bytes more in 4.3. A skeleton without solved constraints pays nothing for them. Of the 104 bytes, 48 keep the world transform that a bone shows between a skin change and the next update equal to the official one. Cutting it turned out not to be exact: an active bone under an inactive parent reads the stale world transform of that parent.
- Since M4 the baseline also counts physics and slider state. A physics constraint adds 144 bytes to an instance in 4.2 and 180 in 4.3. A skeleton without physics or sliders pays nothing. The baseline is 1,530,600 bytes for one instance of each of the 114 fixtures, 6.6 percent above M3, all of it on the 20 files with physics or a slider.
- The lookup of attachments by skin, slot and name is built once per model since M4. Before, every drawn instance built its own.
- Since M5 the static arrays of a layout are shared by the instances of a model, skin and set of cuts. One view shader serves every view of the same pages, and one mask shader every mask. tank-pro in mesh mode went from 188 to 131 KB per instance. An instance of coin-pro went from 33 to 16.5 KB.
- The bench reads the heap on a fresh page per reading since M5, twice in opposite order. The two readings differ by 0.4 percent at most.
- The spine-benchmark A/B reports heap and GPU memory next to frame time.

### 8.7 A WebGL context that is lost and restored

A browser can take the WebGL context of a page away and give it back. Safari on iOS does that to tabs in the background. Pixi keeps its `Application` alive and makes its GPU resources again when the context is back. The runtime follows two rules.

- It does nothing for its buffers, and that is enough. After a restore Pixi gives every buffer a new GPU buffer, and a new one uploads its whole array at its first draw. The arrays in memory are complete at every moment. So the stretches that wait for an upload, the reach of an index range and the skip for an unchanged pose stay right. A skeleton at rest comes back without an upload of its own.
- It draws no skeleton while the context is lost. Pixi cannot compile a program that it first uses without a context. Version 8.16 of pixi.js throws out of the render then. Version 8.23 logs the error and never sets the uniforms of that program again. What draws with it stays invisible after the restore. The shaders of the runtime are made on demand, so a skeleton that first appears while the context is away brings such a program. The pipe of the batched mode runs no batch then, and the meshes of the mesh mode say that they are not renderable. The first draw with the new context compiles the programs.

Cost: a renderer asks its context once per render, not once per skeleton. The root import grew by 107 bytes to 28.99 kB gzip. Measured with `pnpm bench:ab --scene=rest` on the bench machine, 200 instances on WebGL2, the build before against the build after. In the mesh mode the update takes 0.025 to 0.040 ms on both builds. The CPU part of a frame takes 0.090 to 0.330 ms, equal within one step of the clock, which is 0.005 ms. In the batched mode the update takes 0.020 to 0.050 ms on both builds, and they differ by less than the runs of one build do. No run uploads a byte.

The last step of `pnpm check:render` measures the picture, see `scripts/render/restore-check.mjs`. Nine cases run in both modes on pixi.js 8.16.0 and 8.23.0, in Chrome on WebGL2. Five cases rest or play: a skeleton at rest, one that plays, a clip at rest, a clip that plays, and eight instances of one asset. Two have attached containers, at rest and playing. Two have a skeleton that is first drawn without a context. Every pixel of five frames after the restore equals a run that kept its context. Without the second rule the last two cases fail on both versions, and the other seven pass.

Not covered: the loss of a WebGPU device, real phones, and display objects of Pixi's own that are first drawn without a context. Those have the same trouble inside Pixi.

## 9. Public API sketch

```ts
import { MarrowSpine } from 'pixi-marrow';

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
app.stage.addChild(hero);

hero.play('idle', { loop: true });
const shot = hero.play('shoot', { track: 1 });
await shot.finished;
hero.queue('run', { loop: true, mix: 0.2 });

hero.skins = ['base', 'armor'];
hero.on('event', (e) => console.log(e.name, e.track.animation));

const gun = hero.bone('gun');
gun.rotation += 10;
hero.follow('gun', muzzleFlash);

hero.physicsTranslate(dx, dy);
console.table(await hero.perf.report());
```

Rules the API follows:

- Options objects, no positional booleans. `play('run', { loop: true })`, not `setAnimation(0, 'run', true)`.
- Spine vocabulary is kept: track, skin, slot, bone, event, mix. Agents and animators already know it.
- A wrong name throws `MarrowError` with the valid names and the closest match.
- Every feature of the three versions is ported since M4. A file that names something its version does not have, such as physics in 4.1, throws `MarrowError` with code `unsupported-feature`.
- Play options are checked before anything plays: a wrong type or an unknown key throws and the track stays as it was.
- The common track options have plain names: `loop`, `mix`, `speed`, `alpha`, `reverse`, `additive`, `start`, `end`. The rest of the official `TrackEntry` is reachable by its official names through `entry` and `track.configure`.
- No required setup call. No import for side effects.
- `hero.info` returns a JSON description: version, bones, slots, skins, animations with duration and flags, events, features used.

Typed names, optional:

```bash
npx pixi-marrow typegen hero.skel --out hero.names.ts
```

```ts
import type { HeroNames } from './hero.names';
const hero = await MarrowSpine.load<HeroNames>({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
hero.play('idel'); // compile error
```

## 10. Version support

One model type for all versions. It is a faithful import, not a conversion: a 4.1 or 4.2 file keeps its own constraint fields, and the fields that exist for some versions only are optional. An older constraint does not run on the 4.3 kernel. That was decided in M3: each engine has its own solvers.

| Feature | 4.1 | 4.2 | 4.3 | Lands in |
|---|---|---|---|---|
| Bones, slots, skins, region and mesh attachments, deform, sequences | yes | yes | yes | M2, built |
| Tracks, queue, mixing, events | yes | yes | yes | M2, built |
| IK, transform and path constraints, clipping | yes | yes | yes | M3, built |
| Generalized transform constraints | no | no | yes | M3, built |
| Physics | no | yes | yes | M4, built |
| Sliders | no | no | yes | M4, built |
| Additive tracks and the remaining track options | yes | yes | yes | M4, built |

The first draft planned one kernel per constraint with a version mode for older behaviour. The official solvers differ in too many small places for that: guards, comparisons of squares against lengths, rotation wrapping, the inherit modes in the applied transform, the sort of path bones. Exact parity is simpler to keep with one port per engine, where 4.1 and 4.2 differ by branches on the version.

## 11. Package shape

One package. Few entry points. No runtime dependencies.

| Import | Holds |
|---|---|
| `pixi-marrow` | Load, play, render, perf report |
| `pixi-marrow/core` | Model, importers and pose without Pixi. Runs in Node. Used by the optimizer, by spine-benchmark and by tests. |
| `pixi-marrow/bake` | Baked playback and instancing |
| `pixi-marrow/debug` | Bone, mesh, bounds and overdraw overlays. Optional peer: `pixi-silk`. |
| `pixi-marrow/perf` | Probes and cost buckets for spine-benchmark |
| `pixi-marrow/optimize` | Node API and CLI: tight meshes, sidecar files, typegen, reports |

Peer: `pixi.js`. Dev dependencies only: the three official cores and `spine-pixi-v8`, under npm aliases.

Importers are separate modules loaded by version, so a game that ships 4.3 binary files does not carry the JSON or 4.1 readers. Since the bone handles the root import is 28.9 kB gzipped: handles and `follow` must work at once and weigh 2 kB. In M6 it was 26.9 kB, from 31.1 kB in M5. The limit the bench checks went from 27 to 29 kB for that.

The support for Pixi `Assets` came with the first pre-release. `registerMarrowAssets` adds the parsers, because nothing is registered at import. The code that reads `Assets` hangs off that call, so a game that never makes it carries 0.2 kB of the support. A game that imports `MarrowSpine` alone has a root import of 29.2 kB, one that also registers the parsers 30.3 kB. The limit the bench checks was 30 kB then, for the first of the two. The slot handle, several skins, the setup pose and the point conversion of a bone came after it. They must work at once, so they are in the root import: 1.2 kB, to 30.4 kB. The code that combines skins, counts who shows them and frees the unused ones loads with the pose engines. The limit is now 31 kB. Three parts load on demand. The mesh mode (5.2 kB) loads with an asset that `auto` draws with meshes or that asks for them. The clip code (7.3 kB) loads with an asset that has a clipping attachment. The cuts of overdraw (2.6 kB) load with the outlines. An instance that asks for the mesh mode before its chunk is there draws batched until it arrives. The two pose engines grew with the skipping, from 47.8 to 58.4 kB on demand for both together. A game loads one of them. Size budget for the root import with one importer: 60 KB gzipped. It is a target to confirm at M2, checked in CI after that.

## 12. Repo setup, compared with pixi-silk

Measured on pixi-silk today. Docs: 33 guide pages with 27,700 words, `llms-full.txt` with 34,800 words, 9 skills with 7,500 words. Code: about 40 entry points, 30 test files in a node environment, a largest source file of 2,520 lines. Casts: 4 `any` and 9 `as unknown as` in 36,000 lines.

| Topic | pixi-silk | pixi-marrow |
|---|---|---|
| pnpm workspace, Biome, tsdown, TypeScript 7, Vitest 5, changesets, commitlint, husky | yes | Keep as is |
| publint, arethetypeswrong, size baseline, publish-contents check, prose check | yes | Keep as is |
| TypeScript strictness | `strict` plus unused and override checks | Add `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Kernel files with hot typed-array loops are a separate project without the first flag. |
| File size | Up to 2,520 lines | Limit of 500 lines per source file, checked |
| Layer rules | By convention | Import rules between layers checked in CI |
| Public API | Typedoc pages | Add an API snapshot file. Any change to the public surface shows in the pull request diff. |
| Dead code | Not checked | `knip` in CI |
| Coverage | No threshold found | Threshold on non-kernel code. Kernels are covered by parity tests. |
| Render checks | Playwright script, referenced only by the Windows workflow | Pixel parity on every pull request, WebGL2 and WebGPU |
| Entry points | About 40, listed by hand in the build config | At most 8, generated from `package.json` exports |
| Shared facts | `facts.mjs` plus a check that copies match | Generate README table, llms files and skill sections from one facts file. The check is a diff of generated output. |
| Docs size | No budget | Word budgets per page and per llms file, checked |
| Skills | 9 | 2 |
| Bench | Local script | Cost numbers come from spine-benchmark. A small bench in CI guards against regressions only. |

## 13. Docs plan

Budget: at most 10 guide pages and 6,000 words in total. Each page has one runnable example and at most one table.

1. Start: install, load, play
2. Animations: tracks, queue, mix, events
3. Skins and attachments
4. Bones and slots: handles, follow, attach
5. Performance: what is automatic, the presets, the report
6. Baking and instancing
7. Optimizer and sidecar files
8. Debug overlays
9. Versions and limits
10. Moving from `spine-pixi-v8`: one mapping table

Built after M6: a first site in `apps/site`, far below this plan on purpose. Astro and MDX, five pages and about 1,500 words: home, start, bones and placeholders, skins and slots, good to know. Two live previews show the bee of the slot game Bzzz: one plays its animations, one has a shape attached to a slot and a mark that follows a bone. Every code block is a region of a file that is type-checked against the built package. There is no API reference, no search and no deploy yet. `pnpm site:dev` and `pnpm site:build` run it.

The API reference is generated from TSDoc. Every public symbol has a one-line summary and an `@example`. No hand-written API prose.

Every code block in the docs is a file under `examples/`. The file is type-checked and run in the render check. A doc cannot show code that does not work.

## 14. AI experience

| Item | What it gives an agent |
|---|---|
| `llms.txt`, at most 500 words | Index and the ten facts models get wrong |
| `llms-full.txt`, at most 8,000 words | The whole manual in one read |
| Two skills shipped in the npm package: use, and migrate from `spine-pixi-v8` | Works offline from `node_modules` |
| Small surface, one way per task | Fewer wrong guesses |
| `MarrowError` with code, fix and valid names | The agent can repair its own mistake in one step |
| `hero.info` and `await hero.perf.report()` as JSON | Inspect, do not guess |
| `typegen` | Wrong names fail at compile time |
| `pixi-marrow/core` in Node: load, pose and geometry without a GPU | An agent can test its code without a browser |
| Mapping table from the official API | Uses what models already know |
| Error code page, one line each | Lookup by code |
| `AGENTS.md` for the repo, under 150 lines, generated sections for layout and entry points | Stays true as the repo changes |

## 15. Testing

The pose core is only as good as its proof. The parity suite is built before the core.

| Test | Runs in | Proves |
|---|---|---|
| Model parity | Node | After import, counts, names, setup values, timelines and keys equal the official `SkeletonData` of the same file |
| Pose parity | Node | For every fixture and animation, stepped at 60 Hz: bone world matrices, slot colors, attachment names, draw order, deform and events equal the official core of the file's version, within float tolerance |
| Mix parity | Node | The same for scripted mixes: A to B at several points, queues, multiple tracks, interruptions |
| Random play parity | Node | Seeded random sequences of play, queue, skin and time-scale calls on both engines. Any divergence prints the seed. |
| Optimization parity | Node | Every item in 8.1 produces the same pose with the item on and off |
| Geometry parity | Node | Positions, UVs and colors per slot equal the official `computeWorldVertices` output |
| Pixel parity | Headless Chrome, WebGL2 and WebGPU | Our frame equals the official `spine-pixi-v8` frame for 4.2 and 4.3. For 4.1 the reference is our CPU path. |
| Cut parity | Headless Chrome | Our frame with the exact overdraw cuts equals our frame without them, in every pixel. With tight meshes it stays within stated bounds: at most 0.25 percent of pixels off by more than 1 level, 0.01 percent by more than 8. |
| Premultiplied parity | Headless Chrome | Straight and premultiplied exports of one rig match |
| Plan stability | Node | Attachment and draw-order keys cause zero template rebuilds |
| Allocation | Node | A played loop allocates nothing after warm-up |
| Docs examples | Node and Chrome | Every example compiles and renders |
| Mode parity | Headless Chrome | The batched mode equals the official frame under the rules of pixel parity. The two modes differ from each other by 6 levels at most, on 0.05 percent of pixels by more than 1. |
| Scenes | Headless Chrome | 19 scenes with many instances draw like the official runtime in both modes. They cover overlap, two rigs interleaved, a Pixi object in between, and parents with alpha, tint, mask, filter and render group. Instances are added, removed, moved and destroyed between frames. |
| Clip parity | Node | The CPU clip kernel writes the vertices and indices of the official `clipTriangles`, bit for bit, in all three versions |
| A/B bench | Headless Chrome | Not a test. `pnpm bench:ab` measures CPU time, frame time, draw calls and heap against the official Pixi runtime, and tight meshes on against off (section 16). |

No tolerance: pose values are 64-bit, like the numbers of the official JavaScript core, and the engines port its arithmetic in the same order. Pose parity is exact equality. The one bounded difference is in mesh UVs of JSON files, where the model stores `regionUVs` in 32-bit and the official reader keeps 64-bit. The largest difference seen is 5.96e-8, far below one texel.

The pose suite as built in M2a: 5,508 scripts and 165,298 compared updates over 117 rigs, in 18 seconds. Since M3 it runs 17 families of scripts on 129 rigs with constraints solved, in about 45 seconds. Four of the hand-written rigs exist for constraints: IK, transform, path, and the order in which constraints feed each other. A run of the official core against itself gives zero differences, and a change of one unit in the last place on either side is reported.

Since M4 the reference is the played official skeleton with nothing switched off. The suite runs 18 families of scripts on 135 skeleton files: 2,430 cases in about 26 seconds. The new family is for physics: every mode, `physicsTranslate` and `physicsRotate`, wind and gravity directions, y down, moves and mirrored scales, steps of zero and of more than a second. Six more hand-written rigs exist for physics and sliders, because the fixtures hold one slider in total. They cover every physics property and flag, 21 sliders, and every kind of timeline inside a slider animation. A separate test proves that the reference does solve physics and sliders: the pose differs from a run in mode `none` and from the same rig without its sliders.

Since M6 the suite runs 22 families: 2,970 cases. The new ones are for skipping. `rest` plays an animation far past its end and wakes the skeleton in every way there is. `keys` sets times by hand, runs backwards and over many loops on the longest timelines. `still bones` keys few bones and then moves the skeleton, changes the skin and wakes a constraint. After every call of every script the stamps of the pose state are checked: a value that changed needs a newer stamp. A self-check proves that a stamp held back fails, for a bone, a slot, the draw order and the version. Each engine also runs every script with its skipping on against off.

The pixel check as built in M3: 456 frames against the official runtime per renderer, worst difference 4 of 255 levels, 0.008 percent of pixels off by more than 1. A frame that fails is drawn again, moved by a fraction of a pixel, and fails only when it fails at both places. The two runtimes place vertices in different code, so a vertex on a subpixel boundary can round two ways. Three frames pass at the second place only. A defect does not pass: the check proves that on shifted, tinted and hidden slots.

Since M4 both sides run every constraint, physics and sliders included, from the same first update. The check draws 732 frames against the official runtime per renderer, on 45 rigs: worst difference 4 of 255 levels, 0.008 percent of pixels off by more than 1. The 284 frames of rigs with physics or a slider differ by 2 levels at most. Five frames pass at the second place only. The cuts on and off differ in no pixel on 530 frames.

Since M5 the check draws every rig in both render modes, in 160 seconds for both renderers. The batched mode against the official runtime: 366 frames per renderer, and no pixel differs, clipped frames and rigs with physics included. It places vertices on the CPU in 64-bit as the official runtime does. The mesh mode stands as before, worst 4. The two modes against each other: 482 frames, worst 5, 0.006 percent of pixels off by more than 1. The scenes: 56 frames per mode, worst 3 in mesh mode and 1 in batched mode. Two instances swapped in draw order fail, as they must.

The check also counts how often Pixi rebuilds the instructions of the render group while 111 animations play 30 frames each. It counts 11 rebuilds in batched mode and 26 in mesh mode, in 7 animations. Those are rooms that grow and runs whose blend structure changes. The official runtime rebuilds in 7 to 27 of 15 frames of a scene.

Since M6 the check has six scenes for sleeping and waking. A skeleton rests and plays again. Its parent moves while it rests. It rests next to one that plays in the same batch. It is hidden while it would change. Its skin, tint or mode changes at rest. It is destroyed at rest. Every frame is compared in both modes. A side that leaves out one update is rejected, with 44 percent of the pixels off. Four more scenes cover the chunks: a page that needs no mesh mode does not request it, and an instance switched to meshes draws every frame until the chunk is there.

Since M6 the check also runs on other versions of pixi.js: `pnpm check:render --pixi=8.16.0`. The package is built and checked on 8.23.0 and allows 8.16 and later. The whole check passes on 8.16.0, 8.21.0 and 8.23.0, in about three minutes per version. The versions in between were not run. It found two defects that the default run could not see. M5 lost partial uploads on 8.20 to 8.22, which shows only with several instances in a batch. The mesh mode drew stale triangles on 8.16 (section 7.3). On WebGPU the official runtime itself draws another alpha on Pixi before 8.23, because Pixi changed the blend factors of `add`. So ours on an old Pixi is judged against the official picture on 8.23.0.

After M6 three things joined the checks.

- The symbol rigs of the slot game Bzzz are fixtures in the repository, with the leave of its owner. They are 16 skeletons of Spine 4.2 in the binary format, on one atlas with an AVIF page. They are the first rigs of a real game the runtime ran on. All of them pass model, pose, geometry and atlas parity, in every script family.
- A script family writes bones from outside the engine, as a bone handle does. It found that the 4.1 and 4.2 engine lost a write when `setSkin` was called with the skin that was set already. That is fixed.
- The pixel check ends with a game check. It draws 9 cases from a bundle that is made as a game makes one: `Application` and `MarrowSpine` imported by name, the tree shaken. Pixi registers a pipe when its module loads, and a renderer takes its pipes when it is created. So the mesh mode, whose code loads on demand since M6, found no mesh pipe in a game that imports no `Mesh` of its own, and threw. The docs site found this, because it is the first real bundle. The mesh mode now gives a renderer the pipe it lacks. Without the fix 10 of 18 cases fail, on pixi.js 8.16.0 and 8.23.0. Two scenes compare `attach` and `follow` with `addSlotObject` of the official runtime.

One failure stays unexplained. A frame of celestial-circus-pro on a multisampled target on WebGPU differed by 3 in one run of M5 and by 1 in one run of M6. It did not show again in more than 40 runs of that case.

Fixtures: 57 official example rigs across 4.1, 4.2 and 4.3, each as JSON and binary, listed in `fixtures/manifest.json` at pinned commits with a hash per file. They are downloaded on demand and not committed, because the licence of the example assets has not been read. Your own rigs go into `fixtures/local/`, which is not committed either.

One finding from building the suite: the official binary readers ignore the offset of a typed array view (`new DataView(data.buffer)` in all three versions). A view into a larger buffer is read from the wrong place. Our importer must honour the view, and a test must prove it.

## 16. Milestones

| Milestone | Content | Done when |
|---|---|---|
| M0 Scaffold and parity suite | Repo and gates from section 12. Facts file with generated blocks. Parity suite that loads fixtures into the three official cores. The docs site, the llms files and the skills wait for M2, when there is an API to document. | Built 2026-11-11. `pnpm check` passes locally. `pnpm parity:ref` prints reference poses for all 114 fixtures. CI has not run yet: there is no remote. |
| M1 Model | `SkeletonModel`, JSON and binary importers for 4.1 to 4.3, atlas importer, `describeSkeleton`, `generateNames` and the command line tool | Built 2026-11-11. Model parity on all 114 fixtures and atlas parity on all 57 atlases, with exact equality. Hand-written skeletons cover the timeline kinds the fixtures lack. Every feature is imported, even those not yet solved. Not done: a memory baseline, which waits for instances in M2. |
| M2a Pose, headless | Pose engines for 4.1 and 4.2 and for 4.3: bone transforms, every timeline that does not animate a constraint, tracks, queue, mixing, events, skins, deform, sequences. Geometry kernel: vertex positions and UVs. Memory baseline. | Built 2026-11-11. Pose parity is exact on all 114 fixtures and 3 hand-written rigs. Geometry parity is exact on all fixtures, with the one bounded case for JSON mesh UVs. A rig with constraints throws the typed error unless it is played with constraints ignored. Not done: keyframe cursors, which wait for M6 with the other skipping work. |
| M2b First frames | Render: `SkeletonView` draws through Pixi meshes with its own geometry and shader. CPU skinning into buffers, premultiplied pipeline, additive in the same draw, pages in one draw, stable vertex layout, hidden slots left out. The display object `MarrowSpine` with `MarrowAsset` and `Track`. Pixel check in headless Chrome (`pnpm check:render`). | Built 2026-11-11. On 12 rigs in 34 versions the picture matches the official Pixi runtime within 4 of 255 levels, on WebGL2 and WebGPU. At most 0.02 percent of pixels are off by more than 1. One draw call for every rig with only normal and additive slots. Known gap: clipping, which is M3. Not done: a custom render pipe, which the design named. Pixi meshes gave the same result with less reliance on Pixi internals. |
| M3 Constraints and overdraw | Pose: IK, transform and path constraints in both engines, with the generalized transform constraints of 4.3. Render: clipping through a stencil mask, invisible regions left out, covered slots skipped, tight meshes as an option, outlines from a sidecar file or a scan in idle time. | Built 2026-11-11. Pose parity with constraints is exact on all 114 fixtures and 15 hand-written rigs, five per version. The pixel check passes on WebGL2 and WebGPU with constraints and clipping on both sides. The exact cuts change no pixel. Tight meshes draw 90.5 percent of the triangle area and stay opt-in, because they are not exact to the bit. Not done: the perf report, which moves to M4 with the perf probes. |
| M4 Complete | Physics, sliders, additive tracks. Perf report and perf probes. An A/B bench against the official Pixi runtime. | Built 2026-11-11. Physics constraints and sliders in both engines, the remaining track options, physics control, `perf.report()`, `perf.memory()`, the probe entry and `pnpm bench:ab`. Pose parity is exact on 135 skeleton files with every constraint on. The pixel check passes on WebGL2 and WebGPU with physics and sliders live. Not done: the A/B inside spine-benchmark and numbers per device class. The package is not published and its licence is not decided, so spine-benchmark cannot load it yet. `tightMesh` stays an option until devices are measured. |
| M5 Batched mode | Small skeletons that share a render group share draw calls, with the premultiplied shader, additive slots in the batch and pages joined by texture. `renderMode: 'auto'` picks the mode per skeleton. The heap of an instance with a clip is explained and cut. | Built 2026-11-12. Two batchers of our own, constant-size elements with rewrites in place, CPU clipping by a port of the official clipper, layouts shared per asset. 200 instances of a rig without a blend break draw in 1 call. The frame takes 30 to 89 percent of the official time on the five bench rigs. The pixel check passes in both modes. One rule of the list is missed: raptor-pro is 4 percent slower in batched mode than in mesh mode on WebGL2 (section 16.2). Not done: a CI run against pixi.js 8.16.0, and loading the mesh mode on demand. |
| M6 Pose skipping | Constant folding, needed set, timeline skipping, path cache, shared pose, sleep. The mesh mode on demand. | Built 2026-11-12, with a narrower list than planned. Built: stamps in the pose state. Engines that skip an apply that would repeat and pose only bones whose inputs changed. Views that place, color and upload only what changed. Three chunks on demand. Not built, each with its measurement in section 2: a keyframe cursor, sharing a pose between instances, leaving out bones or timelines that nobody looks at. Pose parity is exact with the stamp check on. 200 instances at rest take 0.02 to 0.04 ms to update and upload nothing. No bench rig is slower than in M5. The pixel check passes on pixi.js 8.16.0, 8.21.0 and 8.23.0. Not reached: physics in mode `update` does not rest. |
| Handles and site, after M6 | `bone`, `follow`, `attach`. A first docs site. Real rigs as fixtures. | Built 2026-11-12. The three calls work in both render modes and are compared with the official `addSlotObject` in the pixel check. The site shows the bee of the slot game Bzzz. Found and fixed on the way: the mesh mode in a tree-shaken game, and a bone write lost after `setSkin` in the 4.1 and 4.2 engine. |
| Slots and skins, after the first pre-release | Several skins at once, a slot handle, the setup pose and point conversion on the display object | Built 2026-11-13. `skins` combines skins as the official `Skin.addSkin` does, and the lookup of a model shares each combined skin between its instances. A combined skin stays while an engine shows it, the last 8 that none shows wait, and older ones are freed with the caches the engines keep for them. `slot` writes the attachment, the color and the dark color through new engine calls. They write `slotPose`, the animated pose of a 4.3 slot that a slider poses, and a write of the value there changes nothing. A parity family "slots and skins" runs every call against the official cores of 4.1, 4.2 and 4.3. Planted bugs fail it: the first skin winning fails 19 rigs, a missing clamp 140. A review of the first draft found two defects the family could not see. A tint write took the alpha a slider drew into the pose. `worldToLocal` used the 4.2 formula in 4.3, off in the last bit. Both are fixed and tested. |
| M7 GPU | GPU skinning, slot palette | Zero vertex upload for rigid rigs. A/B on low-end and mid devices. |
| M8 Baked | Baker at build time and run time, baked playback, instancing, `balanced` preset | Eligible fixtures play baked with pixel parity at sample points |
| M9 Release 1.0 | `fast` preset, idle cache, level of detail, docs within budget, migration guide | Docs budget and all gates pass |
| Later | Worker, WASM kernel, opaque pass | Only with benchmark evidence |

### 16.1 Measured in M4

`pnpm bench:ab` on one machine: Apple M4 with 10 cores on battery, headless Chrome 157 with the real GPU, pixi.js 8.23.0, a canvas of 1280 by 720. 200 instances of one rig play one animation. The numbers are medians of 3 runs of 200 frames. This is one desktop. It says nothing about phones.

Ours as a share of the official `spine-pixi-v8` of the rig's version. Lower is better.

| Rig | CPU per frame, WebGL2 | Frame, WebGL2 | CPU per frame, WebGPU | Frame, WebGPU | Draw calls, ours and official | Heap per instance in KB, ours and official |
|---|---|---|---|---|---|---|
| 4.2 tank-pro | 36 percent | 47 percent | 41 percent | 59 percent | about 712 and 488 | 188 and 283 |
| 4.3 raptor-pro | 59 percent | 65 percent | 51 percent | 60 percent | 200 and 1 | 70.6 and 105.5 |
| 4.2 coin-pro | 54 percent | 83 percent | 62 percent | 111 percent | 800 and 400 | 32.9 and 15.3 |
| 4.2 speedy-ess | 77 percent | inside the spread | 87 percent | 128 percent | 200 and 1 | 29.7 and 26.2 |
| 4.3 sack-pro, with physics | 92 percent | 101 percent | 89 percent | 111 percent | 200 and 1 | 41.7 and 46.6 |

CPU per frame is the update plus the CPU part of the render. The official runtime computes vertices while it renders and pixi-marrow in its update, so the update alone does not compare. Frame is the CPU time plus the wait for the GPU. In absolute terms the CPU time on WebGL2 is 6.3 against 17.4 ms for tank-pro and 2.7 against 4.5 ms for raptor-pro.

What the numbers say:

- pixi-marrow needs less CPU time on every rig measured.
- It does not join instances into one draw call, and the official runtime does. On small rigs that eats the CPU gain: the frame takes as long or longer.
- It holds less heap per instance on three rigs of five. speedy-ess holds 13 percent more and coin-pro more than twice as much.

The heap column was measured again in M5. The first numbers were too low for both runtimes. A destroyed instance stays reachable through the instruction set of Pixi's render group, so a reading after another block on the same page is wrong. Every reading is on a fresh page now, taken twice in opposite order, and the two differ by 0.4 percent at most.

Where the heap of an instance goes, for coin-pro without its clip: 22.8 KB against 11.7 KB of the official object. The view template and state take 5.1 KB, the pose engine 4.65 KB, Pixi buffers 3.35 KB, the shader and its bind group 2.1 KB and the cover test 1.6 KB. The clip adds 9.65 KB: a mask mesh, a container, a shader and a range mesh of its own. The official runtime keeps one container per instance and its vertices in Pixi's shared batch buffers.

`pnpm bench:ab --mode=overdraw`: 24 instances scaled to cover a canvas of 1920 by 1080 several times, 5 runs. Render time with `tightMesh: 'on'` against `off`, on WebGL2:

| Rig | Render time | Triangle area | Vertices |
|---|---|---|---|
| 4.2 dragon-ess | 11.0 percent less | 87.1 percent | 94 percent more |
| 4.3 spineboy-pro | 12.0 percent less | 90.5 percent | 31 percent more |
| 4.3 raptor-pro | 4.8 percent less | 91.6 percent | 13 percent more |
| 4.3 chibi-stickers | 2.9 percent less | 97.4 percent | 22 percent more |
| 4.2 tank-pro | 2.7 percent less | 90.9 percent | 64 percent more |

Every run had the same sign. On WebGPU four rigs gain 3 to 22 percent with a wide spread between runs, and chibi-stickers shows no steady gain. The default cuts cost nothing: `auto` is within 0.3 percent of `off`. So tight meshes pay in a scene that is bound by fill, by 3 to 12 percent on this GPU. They are not exact to the bit and they add vertices. They stay an option until a phone GPU is measured.

### 16.2 Measured in M5

`pnpm bench:ab --check --runs=5` on the same machine, on AC power: 200 instances, default options, so `renderMode: 'auto'`, which batches all five rigs. Medians of 5 runs. Ours and official.

| Rig | Draw calls | CPU per frame in ms, WebGL2 | Frame in ms, WebGL2 | Frame in ms, WebGPU | Heap per instance in KB |
|---|---|---|---|---|---|
| 4.2 tank-pro | 401 and about 488 | 5.28 and 17.40 | 8.17 and 20.66 | 10.29 and 24.33 | 156 and 283 |
| 4.3 raptor-pro | 1 and 1 | 2.64 and 4.72 | 4.23 and 7.01 | 4.47 and 10.28 | 70 and 105 |
| 4.2 coin-pro | 1 and 400 | 0.47 and 2.13 | 1.03 and 3.46 | 2.16 and 3.79 | 16.5 and 15.3 |
| 4.2 speedy-ess | 1 and 1 | 0.39 and 0.62 | 0.82 and 1.05 | 0.96 and 1.23 | 18.2 and 26.7 |
| 4.3 sack-pro, with physics | 1 and 1 | 1.29 and 1.54 | 2.25 and 2.53 | 2.39 and 2.77 | 34.4 and 46.6 |

The frame takes 30 to 89 percent of the official time on WebGL2 and 42 to 86 percent on WebGPU. The rig tank-pro needs two draw calls per instance. The cause was not looked into.

The list of M5 has 16 rows. 15 pass. One fails: raptor-pro in batched mode takes 4.23 ms per frame on WebGL2 and 4.08 ms in mesh mode, 4 percent more. On WebGPU it takes 4.47 against 5.27 ms. The limit of 1024 vertices stays. It trades those 4 percent on a desktop for 1 draw call in place of 200, which weighs more on a phone. That is a judgement and not a measurement: no phone was measured.

Against mesh mode a batched instance holds more heap where a rig is large: tank-pro 156 against 131 KB, raptor-pro 70 against 56 KB. It keeps its positions in skeleton space next to the copy in the batch. The cover test, the clipper and a move without an update read them.

1200 instances of coin-pro draw in 1 call on WebGPU. In M4 they failed with a full uniform buffer batch.

A bench on battery is not valid. On low battery the typed array code of pixi-marrow ran 2.2 times slower and the official runtime 1.3 times.

### 16.3 Measured in M6

`pnpm bench:ab --scene=all --instances=200 --runs=5` on the same machine on AC power, the M5 build first and the M6 tree right after it. WebGL2, 200 instances, medians of 5 runs. Ours and official.

| Scene | Rig | Update in ms | CPU per frame in ms | Frame in ms | KB uploaded per frame |
|---|---|---|---|---|---|
| play | 4.2 tank-pro | 2.72 and 3.67 | 3.40 and 16.72 | 6.21 and 19.59 | 7301 and 9323 |
| play | 4.3 raptor-pro | 2.36 and 1.72 | 2.60 and 4.61 | 4.17 and 6.93 | 1111 and 7638 |
| play | 4.2 coin-pro | 0.42 and 0.13 | 0.46 and 2.11 | 1.03 and 3.43 | 485 and 331 |
| rest | 4.2 tank-pro | 0.025 and 3.49 | 0.08 and 13.72 | 0.98 and 16.11 | 0 and 3385 |
| rest | 4.3 raptor-pro | 0.025 and 1.46 | 0.03 and 3.44 | 0.60 and 5.21 | 0 and 3009 |
| rest | 4.2 coin-pro | 0.025 and 0.11 | 0.03 and 1.89 | 0.66 and 3.25 | 0 and 263 |
| moved | 4.2 tank-pro | 0.025 and 3.51 | 0.41 and 13.68 | 1.29 and 16.03 | 1323 and 3385 |
| little | 4.2 tank-pro | 0.50 and 2.18 | 0.63 and 10.73 | 1.52 and 13.07 | 1323 and 3407 |
| little | 4.3 raptor-pro | 0.58 and 0.83 | 0.68 and 3.66 | 1.61 and 6.03 | 1264 and 7622 |
| little | 4.2 owl-pro | 0.04 and 0.18 | 0.05 and 1.57 | 0.67 and 2.74 | 9 and 2483 |
| mixed | 30 instances of 5 small rigs | 0.035 and 0.055 | 0.045 and 0.255 | 0.42 and 0.69 | 63 and 208 |

`rest` is an animation that ended. `moved` is the same with a parent that moves each frame. `little` plays an animation that moves few bones: raptor-pro `gun-grab`, owl-pro `blink`, and for tank-pro one bone turned by an animation written for the bench. `mixed` is what a slot game looks like: most instances rest, one starts a short animation every 12 frames.

- At rest the update of 200 instances takes 0.02 to 0.04 ms, 0.9 to 7.6 percent of the update while playing. In M5 it took 52 to 95 percent. Nothing is uploaded. The official runtime uploads 0.2 to 3.4 MB per frame at rest.
- Against the M5 build measured in the same hour, while playing: the update takes 60 to 97 percent, the CPU time per frame 63 to 98 percent. No row of the list of M6 fails. 6 of 51 are undecided because the runs overlap.
- The update alone is still above the official one on some rigs while playing, three times for coin-pro. The official runtime places vertices while it renders, so the CPU time per frame is the fair column, and there ours is lower in every row.
- A skeleton with physics rests only when its physics was never disturbed. sack-pro in `little` updates in 0.58 ms against 0.50 ms of the official runtime.
- The heap per instance grew by 1.3 to 3.4 KB for the stamps and the state of the skipping. It is 159 KB for tank-pro, 73 for raptor-pro, 38 for sack-pro, 19.5 for speedy-ess and 17.8 for coin-pro. The last one is now 16 percent above the official runtime. The other four are below it.
- The rule of M5 that failed still fails: raptor-pro is 5 percent slower batched than in mesh mode on WebGL2.

Your three must-haves: fewer batch breaks and the premultiplied pipeline land in M2, overdraw in M3. The part that was open after M4 is closed in M5: many instances of small skeletons share draw calls. What stays: a Pixi object between two skeletons ends our batch and not the batch of the official runtime. M2 is the largest milestone because the first correct frame needs model, pose and render together.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Mixing and hold logic have many edge cases | Mix parity and random play parity from M2. The official implementation is the specification. |
| Older solvers differ from 4.3 in ways a mode flag cannot cover | Per-constraint experiment first (section 10). Fallback: a separate kernel per version for that constraint. |
| Physics drifts from the official result | It does not: the port keeps the order of the official arithmetic, and physics parity is exact equality like the rest (M4). |
| A new Spine release changes the solver | The parity suite shows exactly which frames diverge. Port, then extend the model. |
| Pixi internals used by a custom pipe and batcher change between minors | The parts used are listed in 7.2 and were checked against the source of 8.16.0 and 8.23.0. Not done: a CI run against the lowest supported Pixi. |
| WebGPU and WebGL2 differ on stencil or data textures | Both renderers in pixel parity from M2 |
| Tight outlines cost load time | Sidecar from the optimizer. Load-time scan only in idle frames. |
| More than 65,535 vertices in one template | 32-bit indices when needed |
| The needed set changes often and recompiling costs more than it saves | The set covers everything an animation can show, so it changes at animation start and end only |
| npm rejects the name as too similar to another package | Reserve it early with a placeholder publish |
| Licence | Settled before the first publish: the Spine Runtimes License ships in `LICENSE` with its notice, as the official runtimes do. Each user needs their own Spine Editor licence, and the README says so. |

## 18. Decisions

Settled:

1. Name `pixi-marrow`, own repository, started locally.
2. Scope: Spine 4.1, 4.2, 4.3.
3. Own pose core. No `spine-core` at run time.
4. Must-haves: less overdraw, fewer batch breaks, premultiplied pipeline with additive in the batch.
5. Licence: the Spine Runtimes License, chosen on 2026-11-12. The pose core is ported from the official source, so it is a derivative work of the Spine Runtimes.

Open, each with a recommendation the design assumes:

1. Pixi floor: `^8.16`, the same as the official 4.3 runtime. Widen later if asked for.
2. WebGPU from M2, not added later.
3. Display class name: `MarrowSpine`, in line with `SilkGraphics`.
4. Default preset: `exact`.
5. Pose values are 64-bit on the CPU, so parity with the official core is exact. Copies for the GPU are 32-bit. Settled in M2a. A pose costs 1 to 26 KB per instance on the fixtures. With the state of the constraints, counted since M3, an instance costs 1 to 41 KB.
6. Unported features fail loudly with a typed error. No silent fallback.
7. Fixtures: your rigs in a private folder outside the public repo until you say otherwise.
