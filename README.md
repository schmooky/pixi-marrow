# pixi-marrow

A Spine runtime for PixiJS v8 with its own pose core. It plays Spine 4.1, 4.2 and 4.3 skeletons.

<!-- facts:status -->
Pre-release, milestone M4. Skeletons of Spine 4.1, 4.2 and 4.3 load, play and draw in PixiJS v8 with every constraint solved: IK, transform, path, physics and sliders. The poses equal the official cores to the bit, and the picture matches the official Pixi runtime.
<!-- /facts:status -->

The plan is in [docs/DESIGN.md](docs/DESIGN.md).

## Use

```ts
import { MarrowSpine } from 'pixi-marrow';

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });

app.stage.addChild(hero);
hero.play('run', { loop: true });
```

Every constraint is solved: IK, transform, path, physics and sliders. Clipping works.

## Tracks and physics

```ts
hero.play('aim', { track: 1, additive: true, alpha: 0.5 });
hero.play('walk', { start: 0.2, end: 1.1, entry: { mixDrawOrderThreshold: 0.5 } });

hero.physics = 'pose';
hero.resetPhysics();
hero.physicsTranslate(dx, dy);
```

`entry` and `track.configure` take any field of the official `TrackEntry` by its official name. `physics` is the official mode: `update`, `pose`, `reset` or `none`. Physics does not follow the Pixi position by itself: tell it with `physicsTranslate` and `physicsRotate`.

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

Not chosen yet. The package is marked private until it is.

A runtime ported from the official Spine Runtimes falls under the Spine Runtimes License, and its users need a Spine licence.
