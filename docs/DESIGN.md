# pixi-marrow design

Draft 3, 2026-11-11. A Spine runtime for PixiJS v8 with its own pose core and its own render path. It plays 4.1, 4.2 and 4.3 skeletons.

Change from draft 1: the runtime does not ship `spine-core`. The pose core is ours. The official cores are used in tests only, as the reference every frame is compared against.

Change from draft 2: memory is a goal of the same weight as speed (section 8.6). Milestone M0 is built.

Change with M1: the model is a faithful import with no conversion between versions (sections 5.2 and 10). Milestone M1 is built.

Change with M2a: there are two pose engines, one for 4.1 and 4.2 and one for 4.3, because the official runtimes mix animations differently (section 5.3). Pose numbers are 64-bit and parity is exact, not within a tolerance (section 15). M2 is split into M2a, which is built, and M2b.

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
| Keyframe lookup | Linear scan from the first key on every call | Cursor per track and timeline. Constant time in normal playback. | Yes |
| Data layout | One object per bone, slot, pose | Typed arrays. The renderer reads them directly, with no copy step. | Yes, within float tolerance |
| Allocation | The core mostly reuses its arrays. The Pixi layer allocates in places, for example a new clipper per bounds call. | None after warm-up, proven by a test | Yes |
| Constant timelines | Evaluated every frame | Folded at load: a timeline whose keys all hold one value becomes a one-time write, or is dropped when it equals the setup pose | Yes |
| Bones nobody needs | Every bone transformed every frame | Only bones that are animated, constrained, or feed something visible. The rest are computed once. | Yes |
| Timelines nobody needs | All applied | Skipped when the target is not needed and the track is not mixing | Yes |
| Path constraints | Curve lengths recomputed every frame | Cached while the path and its bones do not move | Yes |
| Many copies of one rig | One pose each | Instances in the same phase share one pose | Yes |
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
| Atlas pages | Batch by texture, up to the batcher limit | Same, plus one draw per skeleton in mesh mode |
| Vertex data | All attributes repacked each frame | UVs, indices and weights uploaded once. Positions only when needed. |
| Attachment or draw-order key | Full instruction rebuild | Index buffer rewrite |
| Rigid region attachments | Positions computed on CPU and uploaded | Placed in the vertex shader from bone matrices (GPU mode) |
| Hidden slots (alpha 0) | Left out of the batch, but their vertices are still computed, and each change of visibility rebuilds the instructions | Left out by an index rewrite. No vertex work, no rebuild. |
| Overdraw | Quads as authored | Tight outlines, covered slots skipped |
| Clipping | CPU triangle clipping always | CPU or stencil, chosen per clip |
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
| `BoneHandle` | class | Read and write local transform, read world transform, convert points. |
| `SlotHandle` | class | Attachment, color, visibility of one slot. |
| `MarrowError` | class | `code`, message with cause and fix, `validNames` when a name was wrong. |
| `MarrowOptions`, `PlayOptions`, `PerfOptions`, `PerfReport`, `SkeletonInfo`, `MarrowNames` | types | Options and results. Literal unions, no numeric enums. |
| `registerMarrowAssets` | function | Optional: adds parsers to Pixi `Assets` for manifests and bundles. |

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

Built in M2a, without constraints:

| Piece | Responsibility |
|---|---|
| `PoseState` | Per instance, in typed arrays: local pose (7 numbers per bone), inherit mode, bone activity, world transforms (6 numbers per bone), slot colors and dark colors, sequence index, deform and draw order. The numbers are 64-bit. |
| `PoseEngine` | The interface of a pose engine. It mirrors the official `AnimationState` and `Skeleton` calls: tracks, queue, mixing, skins, setup pose, update, events. |
| `createPoseEngine` | Picks the engine for the model's version and loads it on demand. |
| `src/pose/legacy` | The engine for 4.1 and 4.2. Their differences are branches on the version. |
| `src/pose/v43` | The engine for 4.3. The official 4.3 runtime mixes animations with other arguments in every timeline, so it cannot share the 4.1 and 4.2 player. |
| `createAttachmentLookup`, `meshSource` | Find attachments by skin, slot and name, and the mesh that owns the geometry of a linked mesh. |

Timelines that animate constraints are not applied yet, but they still count in the mixing bookkeeping, as in the official player. Dropping them changes when mixed-out entries end.

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

### 5.5 Control and features

