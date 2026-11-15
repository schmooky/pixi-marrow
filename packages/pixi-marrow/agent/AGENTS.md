# pixi-marrow for coding agents

This file ships in the npm package `pixi-marrow`. It tells a coding agent how to use the package in a game, and how to find what costs time in a scene. The guide for work on the repo itself is the `AGENTS.md` in the GitHub repo.

## What the package is

pixi-marrow is a Spine runtime for PixiJS v8. It plays skeletons that the Spine editor exported as 4.1, 4.2 or 4.3, on WebGL2 and WebGPU. `MarrowSpine` is a Pixi `Container`. The package needs `pixi.js` 8.21 or later and has no other dependency.

```bash
npm install pixi-marrow@next pixi.js
```

## Entry points

| Import | Use it for |
|---|---|
| `pixi-marrow` | `MarrowSpine`, `MarrowAsset`, `Track`, `MarrowError`, `registerMarrowAssets` |
| `pixi-marrow/core` | Readers and pose engines without Pixi. Runs in Node |
| `pixi-marrow/optimize` | `generateNames`, `buildAtlasOutlines` and the command line tool |
| `pixi-marrow/bake` | Animations baked at build time or in the game |
| `pixi-marrow/debug` | `MarrowDebug`, overlays of bones, shapes and overdraw |
| `pixi-marrow/perf` | `createProbe`, which times the updates of one skeleton |
| `pixi-marrow/diagnose` | `diagnose`, `watch`, `inspect`, `serializeTree`, `installDevtools` |
| `pixi-marrow/perf-rules.json` | The performance rules as data |

## Load

```ts
import { MarrowSpine } from 'pixi-marrow';

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
app.stage.addChild(hero);
hero.position.set(400, 500);
// hero.destroy() also unloads the files when no other copy uses them
```

Loads of the same files share one asset. For many copies, load the asset once with `MarrowAsset.load` and call `new MarrowSpine(asset)` for each copy. With Pixi `Assets`, call `registerMarrowAssets()` once, and then `MarrowSpine.from({ skeleton, atlas })` with the aliases.

## Play

```ts
hero.play('idle', { loop: true });
const shot = hero.play('shoot', { track: 1, mix: 0.1, speed: 1.5 });
const reason = await shot.finished; // 'complete', 'interrupted', 'stopped' or 'destroyed'
hero.stop({ track: 1, mix: 0.2 });
hero.setMix('idle', 'run', 0.2);
hero.timeScale = 0.5;
```

## Queue

```ts
hero.play('jump');
hero.queue('land', { mix: 0.1 });
hero.queue('run', { loop: true, mix: 0.2, delay: 0.5 });
const last = hero.queue('idle', { loop: true });
console.log(last.animation);
await hero.play('win').finished;
```

## Events

```ts
hero.on('event', (event, track) => console.log(event.name, track.animation));
hero.on('complete', (track) => console.log(track.animation, 'played to its end'));
hero.once('start', (track) => console.log(track.animation, 'started'));
hero.on('end', (track) => console.log(track.animation, 'will not be applied again'));
hero.off('complete');
// the names are start, interrupt, end, dispose, complete and event
```

## Typed names

The command line tool writes a type with every name of a skeleton. A wrong animation, skin, bone or slot name then does not compile.

```bash
npx pixi-marrow typegen hero.skel --out hero.names.ts --name HeroNames
```

```ts
import type { HeroNames } from './hero.names';

const hero = await MarrowSpine.load<HeroNames>({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
```

## Errors

The package throws one error type, `MarrowError`. Read `error.code`, `error.fix`, `error.closest` and `error.docs`. Do not parse the message. An unknown option key throws `invalid-option` with the closest name.

## Options that cost something are opt-in

The default is exact. A skeleton looks and moves as in the official runtime, and the runtime does only work that changes no pixel. Do not add a performance option before a measurement or a rule asks for it.

