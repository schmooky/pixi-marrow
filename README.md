# pixi-marrow

A Spine runtime for PixiJS v8 with its own pose core. It plays Spine 4.1, 4.2 and 4.3 skeletons.

<!-- facts:status -->
Pre-release, published as `pixi-marrow@next`. Skeletons of Spine 4.1, 4.2 and 4.3 load, play and draw in PixiJS v8 with every constraint solved: IK, transform, path, physics and sliders. The poses equal the official cores to the bit, and the picture matches the official Pixi runtime. Small skeletons share draw calls, and a skeleton at rest costs close to nothing.
<!-- /facts:status -->

The plan is in [docs/DESIGN.md](docs/DESIGN.md).

## Install

```bash
npm install pixi-marrow@next pixi.js
```

It needs pixi.js 8.16 or later. Docs and live previews are at [pixi-marrow.schmooky.dev](https://pixi-marrow.schmooky.dev).

## Use

```ts
import { MarrowSpine } from 'pixi-marrow';

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });

app.stage.addChild(hero);
hero.play('run', { loop: true });
```

Every constraint is solved: IK, transform, path, physics and sliders. Clipping works.

## Pixi Assets and AssetPack

```ts
import { Assets } from 'pixi.js';
import { MarrowSpine, registerMarrowAssets } from 'pixi-marrow';

registerMarrowAssets();
await Assets.load(['hero.skel', 'hero.atlas']);

const hero = MarrowSpine.from({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
```

`registerMarrowAssets` teaches Pixi `Assets` to load `.skel` files, Spine `.json` files and `.atlas` files. Call it once, before the first load. Then aliases, manifests and bundles load them too, as AssetPack writes them. `MarrowSpine.from` takes the aliases and returns at once.

An atlas named like `hero@0.5x.webp.atlas` counts as resolution 0.5 in WebP, so `texturePreference` picks among its variants. The `data` of an atlas takes `images` and `imageMetadata`, as in the official runtime.

Unloading an atlas destroys the assets made from it, so destroy their display objects first. Do not register another Spine runtime in the same game: both claim the same file extensions.

## Tracks and physics

```ts
hero.play('aim', { track: 1, additive: true, alpha: 0.5 });
hero.play('walk', { start: 0.2, end: 1.1, entry: { mixDrawOrderThreshold: 0.5 } });

hero.physics = 'pose';
hero.resetPhysics();
hero.physicsTranslate(dx, dy);
```

`entry` and `track.configure` take any field of the official `TrackEntry` by its official name. `physics` is the official mode: `update`, `pose`, `reset` or `none`. Physics does not follow the Pixi position by itself: tell it with `physicsTranslate` and `physicsRotate`.

## Bones and placeholders

```ts
const head = hero.bone('head');
console.log(head.worldX, head.worldY);
head.rotation += 15;

hero.addChild(flash);
hero.follow('gun', flash);

hero.attach('placeholder', symbol);
```

`bone` gives a handle: the pose next to the parent bone to read and write, and the place in the skeleton to read. `follow` moves a container with a bone. `attach` draws a container at the place of a slot in the draw order, between the parts of the skeleton, and moves it with the bone of the slot. An attached container costs one draw call.

## Skins and slots

```ts
hero.skins = ['skin-base', 'hair/pink', 'clothes/hoodie-orange'];

const weapon = hero.slot('weapon');
weapon.attachment = 'axe';
weapon.tint = 0xff8080;
weapon.alpha = 0.5;

const tip = hero.bone('sword').localToWorld({ x: 120, y: 0 });

hero.stop();
hero.setupPose();
```

`skins` makes a list of skins active as one, as `Skin.addSkin` does in the official runtime. Where two skins store an attachment under one slot and name, the later one wins. The instances of an asset share the combined skin of a list. `slot` gives a handle to the attachment, the tint, the alpha and the dark tint of one slot. A write stays until an animation keys the slot or the setup pose is set, which a new skin list does. `localToWorld` and `worldToLocal` take points between a bone and the skeleton. `setupPose` takes `'bones'` or `'slots'` for one half.

## Many skeletons

Skeletons of up to 1024 vertices share draw calls: 200 instances of a small rig draw in one call. Nothing to set up. A Pixi object between two skeletons in draw order ends a batch, so keep skeletons next to each other in the display list where you can.

```ts
const boss = await MarrowSpine.load({ skeleton: 'boss.skel', atlas: 'boss.atlas', renderMode: 'mesh' });
console.log(boss.stats.renderMode);
```

`renderMode` is `auto` by default. `mesh` draws a skeleton with meshes of its own, which pays for large rigs. `batched` forces the batch.

## Skeletons at rest

A skeleton whose animation ended, or that never played one, costs close to nothing: no timeline runs, no vertex is placed, nothing is uploaded. It wakes with the next `play`. Physics is the exception: a skeleton with physics constraints keeps simulating, as in the official runtime.

## Trade exactness for speed

```ts
const coin = await MarrowSpine.load({ skeleton: 'coin.skel', atlas: 'coin.atlas', perf: 'balanced' });
const fan = await MarrowSpine.load({ skeleton: 'fan.skel', atlas: 'fan.atlas', perf: 'fast', updateRate: 24 });
```

`perf` is `exact` by default, which changes nothing. `balanced` plays an animation from baked frames where it can, draws a skeleton at rest as one image, and updates a skeleton off the screen 4 times a second. `fast` also pauses a skeleton off the screen, poses batched skeletons 30 times a second and leaves physics and deform out below 96 pixels. Each setting is an option of its own too: `bake`, `idleCache`, `offscreen`, `updateRate`, `lod`, `tightMesh` and `skinning`. `skinning: 'gpu'` places the vertices of the mesh mode in the vertex shader. It is opt-in, because on the desktop it measured slower than the CPU. `bakeAnimations` of `pixi-marrow/bake` bakes at build time. The first two rows of `perf.report()` say which settings are in effect and how often the skeleton updates.

## Why is it slow

```ts
console.table(await hero.perf.report());
console.log(await hero.perf.memory());
```

The report lists what the runtime decided for this instance and why: draw calls, blend ranges, tight meshes, covered slots, clipping, physics and more. For timings, `createProbe(hero)` from `pixi-marrow/perf` measures the pose, geometry and event work of every update.

## Less overdraw

After a load the page images are read in idle time. From then on a region without a visible pixel is not drawn, and a slot behind the opaque part of a later slot is skipped. The picture stays the same, bit for bit.

```ts
const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas', tightMesh: 'on' });
```

`tightMesh: 'on'` also draws every region as the polygon around its visible pixels. On the example rigs that shades 3 to 19 percent less triangle area. The picture is the same to the eye and not to the bit: some pixels move by 1 of 255 levels.

`pixi-marrow outlines hero.atlas` writes the outlines to `hero.outlines.json` at build time. Pass that URL as `outlines` in the load options and nothing is read at load time.

## Debug overlays

```ts
import { MarrowDebug } from 'pixi-marrow/debug';

const debug = new MarrowDebug(hero, { layers: { meshTriangles: true, overdraw: true } });
debug.layers.bones = false;
```

`MarrowDebug` draws over a skeleton: bones, region and mesh shapes, bounding boxes, clipping, paths, point attachments, event names and overdraw. The shapes are the ones the official runtime computes, to the bit. The `overdraw` layer fills every triangle the skeleton draws with a color that adds up, so the bright parts are where the GPU paints a pixel many times. The overlays draw with [pixi-silk](https://pixi-silk.schmooky.dev), an optional peer: `npm install pixi-silk` to use them.

## Docs site

```bash
pnpm site:dev
```

The site in `apps/site`, served at [pixi-marrow.schmooky.dev](https://pixi-marrow.schmooky.dev), has two live previews. It shows the bee of the slot game Bzzz, whose symbol rigs are in `fixtures/bzzz`.

## Goals

- One runtime for 4.1, 4.2 and 4.3 files, mixed in one scene.
- Less overdraw, fewer batch breaks, and one premultiplied pipeline with additive slots in the same batch.
- A pose core built for speed and low memory. Typed arrays, no per-frame allocation, no work that cannot change the picture.
- A small API that people and AI agents can use from one page of docs.
- Every frame checked against the official `spine-core` of the file's own version.

## Entry points

<!-- facts:entry-points -->
| Import | Holds |
|---|---|
| `pixi-marrow` | `MarrowSpine`, the display object, with `MarrowAsset`, `Track` and `MarrowError`. Needs `pixi.js`. |
| `pixi-marrow/core` | `importSkeleton`, `importAtlas`, `createPoseEngine`, the geometry functions, `describeSkeleton` and the model types. No Pixi. Runs in Node. |
| `pixi-marrow/optimize` | `generateNames`, `buildAtlasOutlines`, `decodePng` and the `pixi-marrow` command line tool (`info`, `typegen`, `outlines`). Runs in Node. |
| `pixi-marrow/debug` | `MarrowDebug`: overlays of bones, attachment shapes, bounding boxes, clipping, paths, points, events and overdraw over a `MarrowSpine`. Draws with the optional peer `pixi-silk`. |
| `pixi-marrow/bake` | `bakeAnimation` and `bakeAnimations`: animations sampled at a fixed rate, at build time in Node or in a game. `encodeBakedClips`, `decodeBakedClips` and `addBakedClips` hand the clips to an asset. No Pixi. |
| `pixi-marrow/perf` | `createProbe`: times the pose, geometry and event work of every update of one `MarrowSpine` and counts what the renderer did. For benchmarks and profiling. |
<!-- /facts:entry-points -->

## Work on it

Node 24 and pnpm 10.

```bash
pnpm install
pnpm check        # every gate CI runs
pnpm test         # unit tests and the parity suite
pnpm parity:ref   # one line per fixture: the poses the official cores give
```

The parity suite runs on the official Spine example exports. `pnpm fixtures` downloads them into `fixtures/.cache`. They are not committed.

Your own rigs go into `fixtures/local/`: a `.json` or `.skel` file with its `.atlas` next to it. The suite picks them up. That folder is not committed either.

[AGENTS.md](AGENTS.md) explains the layout and the rules.

## Licence

The Spine Runtimes License, in [LICENSE](LICENSE). The pose core of pixi-marrow is ported from the official Spine Runtimes, so pixi-marrow is a derivative work of them.

Each user of pixi-marrow needs their own Spine Editor licence, as for the official runtimes. A copy of pixi-marrow in any form must include the licence and its copyright notice.

The rigs in `fixtures/bzzz` are not covered by it, see [their notes](fixtures/bzzz/README.md).