| Class | Responsibility |
|---|---|
| `SleepController` | Decides when an instance needs no update. |
| `Optimizer` | Chooses a strategy for each feature from the model analysis, the device and the options. Records the reason. |
| `Baker`, `BakedClip`, `BakedPlayer` | Sample an animation into a pose texture and play it without the pose core. |
| `InstanceGroup` | Draws many instances of one asset in one call. |
| `PerfProbe` | Timers and counters per bucket for spine-benchmark. |

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

| Mode | For | Draw calls | Per-frame upload |
|---|---|---|---|
| mesh | Larger skeletons | One per blend group, usually one | Bone matrices, plus positions of CPU-skinned ranges |
| batched | Many small skeletons | Shared with other marrow skeletons | Positions and colors, like Pixi meshes |

`renderMode: 'auto'` picks by vertex count and by how many instances share the render group. The threshold is a constant until the benchmark tunes it per device class.

### 7.3 Stable plan

The template holds a vertex range for every attachment that can appear in the active skins. Showing, hiding or reordering slots changes which ranges the index buffer points at. Vertex data does not move. A skin change extends or rebuilds the template.

Limit: a skin set with thousands of alternative attachments makes a large template. The template covers active skins only.

### 7.4 Overdraw

1. Hidden slots are never drawn: alpha 0, no attachment, inactive bone. Always on.
2. Tight meshes: a region quad becomes a polygon that follows the alpha outline. Fewer shaded pixels, a few more vertices. Applied when the transparent share of a region is above a threshold.
3. Covered slots: a slot fully inside the opaque part of a later normal-blend slot at full alpha is skipped. The test runs for large slots only and is conservative.
4. Later, experimental: an opaque pass with depth test. Not promised for version 1.

Tight outlines and opaque shapes come from the atlas pixels. Two sources, in this order: a sidecar file written by `pixi-marrow/optimize`, or a scan at load time during idle frames.

### 7.5 Clipping

| Strategy | Cost | Chosen by `auto` when |
|---|---|---|
| CPU | Triangle clipping each frame, no extra draw | Few clipped triangles |
| Stencil | Two extra draws, no CPU clipping | Many clipped triangles |

### 7.6 Objects attached to slots

- `follow(target, container)`: the container tracks a bone or slot transform. It is not interleaved in the draw order. Free.
- `attach(slot, container)`: the container is drawn at the slot's place in the draw order. Splits the skeleton into two draw ranges. The doc states this cost.

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

- Keyframe cursors
- Constant timelines folded at load
- Bones and timelines outside the needed set skipped
- Path constraint cache
- Sleep when idle
- No per-frame allocation
- One model shared by all instances

Each item in this list has a parity test that runs with the item on and off.

### 8.2 Automatic with override

`auto` is the default. The override forces one side.

| Option | Values | `auto` decides by | Exact |
|---|---|---|---|
| `renderMode` | `auto`, `mesh`, `batched` | Vertex count, instance count | Yes |
| `skinning` | `auto`, `cpu`, `gpu` | Weighted vertex count, influences per vertex, deform keys | Yes, within float tolerance |
| `clipping` | `auto`, `cpu`, `stencil` | Clipped triangle count | Yes, edge pixels may differ by antialiasing |
| `tightMesh` | `auto`, `off` | Transparent share and area of each region | Yes |
| `occlusion` | `auto`, `off` | Slot area, opaque data present | Yes |
| `sharedPose` | `auto`, `off` | Instances of one asset in the same animation phase | Yes |
| `instancing` | `auto`, `off` | Count of baked instances of one asset | Yes for baked clips |

### 8.3 Opt-in (changes timing, memory or look)

| Option | Values | Trade |
|---|---|---|
| `bake` | `off`, `auto`, list of animations | No pose cost. Loses long mixes and runtime bone control on baked clips. `auto` bakes only eligible animations: no physics, no handle writes, no layered tracks. |
| `idleCache` | `off`, `auto` | Idle skeleton drawn as one quad. Uses texture memory. |
| `offscreen` | `update`, `throttle`, `pause` | Less work off screen. Events fire late or not at all while paused. |
| `updateRate` | `display` or a number of Hz | Fewer pose updates. Motion steps at low rates. |
| `lod` | `off`, `auto` | Drops physics and deform below an on-screen size. Visible on close inspection. |

### 8.4 One knob

`perf: 'exact' | 'balanced' | 'fast'`, or a `PerfOptions` object that starts from a preset.

| Preset | Sets |
|---|---|
| `exact` (default) | Everything in 8.1 and 8.2. Nothing from 8.3. |
| `balanced` | `exact` plus `bake: 'auto'`, `idleCache: 'auto'`, `offscreen: 'throttle'` |
| `fast` | `balanced` plus `lod: 'auto'`, `offscreen: 'pause'`, `updateRate: 30` for small skeletons |