- `perf: 'balanced'` or `perf: 'fast'` changes when a skeleton updates, and nothing else.
- `tightMesh: 'on'`, `bake`, `idleCache`, `lod`, `skinning: 'gpu'` and `instancing` each cost memory, vertices or exactness. Set each one by name.
- Outlines make the exact cuts of overdraw possible. Build them with `npx pixi-marrow outlines hero.atlas` and pass the file as `outlines`.
- `await hero.perf.report()` lists every decision of the runtime for one skeleton, with the reason.

## Diagnose a scene

Add one line to the development build. The package registers nothing until that call.

```ts
import { installDevtools } from 'pixi-marrow/diagnose';

installDevtools({ root: app.stage, renderer: app.renderer });
```

Then run code in the page, through the console or a browser tool.

```ts
__PIXI_MARROW__.diagnose(app.stage).hits; // the causes that one look finds
const watching = __PIXI_MARROW__.watch(app.stage); // note the counters
watching.report().hits; // after some frames: also the causes that show over time
__PIXI_MARROW__.inspect(); // each skeleton as plain data
JSON.stringify(__PIXI_MARROW__.tree()); // save it, then run: npx pixi-marrow diagnose tree.json
```

Each hit has `id`, `node`, `cause`, `cost`, `measured`, `message`, `fix` and `docs`. `node` is the path of the skeleton in the tree, and `cause` is the path of the display object to change. Apply the `fix` to the `cause`, then call `report()` again to check that the hit is gone.

Without the hook, find skeletons by the field `isMarrowSpine` and read `hero.stats`. The functions `diagnose(root)` and `inspect(hero)` of `pixi-marrow/diagnose` do the same work as the hook.

## Performance rules

