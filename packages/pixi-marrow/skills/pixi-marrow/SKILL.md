---
name: pixi-marrow
description: Use pixi-marrow to load and play Spine 4.1 to 4.3 skeletons in PixiJS v8, and find why a scene with skeletons is slow.
---

# pixi-marrow

Use this skill when a project imports `pixi-marrow`, or when a PixiJS v8 game has to show a Spine skeleton. Use it also when a scene with skeletons has too many draw calls or drops frames.

Read `node_modules/pixi-marrow/AGENTS.md` first. It holds the entry points, the calls and the table of the performance rules.

## Use the package

1. Check the files. A skeleton is a `.skel` or `.json` export of Spine 4.1, 4.2 or 4.3, with a `.atlas` file and its page images.
2. Write the names type: `npx pixi-marrow typegen hero.skel --out hero.names.ts`.
3. Load with `await MarrowSpine.load<HeroNames>({ skeleton, atlas })` and add the result to the stage.
4. Play with `hero.play(name, { loop: true })`. Queue with `hero.queue(name)`. Wait with `await track.finished`.
5. Listen with `hero.on('event', (event, track) => {})`.
6. Add no performance option. The defaults are exact, and each option with a cost is opt-in.
7. For an error, read `error.code`, `error.fix` and `error.docs` of the `MarrowError`.

## Diagnose a slow scene

1. Add `installDevtools({ root: app.stage, renderer: app.renderer })` from `pixi-marrow/diagnose` to the development build.
2. In the page, run `const watching = __PIXI_MARROW__.watch()`.
3. Let the scene play for two seconds, in the state that is slow.
4. Run `watching.report()`. Read `hits`, the warnings first.
5. For each hit, open `docs` when the `fix` is not clear. Change the display object that `cause` names.
6. Run `watching.report()` again after some frames. The hit must be gone.
7. For one skeleton, `__PIXI_MARROW__.inspect(hero)` gives its counters, and `await hero.perf.report()` gives the reasons.

When no code can run in the page, ask for `JSON.stringify(__PIXI_MARROW__.tree())` as a file. Then run `npx pixi-marrow diagnose tree.json`. That finds the causes that one look shows, and not the ones that need two looks.

## Rules of thumb

- Skeletons that draw next to each other share draw calls. Another display object between them ends the batch.
- A container that moves or fades above batched skeletons must be a render group: `isRenderGroup: true`.
- A skeleton at rest costs close to nothing. Check `inspect(hero).frame.uploadBytes`, which is 0 after a frame at rest.
- The ids `MARROW001` to `MARROW026` are stable. `node_modules/pixi-marrow/perf-rules.json` holds them as data.
