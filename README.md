# pixi-marrow

[![npm version](https://img.shields.io/npm/v/pixi-marrow/next)](https://www.npmjs.com/package/pixi-marrow)
[![CI](https://github.com/schmooky/pixi-marrow/actions/workflows/ci.yml/badge.svg)](https://github.com/schmooky/pixi-marrow/actions/workflows/ci.yml)
[![Licence: Spine Runtimes License](https://img.shields.io/badge/licence-Spine%20Runtimes%20License-blue)](LICENSE)

pixi-marrow is a fast Spine runtime for PixiJS v8 (pixi.js <!-- fact:floor.pixiShort -->8.21<!-- /fact --> or later). It plays Spine 4.1, 4.2 and 4.3 skeletons on WebGL2 and WebGPU with its own pose core and its own render path. It is an alternative to the official `@esotericsoftware/spine-pixi-v8` and to `pixi-spine`, and it does not ship `spine-core`.

- [Docs](https://pixi-marrow.schmooky.dev): the guide, How it works and the reference.
- [Playground](https://pixi-marrow.schmooky.dev/playground/): drop your own Spine files on it.
- [Lab](https://pixi-marrow.schmooky.dev/lab/): tests that measure pixi-marrow on the device that opens them.

<!-- facts:status -->
Pre-release, published as `pixi-marrow@next`. Skeletons of Spine 4.1, 4.2 and 4.3 load, play and draw in PixiJS v8 with every constraint solved: IK, transform, path, physics and sliders. The poses equal the official cores to the bit, and the picture matches the official Pixi runtime. Small skeletons share draw calls, and a skeleton at rest costs close to nothing.
<!-- /facts:status -->

## Install

```bash
npm install pixi-marrow@next pixi.js
```

It needs pixi.js <!-- fact:floor.pixiShort -->8.21<!-- /fact --> or later. The package is ESM only, and it loads some of its code on demand, so a game needs a bundler.

## Use

```ts
import { Application } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';

const app = new Application();

await app.init({ resizeTo: window });
document.body.append(app.canvas);

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });

app.stage.addChild(hero);
hero.play('run', { loop: true });
```

pixi-marrow solves every constraint: IK, transform, path, physics and sliders. Clipping works.

## Wait for an animation

```ts
const reason = await hero.play('win').finished;

if (reason === 'complete') hero.play('idle', { loop: true });
```

`finished` resolves with the reason: `complete`, `interrupted`, `stopped` or `destroyed`. It never rejects.

## Destroy and unload

```ts
hero.destroy();
```

`MarrowSpine.load` gives its hold on the asset to the display object. So `hero.destroy()` also unloads the skeleton and its page images when no other holder is left.

```ts
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';

const asset = await MarrowAsset.load({ skeleton: 'coin.skel', atlas: 'coin.atlas' });
const coins = [new MarrowSpine(asset), new MarrowSpine(asset)];

for (const coin of coins) coin.destroy();
asset.destroy();
```

Each `MarrowAsset.load` that returns an asset is one owner. Call `asset.destroy()` one time for each load. The asset unloads its page images only when no owner and no display object is left. The runtime never unloads an image that the game loaded through Pixi `Assets` itself.

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

Pixi `Assets` owns an asset that it loaded. Unload the atlas or the skeleton from `Assets` to let the asset go. An asset with a display object on the stage keeps its pages until that object is destroyed. Do not register another Spine runtime in the same game: both claim the same file extensions.

## Tracks and physics

```ts
hero.play('aim', { track: 1, additive: true, alpha: 0.5 });
hero.play('walk', { start: 0.2, end: 1.1, entry: { mixDrawOrderThreshold: 0.5 } });

hero.physics = 'pose';
hero.resetPhysics();
hero.physicsTranslate(dx, dy);
```

`entry` and `track.configure` take any field of the official `TrackEntry` by its official name, which depends on the Spine version. A 4.1 skeleton takes `attachmentThreshold` and `drawOrderThreshold`, and 4.2 and 4.3 take `mixAttachmentThreshold` and `mixDrawOrderThreshold`. A name the version lacks throws a `MarrowError` that lists the names it has.

`physics` is the official mode: `update`, `pose`, `reset` or `none`. Physics does not follow the Pixi position by itself: tell it with `physicsTranslate` and `physicsRotate`.

## The ticker

```ts
const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas', ticker: app.ticker });
```

A display object updates itself from `Ticker.shared` unless `ticker` names another one. Pass `app.ticker` so that its `speed`, `maxFPS` and `stop()` reach the skeleton. With `autoUpdate: false` the game calls `hero.update(seconds)` itself.

## Bones and placeholders

```ts
const head = hero.bone('head');
console.log(head.worldX, head.worldY);
head.rotation += 15;

hero.addChild(flash);
hero.follow('gun', flash);

hero.attach('placeholder', symbol);
```

`bone` gives a handle: the pose next to the parent bone to read and write, and the place in the skeleton to read. `follow` moves a container with a bone. `attach` draws a container at the place of a slot in the draw order, between the parts of the skeleton. It also moves the container with the bone of the slot. Each attached slot costs one more draw call, plus the draw calls of the container.

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

`skins` makes a list of skins active as one, as `Skin.addSkin` does in the official runtime. Where two skins store an attachment under one slot and name, the later one wins. The instances of an asset share the combined skin of a list.

`slot` gives a handle to the attachment, the tint, the alpha and the dark tint of one slot. A write stays until an animation keys the slot or the slot returns to its setup pose.

A write of other skins also puts the slots into their setup pose. The official `setSkin` leaves the slots as they are, and a game resets them with a call of its own. A write of the skins that are active changes nothing.

`localToWorld` and `worldToLocal` take points between a bone and the skeleton. `setupPose` takes `'bones'` or `'slots'` for one half.

## Many skeletons

Skeletons of up to <!-- fact:batch.autoVertices -->1024<!-- /fact --> vertices share draw calls: 200 instances of a small rig draw in one call. It needs no option. A Pixi object between two skeletons in draw order ends a batch. So keep skeletons next to each other in the display list where you can.

A batch samples up to <!-- fact:batch.pages -->16<!-- /fact --> atlas pages, and fewer on a device that samples fewer textures. Skeletons that need more pages together take one more draw call. A skeleton with a dark tint that follows skeletons without one starts a new batch.

```ts
const boss = await MarrowSpine.load({ skeleton: 'boss.skel', atlas: 'boss.atlas', renderMode: 'mesh' });
console.log(boss.stats.renderMode);
```

`renderMode` is `auto` by default. `mesh` draws a skeleton with meshes of its own, which is worth it for large rigs. One draw of the mesh mode samples up to <!-- fact:mesh.pages -->8<!-- /fact --> pages. In both modes the CPU places the vertices. Only `skinning: 'gpu'` moves that work to the vertex shader, in the mesh mode.

`batched` forces the batch. When the device cannot sample the pages of the skeleton in one batch, the skeleton draws with meshes.

## Skeletons at rest

A skeleton whose animation ended, or that never played one, costs close to nothing. The runtime runs no timeline and places no vertex for it. It wakes with the next `play`. Physics is the exception: a skeleton with physics constraints simulates until a step changes nothing in its physics.

One case costs more, in the batched mode. When a display object above the skeleton moves, the runtime places every vertex of the skeleton again and uploads it. When the alpha or the tint above it changes, the runtime writes its colors again. A reel that spins and a layer that fades do that to each symbol.

```ts
import { Container } from 'pixi.js';

const reel = new Container({ isRenderGroup: true });

reel.addChild(hero);
reel.y += 12;
```

A parent with `isRenderGroup: true` moves and fades on the GPU, so the skeleton below it rests. `hero.stats.frameBytes` is 0 after a frame in which the skeleton uploaded nothing. [Performance caveats](https://pixi-marrow.schmooky.dev/performance/caveats/) shows each cause, and [rule MARROW001](https://pixi-marrow.schmooky.dev/performance/rules/#marrow001) is this one.

## Trade exactness for speed

```ts
const coin = await MarrowSpine.load({ skeleton: 'coin.skel', atlas: 'coin.atlas', perf: 'balanced' });
const fan = await MarrowSpine.load({ skeleton: 'fan.skel', atlas: 'fan.atlas', perf: 'fast', updateRate: 24 });
```

`perf` is `exact` by default, which changes nothing. The presets set when a skeleton updates, and nothing else. `balanced` updates a skeleton off the screen <!-- fact:offscreen.throttleRate -->4<!-- /fact --> times a second. `fast` does not pose or draw a skeleton off the screen, and poses batched skeletons <!-- fact:presets.fast.updateRate -->30<!-- /fact --> times a second. Under `fast` the tracks, the events and `finished` of a skeleton off the screen go on. `offscreen` and `updateRate` are options of their own too.

Everything that costs memory, vertices or draw calls is in no preset, because what it costs depends on the device and the scene. Set it by name where it is worth its cost:

- `bake: 'auto'` bakes an animation in idle time the first time it plays alone on track 0. Until the clip is ready, the animation plays live. It does not bake an animation with another one queued after it. A clip keeps 23 KB to 0.9 MB per animation and skin. Clips that a game bakes while it plays hold at most 4 MB per skeleton.
- `tightMesh: 'on'` draws regions as tight polygons, see below. It adds vertices, and a phone whose CPU is the limit pays for them.
- `idleCache: 'auto'` draws a skeleton at rest as one image. Each image is a texture of its own, so many of them take memory and split batches. On a low-end phone small resting symbols drew slower with it.
- `lod: 'auto'` skips physics and deform for a skeleton drawn smaller than <!-- fact:lod.below -->96<!-- /fact --> pixels. Its meshes then show their setup shape.
- `instancing: 'auto'` with `skinning: 'gpu'` draws instances of one rig that follow each other in the display list in one instanced call. It is worth it for many instances of one rig, and not for a grid of different symbols. The batched mode draws such a grid in fewer calls.

`bakeAnimations` of `pixi-marrow/bake` bakes at build time. The first two rows of `perf.report()` say which settings are in effect and how often the skeleton updates.

## Why is it slow

```ts
console.table(await hero.perf.report());
console.log(await hero.perf.memory());
console.log(hero.stats.transformReplaces, hero.stats.tintRewrites, hero.stats.frameBytes);
```

The report lists what the runtime decided for this instance and why: draw calls, blend ranges, tight meshes, covered slots, clipping, physics and more. `stats` counts what the view did. `transformReplaces` and `tintRewrites` grow while a display object above a batched skeleton moves or fades. For timings, `createProbe(hero)` from `pixi-marrow/perf` measures the pose, geometry and event work of every update.

## Less overdraw

With the outlines of its atlas, a skeleton draws no region without a visible pixel. It also skips a slot behind the opaque part of a later slot. The picture stays the same, bit for bit. Outlines are off by default.

```bash
npx pixi-marrow outlines hero.atlas
```

The command writes the outlines to `hero.outlines.json` at build time. `--out <file>` names another file. The tool reads PNG pages. For an atlas with WebP or AVIF pages, `--pages <dir>` names the folder with the PNG sources of the pages. The command line tool needs Node <!-- fact:floor.node -->24.0<!-- /fact --> or later.

```ts
const hero = await MarrowSpine.load({
    skeleton: 'hero.skel',
    atlas: 'hero.atlas',
    outlines: 'hero.outlines.json',
    tightMesh: 'on',
});
```

Pass the URL of that file as `outlines` in the load options. Then the runtime reads no page image at load time. `MarrowSpine.from` and `MarrowAsset.get` take `outlines` too: `'auto'`, `'off'`, the parsed file, or the alias or URL that Pixi `Assets` loaded the file under.

`tightMesh: 'on'` also draws every region as the polygon around its visible pixels. On five rigs of the bench, that shades 2.6 to 12.9 percent less triangle area. A scene bound by fill rendered 3 to 12 percent faster on one desktop GPU. The picture is the same to the eye and not to the bit: some pixels move by 1 of 255 levels.

`outlines: 'auto'` reads the page images in idle time after the load instead. Assets that draw from one page image share one scan of it. The scans read one page at a time, a premultiplied page through one WebGL context, and outline its regions in slices of 4 ms. A read takes 4 bytes for each pixel of the page, on top of the canvas that holds the page. For a moment, a page of 2048 by 2048 takes 32 MB. A phone with little memory can fail on that.

These cuts are off while the renderer has `antialias: true` or `roundPixels`, and for a page texture with mipmaps. [Performance caveats](https://pixi-marrow.schmooky.dev/performance/caveats/) lists every such case.

## Debug overlays

```ts
import { MarrowDebug } from 'pixi-marrow/debug';

const debug = new MarrowDebug(hero, { layers: { meshTriangles: true, overdraw: true } });
debug.layers.bones = false;
```

`MarrowDebug` draws over a skeleton: bones, region and mesh shapes, bounding boxes, clipping, paths, point attachments, event names and overdraw. The shapes are the ones the official runtime computes, to the bit. The `overdraw` layer fills every triangle that the skeleton draws with an additive color. So the bright parts are where the GPU paints a pixel many times. The overlays draw with [pixi-silk](https://pixi-silk.schmooky.dev), an optional peer: `npm install pixi-silk` to use them.

## For AI agents

- [llms.txt](https://pixi-marrow.schmooky.dev/llms.txt) lists the pages of the docs, and [llms-full.txt](https://pixi-marrow.schmooky.dev/llms-full.txt) holds all of them in one file.
- Each docs page has a Markdown twin: `/guide/play.md` for `/guide/play/`.
- The entry `pixi-marrow/diagnose` reads a running scene. `inspect(hero)` returns the state of one skeleton as plain data, and `diagnose(root)` lists the performance rules that a Pixi tree breaks.
- [Performance rules](https://pixi-marrow.schmooky.dev/performance/rules/) has one anchor for each rule id, such as `#marrow001`.
- A `MarrowError` has a `code`, a `fix` and the valid names, and `hero.info` describes a skeleton as plain data.

## Docs site

```bash
pnpm site:dev
```

The site in `apps/site` holds the guide, How it works with its diagrams and live previews, a lab and a playground. It is at [pixi-marrow.schmooky.dev](https://pixi-marrow.schmooky.dev). The previews show the symbols of the slot game Bzzz, whose rigs are in `fixtures/bzzz`.

## Goals

- One runtime for 4.1, 4.2 and 4.3 files, mixed in one scene.
- Less overdraw, fewer batch breaks, and one premultiplied pipeline with additive slots in the same batch.
- A pose core built for speed and low memory. Typed arrays, no allocation in an update that reports no event, no work that cannot change the picture. `packages/pixi-marrow/tests/pose/heap.test.ts` measures the heap of playing engines.
- A small API that people and AI agents can use from one page of docs.
- Every frame checked against the official `spine-core` of the file's own version.

## Entry points

<!-- facts:entry-points -->
| Import | Holds |
|---|---|
| `pixi-marrow` | `MarrowSpine`, the display object, with `MarrowAsset`, `Track` and `MarrowError`. Needs `pixi.js`. |
| `pixi-marrow/core` | `importSkeleton`, `importAtlas`, `createPoseEngine`, the geometry functions, `describeSkeleton` and the model types. No Pixi. Runs in Node. |
| `pixi-marrow/optimize` | `generateNames`, `buildAtlasOutlines`, `decodePng` and the `pixi-marrow` command line tool (`info`, `typegen`, `outlines`, `rules`, `diagnose`). Runs in Node. |
| `pixi-marrow/debug` | `MarrowDebug`: overlays of bones, attachment shapes, bounding boxes, clipping, paths, points, events and overdraw over a `MarrowSpine`. Draws with the optional peer `pixi-silk`. |
| `pixi-marrow/bake` | `bakeAnimation` and `bakeAnimations`: animations sampled at a fixed rate, at build time in Node or in a game. `encodeBakedClips`, `decodeBakedClips` and `addBakedClips` hand the clips to an asset. No Pixi. |
| `pixi-marrow/diagnose` | `diagnose`, `watch`, `inspect`, `serializeTree`, `diagnoseTree` and `installDevtools`. They read every skeleton of a Pixi scene tree as plain data. They name each cause of cost with a rule id and a docs address. For coding agents and PixiJS DevTools. |
| `pixi-marrow/perf-rules.json` | The catalogue of the performance rules as JSON: id, pattern, cost, fix and docs address of each. |
| `pixi-marrow/perf` | `createProbe`: times the pose, geometry and event work of every update of one `MarrowSpine` and counts what the renderer did. For benchmarks and profiling. |
<!-- /facts:entry-points -->

## Work on it

Node <!-- fact:floor.node -->24.0<!-- /fact --> or later and pnpm 10. CI runs Node 24.

```bash
pnpm install
pnpm check        # every gate CI runs
pnpm test         # unit tests and the parity suite
pnpm parity:ref   # one line per fixture: the poses the official cores give
```

The parity suite runs on the official Spine example exports. `pnpm fixtures` downloads them into `fixtures/.cache`. The repo does not hold them.

Your own rigs go into `fixtures/local/`: a `.json` or `.skel` file with its `.atlas` next to it. The suite includes them. The repo does not hold that folder either.

[AGENTS.md](AGENTS.md) explains the layout and the rules. The design and its history are in [docs/DESIGN.md](docs/DESIGN.md).

## Licence

The Spine Runtimes License, in [LICENSE](LICENSE). The pose core of pixi-marrow is a port of the official Spine Runtimes, so pixi-marrow is a derivative work of them.

Each user of pixi-marrow needs their own Spine Editor licence, as for the official runtimes. A copy of pixi-marrow in any form must include the licence and its copyright notice.

The licence does not cover the rigs in `fixtures/bzzz`. See [their notes](fixtures/bzzz/README.md).