<!-- rules:table -->
| Id | Cause | Fix |
| --- | --- | --- |
| [MARROW001](https://pixi-marrow.schmooky.dev/performance/rules/#marrow001) | A display object above a batched skeleton moves | Set `isRenderGroup: true` on the container that moves, or set `renderMode: 'mesh'` on the skeleton. |
| [MARROW002](https://pixi-marrow.schmooky.dev/performance/rules/#marrow002) | The alpha or the tint above a batched skeleton changes | Fade a container that has `isRenderGroup: true`, fade slots with `hero.slot(name).alpha`, or set `renderMode: 'mesh'`. |
| [MARROW003](https://pixi-marrow.schmooky.dev/performance/rules/#marrow003) | An alpha or a blend mode above the skeleton stops occlusion and the idle image | Keep the alpha at 1 and the blend mode at `normal` while the skeleton is at rest. Fade for a short time only. |
| [MARROW004](https://pixi-marrow.schmooky.dev/performance/rules/#marrow004) | Another display object draws between two batched skeletons | Put the skeletons into one container and the other objects into a container above or below it. |
| [MARROW005](https://pixi-marrow.schmooky.dev/performance/rules/#marrow005) | A sorted container mixes skeletons with other display objects | Give the skeletons one range of `zIndex` values, or put them into a layer of their own. |
| [MARROW006](https://pixi-marrow.schmooky.dev/performance/rules/#marrow006) | A blend mode splits the draws of a skeleton | Use additive slots where the art allows it. Put skeletons with the same blend mode next to each other in the draw order. |
| [MARROW007](https://pixi-marrow.schmooky.dev/performance/rules/#marrow007) | More atlas pages than one draw can sample | Pack the atlas into fewer pages, or share one atlas between the skeletons of a layer. |
| [MARROW008](https://pixi-marrow.schmooky.dev/performance/rules/#marrow008) | The device samples fewer textures than the skeleton needs in a batch | Pack the atlas into fewer pages than the device samples in one batch. |
| [MARROW009](https://pixi-marrow.schmooky.dev/performance/rules/#marrow009) | Many copies of a skeleton that is too large to batch | Set `skinning: 'gpu'` and `instancing: 'auto'`, or use a skeleton with fewer vertices. |
| [MARROW010](https://pixi-marrow.schmooky.dev/performance/rules/#marrow010) | A clipping attachment in the batched mode | Remove the clipping attachment in the Spine editor, or keep the clipped slots few and small. |
| [MARROW011](https://pixi-marrow.schmooky.dev/performance/rules/#marrow011) | A clipping attachment in the mesh mode | Remove the clipping attachment in the Spine editor, or set `renderMode: 'batched'` for a small skeleton. |
| [MARROW012](https://pixi-marrow.schmooky.dev/performance/rules/#marrow012) | A container attached to a slot | Use `hero.follow(bone, container)` where the container can draw above or below the whole skeleton. |
| [MARROW013](https://pixi-marrow.schmooky.dev/performance/rules/#marrow013) | A skeleton without dark colors draws before one with dark colors | Draw a skeleton with dark colors first in the layer, or keep the two kinds in separate layers. |
| [MARROW014](https://pixi-marrow.schmooky.dev/performance/rules/#marrow014) | Pixi builds the instructions of the render group again and again | Keep display objects in a pool and move them off the screen. Give a layer that changes often a render group of its own. |
| [MARROW015](https://pixi-marrow.schmooky.dev/performance/rules/#marrow015) | A skeleton that nobody sees still updates | Set `perf: 'balanced'` or `offscreen: 'pause'`, or stop the `update()` calls for a hidden skeleton. |
| [MARROW016](https://pixi-marrow.schmooky.dev/performance/rules/#marrow016) | The renderer turns the cuts of overdraw off | Turn `roundPixels` and `antialias` off, or accept the overdraw. |
| [MARROW017](https://pixi-marrow.schmooky.dev/performance/rules/#marrow017) | A filter or a mask above the skeleton | Put the filter or the mask on the smallest container that needs it, and remove it when its effect ends. |
| [MARROW018](https://pixi-marrow.schmooky.dev/performance/rules/#marrow018) | A playing skeleton below a container with `cacheAsTexture` | Cache only containers whose skeletons are at rest. For one skeleton at rest, use `idleCache: 'auto'`. |
| [MARROW019](https://pixi-marrow.schmooky.dev/performance/rules/#marrow019) | The idle cache draws and drops its image again and again | Set `idleCache: 'off'` for a skeleton that does not rest for seconds. |
| [MARROW020](https://pixi-marrow.schmooky.dev/performance/rules/#marrow020) | The asset has no outlines | Run `pixi-marrow outlines <atlas>` at build time and pass the file as the `outlines` option of the load. |
| [MARROW021](https://pixi-marrow.schmooky.dev/performance/rules/#marrow021) | A page texture blocks the cuts of overdraw | Load the page textures at the size of the atlas, with no mipmaps, no anisotropy and no repeat. |
| [MARROW022](https://pixi-marrow.schmooky.dev/performance/rules/#marrow022) | Physics constraints run in every update | Set `hero.physics = 'none'` for small or far skeletons, or set `lod: 'auto'`. |
| [MARROW023](https://pixi-marrow.schmooky.dev/performance/rules/#marrow023) | The runtime builds the vertex layout again and again | Set the skins once. To change one attachment, use `hero.slot(name).attachment`. |
| [MARROW024](https://pixi-marrow.schmooky.dev/performance/rules/#marrow024) | More mesh draws on WebGPU than the shared uniform buffer of Pixi holds | Use the batched mode for small skeletons, or `skinning: 'gpu'` with `instancing: 'auto'` for large ones. |
| [MARROW025](https://pixi-marrow.schmooky.dev/performance/rules/#marrow025) | A Spine 4.3 track changes its animation faster than the mix | Let a mix end before the next change, or change with `mix: 0`. |
| [MARROW026](https://pixi-marrow.schmooky.dev/performance/rules/#marrow026) | The mesh mode uploads whole buffers on pixi.js before 8.23 | Use pixi.js 8.23 or later. |
<!-- /rules:table -->

## Docs

- Site: https://pixi-marrow.schmooky.dev
- Rules: https://pixi-marrow.schmooky.dev/performance/rules/
- For language models, as an index: https://pixi-marrow.schmooky.dev/llms.txt
- For language models, in one file: https://pixi-marrow.schmooky.dev/llms-full.txt
- Each docs page as Markdown: the address of the page with `.md` in place of the last slash.