### 8.5 The report

`spine.perf.report()` returns every decision with its reason, and the counters behind it:

```ts
[
  { feature: 'skinning', value: 'gpu', reason: '1840 weighted vertices, max 3 bones per vertex' },
  { feature: 'pose', value: '31 of 67 bones active', reason: 'animation "idle" moves the upper body only' },
  { feature: 'bake', value: 'off', animation: 'idle', reason: 'physics constraint "hair"' },
  { feature: 'blend', value: '2 extra ranges', reason: 'slots "glow", "fx" use screen' },
]
```

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

- `spine.perf.memory()` reports bytes shared per asset, bytes per instance and GPU bytes.
- A memory baseline in `ci/` works like the size baseline. Growth of more than 10 percent in bytes per instance on the fixtures fails the build.
- The spine-benchmark A/B reports heap and GPU memory next to frame time.

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

console.table(hero.perf.report());
```

Rules the API follows:

- Options objects, no positional booleans. `play('run', { loop: true })`, not `setAnimation(0, 'run', true)`.
- Spine vocabulary is kept: track, skin, slot, bone, event, mix. Agents and animators already know it.
- A wrong name throws `MarrowError` with the valid names and the closest match.
- A rig that uses a feature not ported yet throws `MarrowError` with code `unsupported-feature` and the feature names.
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

One model type for all versions. It is a faithful import, not a conversion: a 4.1 or 4.2 file keeps its own constraint fields, and the fields that exist for some versions only are optional. Whether an older constraint can run on the 4.3 kernel is decided in M3, per constraint, by parity.

| Feature | 4.1 | 4.2 | 4.3 | Lands in |
|---|---|---|---|---|
| Bones, slots, skins, region and mesh attachments, deform, sequences | yes | yes | yes | M2 |
| Tracks, queue, mixing, events | yes | yes | yes | M2 |
| IK, transform and path constraints, clipping | yes | yes | yes | M3 |
| Physics | no | yes | yes | M4 |
| Sliders, generalized transform constraints | no | no | yes | M4 |
| Additive tracks and the remaining track options | yes | yes | yes | M4 |

Where an older solver behaves differently from the 4.3 one, the constraint carries a version mode and the kernel keeps the older math. The first task for each constraint is an experiment: run the 4.3-shaped kernel on 4.1 and 4.2 fixtures and see whether parity holds without a mode.

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

Importers are separate modules loaded by version, so a game that ships 4.3 binary files does not carry the JSON or 4.1 readers. Size budget for the root import with one importer: 60 KB gzipped. It is a target to confirm at M2, checked in CI after that.

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
| `hero.info` and `hero.perf.report()` as JSON | Inspect, do not guess |
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
| Premultiplied parity | Headless Chrome | Straight and premultiplied exports of one rig match |
| Plan stability | Node | Attachment and draw-order keys cause zero template rebuilds |
| Allocation | Node | A played loop allocates nothing after warm-up |
| Docs examples | Node and Chrome | Every example compiles and renders |

No tolerance: pose values are 64-bit, like the numbers of the official JavaScript core, and the engines port its arithmetic in the same order. Pose parity is exact equality. The one bounded difference is in mesh UVs of JSON files, where the model stores `regionUVs` in 32-bit and the official reader keeps 64-bit. The largest difference seen is 5.96e-8, far below one texel.

The pose suite as built: 5,508 scripts and 165,298 compared updates over 117 rigs, in 18 seconds. A run of the official core against itself gives zero differences, and a change of one unit in the last place on either side is reported.

Fixtures: 57 official example rigs across 4.1, 4.2 and 4.3, each as JSON and binary, listed in `fixtures/manifest.json` at pinned commits with a hash per file. They are downloaded on demand and not committed, because the licence of the example assets has not been read. Your own rigs go into `fixtures/local/`, which is not committed either.

One finding from building the suite: the official binary readers ignore the offset of a typed array view (`new DataView(data.buffer)` in all three versions). A view into a larger buffer is read from the wrong place. Our importer must honour the view, and a test must prove it.

## 16. Milestones

| Milestone | Content | Done when |
|---|---|---|
| M0 Scaffold and parity suite | Repo and gates from section 12. Facts file with generated blocks. Parity suite that loads fixtures into the three official cores. The docs site, the llms files and the skills wait for M2, when there is an API to document. | Built 2026-11-11. `pnpm check` passes locally. `pnpm parity:ref` prints reference poses for all 114 fixtures. CI has not run yet: there is no remote. |
| M1 Model | `SkeletonModel`, JSON and binary importers for 4.1 to 4.3, atlas importer, `describeSkeleton`, `generateNames` and the command line tool | Built 2026-11-11. Model parity on all 114 fixtures and atlas parity on all 57 atlases, with exact equality. Hand-written skeletons cover the timeline kinds the fixtures lack. Every feature is imported, even those not yet solved. Not done: a memory baseline, which waits for instances in M2. |
| M2a Pose, headless | Pose engines for 4.1 and 4.2 and for 4.3: bone transforms, every timeline that does not animate a constraint, tracks, queue, mixing, events, skins, deform, sequences. Geometry kernel: vertex positions and UVs. Memory baseline. | Built 2026-11-11. Pose parity is exact on all 114 fixtures and 3 hand-written rigs. Geometry parity is exact on all fixtures, with the one bounded case for JSON mesh UVs. A rig with constraints throws the typed error unless it is played with constraints ignored. Not done: keyframe cursors, which wait for M5 with the other skipping work. |
| M2b First frames | Render: Pixi pipe, CPU skinning into buffers, mesh mode, premultiplied pipeline, additive in batch, pages in one draw, stable plan, hidden slots. The display object and its API. | Pixel parity with the official Pixi runtime on fixtures without constraints, in WebGL2 and WebGPU. |
| M3 Constraints and overdraw | Pose: IK, transform, path, clipping. Render: tight meshes, sidecar, covered slots, stencil clipping, perf report. | Parity on constraint fixtures. Benchmark shows fewer shaded pixels and draw ranges. |
| M4 Complete | Physics, sliders, generalized transform constraints, additive tracks. Perf probes. spine-benchmark A/B against the official runtime. | Parity on every fixture for 4.1 to 4.3. First published numbers per device class. |
| M5 Pose skipping | Constant folding, needed set, timeline skipping, path cache, shared pose, sleep | Optimization parity passes. A/B shows the gain. |
| M6 GPU | GPU skinning, slot palette, batched mode | Zero vertex upload for rigid rigs. A/B on low-end and mid devices. |
| M7 Baked | Baker at build time and run time, baked playback, instancing, `balanced` preset | Eligible fixtures play baked with pixel parity at sample points |
| M8 Release 1.0 | `fast` preset, idle cache, level of detail, docs within budget, migration guide | Docs budget and all gates pass |
| Later | Worker, WASM kernel, opaque pass | Only with benchmark evidence |

Your three must-haves: fewer batch breaks and the premultiplied pipeline land in M2, overdraw in M3. M2 is the largest milestone because the first correct frame needs model, pose and render together.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Mixing and hold logic have many edge cases | Mix parity and random play parity from M2. The official implementation is the specification. |
| Older solvers differ from 4.3 in ways a mode flag cannot cover | Per-constraint experiment first (section 10). Fallback: a separate kernel per version for that constraint. |
| Physics drifts from the official result | Own tolerance, 64-bit state |
| A new Spine release changes the solver | The parity suite shows exactly which frames diverge. Port, then extend the model. |
| Pixi internals used by a custom pipe and batcher change between minors | Test against the lowest supported and the latest Pixi in CI |
| WebGPU and WebGL2 differ on stencil or data textures | Both renderers in pixel parity from M2 |
| Tight outlines cost load time | Sidecar from the optimizer. Load-time scan only in idle frames. |
| More than 65,535 vertices in one template | 32-bit indices when needed |
| The needed set changes often and recompiling costs more than it saves | The set covers everything an animation can show, so it changes at animation start and end only |
| npm rejects the name as too similar to another package | Reserve it early with a placeholder publish |
| Licence | A core ported from the official source is a derivative work under the Spine Runtimes License. Read it before the first publish. Ship its text and notice. |

## 18. Decisions

Settled:

1. Name `pixi-marrow`, own repository, started locally.
2. Scope: Spine 4.1, 4.2, 4.3.
3. Own pose core. No `spine-core` at run time.
4. Must-haves: less overdraw, fewer batch breaks, premultiplied pipeline with additive in the batch.

Open, each with a recommendation the design assumes:

1. Pixi floor: `^8.16`, the same as the official 4.3 runtime. Widen later if asked for.
2. WebGPU from M2, not added later.
3. Display class name: `MarrowSpine`, in line with `SilkGraphics`.
4. Default preset: `exact`.
5. Pose values are 64-bit on the CPU, so parity with the official core is exact. Copies for the GPU are 32-bit. Settled in M2a. A pose costs 1 to 26 KB per instance on the fixtures.
6. Unported features fail loudly with a typed error. No silent fallback.
7. Fixtures: your rigs in a private folder outside the public repo until you say otherwise.
