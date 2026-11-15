# AGENTS.md

Instructions for AI coding agents and for people working in this repo. Read it before you change anything.

## 1. What this repo is

pixi-marrow is a Spine runtime for PixiJS v8. It has its own pose core and its own render path, and it plays Spine 4.1, 4.2 and 4.3 skeletons. The plan, the classes and the milestones are in `docs/DESIGN.md`.

<!-- facts:status -->
Pre-release, published as `pixi-marrow@next`. Skeletons of Spine 4.1, 4.2 and 4.3 load, play and draw in PixiJS v8 with every constraint solved: IK, transform, path, physics and sliders. The poses equal the official cores to the bit, and the picture matches the official Pixi runtime. Small skeletons share draw calls, and a skeleton at rest costs close to nothing.
<!-- /facts:status -->

```
packages/pixi-marrow/   the library
  src/                  source, one folder per layer
  tests/                vitest, node environment
  tests/parity/         the parity suite: official cores, fixtures, reference models and poses
  bin/                  the pixi-marrow command line tool, a thin wrapper around dist
  api.md                snapshot of the public API
scripts/                repo checks and generators
fixtures/               manifest of the official example exports. Downloads are not committed
docs/DESIGN.md          the design
docs/EXPLAINING.md      how the docs explain: the standard for every page of the site
```

Entry points:

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

## 2. What it is not

| Out of scope | Where it belongs |
|---|---|
| Canvas 2D or WebGL1 | Not supported |
| Spine 3.8 and 4.0 | Not planned |
| A runtime dependency on `spine-core` | The official cores are dev dependencies for the parity suite |
| Editing skeletons | The Spine editor |

## 3. Layers

A file imports only from its own layer or the layers above it in this table. `pnpm check:source` enforces it.

| Layer | Folder | Holds |
|---|---|---|
| base | `src/base` | Errors and helpers |
| model | `src/model` | The immutable skeleton model |
| formats | `src/formats` | Version sniffing and importers |
| pose | `src/pose` | Timelines, player, constraints, skinning kernels |
| geometry | `src/geometry` | Vertex positions and UVs, region outlines, opaque rectangles, the triangulator, the clip kernel |
| render | `src/render` | The view: the batched and the mesh mode, shaders, clipping, overdraw cuts |
| api | `src/api` | The display object and handles |
| features | `src/bake`, `src/debug`, `src/perf`, `src/optimize` | Optional entry points |

`base`, `model`, `formats`, `pose`, `geometry`, `render`, `api`, `optimize` and `perf` have files today. The others arrive with their milestones.

`src/render` turns a pose into a picture (`SkeletonView`) in one of two modes. The batched mode feeds Pixi's batch pipe through batchers of our own, so skeletons share draw calls. The mesh mode draws Pixi meshes with our shader, for large rigs. `src/api` is the public display object (`MarrowSpine`) on top of a pose engine and a view.

`src/pose` has two engines behind one interface: `legacy` plays 4.1 and 4.2 skeletons, `v43` plays 4.3 skeletons. The official runtimes mix animations differently, so the two engines do not share a player. Each engine ports the constraint solvers and the update order of its own official runtime.

The engines solve every constraint: IK, transform, path, physics and sliders. A slider of 4.3 writes the applied pose. So `PoseState` holds what the view draws, and the animated pose of what a slider touches stays inside the engine. `PoseState.yDown` is the official static `Skeleton.yDown`: the display object sets it, and physics reads it for the direction of gravity.

`src/formats` has one folder per reader: `json42` and `binary42` read 4.1 and 4.2 files, `json43` and `binary43` read 4.3 files. `shared` holds what they have in common.

`base`, `model`, `formats`, `pose` and `geometry` are the headless core. They never import `pixi.js`.

## 4. Invariants

- Parity is the law. The official `spine-core` of a file's version is the specification, quirks included. A change that makes a parity test fail is wrong.
- No `spine-core` in `src`. Only tests import the official cores.
- The model is a faithful import. A reader stores what its file holds and does not convert between versions.
- A reader mirrors the official reader of its own version, bugs included. It is stricter only where the official reader would crash, hang or store garbage. There it throws.
- No runtime dependencies. `pixi.js` will be the one peer.
- Speed and memory are goals of equal weight. Pose data lives in typed arrays. A played loop allocates nothing after warm-up. The runtime stores once what all instances can share. State of a feature exists only for a skeleton that uses the feature.
- Code that most games never call loads on demand, not with the root import. The size check guards the root.
- An optimization that is on by default must be exact. It needs a test that runs it on and off.
- An optimization that is not exact to the bit is an option. Its doc states what changes in the picture, and the pixel check bounds it. `tightMesh: 'on'` is the first one.
- The two render modes each pass the pixel check against the official runtime. They are not equal to each other to the bit, and the pixel check bounds their difference.
- A change of draw order, visibility, attachment or color never makes Pixi rebuild the instructions of a render group. The runtime rewrites the data in place.
- The package registers nothing with Pixi at import. It has no side effects.
- Work follows change. A pose state has a version and stamps per bone and slot. A value never changes without its stamp, and the parity suite checks that. Code that writes a pose array calls `touchPose` or sets the stamps.
- Code skips no work because nobody looks at its result. It may skip work only where we know that the result is the same bits.
- Never fail silently. Unsupported data throws `MarrowError` with a code, the cause and the fix.
- Source files stay under 500 lines. No `as any`, no double casts, no TypeScript suppression comments.
- Public symbols have TSDoc with a one-line summary and an `@example`.
- Text is plain ASCII, without filler words, in short sentences. The docs follow ASD-STE100, Simplified Technical English, as `docs/EXPLAINING.md` says. `pnpm lint:prose` checks it.

## 5. Common tasks

| Task | Steps |
|---|---|
| Add an entry point | Add the export to `packages/pixi-marrow/package.json`, the file to `src/` and a row to `scripts/facts.mjs`. Then run `pnpm facts` and `pnpm api:update`. |
| Change the public API | Change the code, run `pnpm build` and `pnpm api:update`, and commit `packages/pixi-marrow/api.md`. |
| Change the model | Change the types in `src/model`, the reference in `tests/parity/model41.ts`, `model42.ts` and `model43.ts`, and every reader. `tests/parity/model.test.ts` decides when it is right. |
| Add an official fixture | Add the rig name to `rigs` in `fixtures/manifest.json`, then run `pnpm fixtures:refresh`. |
| Add your own fixture | Put the skeleton and its atlas into `fixtures/local/`. |
| Add an error code | Extend `MarrowErrorCode` in `src/base/errors.ts` and throw it with a `fix`. |
| Accept a size change | Run `pnpm size:update`. The root import also has a fixed limit in `scripts/size-limit.mjs`, which `pnpm size:check` enforces. Raise it only in a commit of its own that says why. |
| Accept a change in bytes per instance | Run `pnpm memory:update`. |
| Release a version | Follow section 8. |

## 6. Before you say done

```bash
pnpm check
```

It runs every gate. First lint, the prose check, typecheck, the source rules and the facts check. Then tests with coverage, the build, the API snapshot, the publish contents check, the size check and the dead code check. CI runs the same steps. It also lints the commit messages of a pull request. On the lowest peers that the package allows, it runs the typecheck and the unit tests.

A change to `src/render`, `src/api` or the shaders also needs the pixel check. It is not part of `pnpm check`, because it needs Google Chrome:

```bash
pnpm check:render
```

It draws rigs with pixi-marrow and with the official Pixi runtime in headless Chrome, on WebGL2 and WebGPU, and compares the pixels. It also compares pixi-marrow with its overdraw cuts on and off. Images of failing cases land in `.shots/render/`. CI does not run it, because its runners have no GPU. Run it on your own machine.

When a frame fails against the official runtime, the check draws it again, moved by a fraction of a pixel. The frame fails only when it fails at both places. The two runtimes place vertices in different code, so a vertex on a subpixel boundary can round two ways. A defect stays wrong after the move.

For a change to the render path, also run the pixel check on the lowest pixi.js that the package allows: `pnpm check:render --pixi=8.21.0`. Version 8.21.0 is installed for that.

The pixel check ends with a game check. Its cases come from a bundle built as a game builds one, with named imports and tree shaking. Pixi registers pipes when modules load, so code that loads on demand must not need a pipe that the game never imported.

Then, in both render modes, it makes a running game lose its WebGL context and restores the context. The frames after the restore must equal the frames of a run that kept its context. `node scripts/render/restore-check.mjs` runs that step alone.

Its last step builds three rigs with AssetPack and loads them through a Pixi manifest, at resolutions 1 and 0.5. With `MarrowSpine.from`, pixi-marrow must load the same files and draw the same frames as the official runtime with `Spine.from`. `node scripts/render/assets-check.mjs` runs that step alone.

`apps/site` is the docs site: `pnpm site:dev`, `pnpm site:build`. It is the one real bundle in the repo. Build it after a change to what loads on demand.

`fixtures/bzzz` holds the symbol rigs of a real slot game: they run in the parity suite like the official examples.

Measure every change that may cost or save time. `pnpm bench:ab` runs pixi-marrow against the official Pixi runtime in headless Chrome: CPU time, frame time, draw calls and heap per instance. `--scene=rest`, `little`, `mixed` and `moved` measure skeletons that stand still or move little. `pnpm bench:ab --mode=overdraw` compares tight meshes on and off. It prints the spread between runs: a difference inside the spread is not a result. It measures this one machine, not phones.

Library changes need a changeset. Run `pnpm changeset`.

## 7. How to work here

- Read `docs/DESIGN.md` before you design anything. Update it when a decision changes.
- Read `docs/EXPLAINING.md` before you write a page of the site. Every idea starts with a diagram the reader sees move, then the words, then the call.
- Write the test first when the official core defines the answer.
- A performance claim in the docs names its measurement and its machine. Numbers for phones wait for spine-benchmark.
- In code that runs every update, pass indices into typed arrays, not numbers. V8 puts a double on the heap when it crosses a call that is not inlined.
- Commit messages follow Conventional Commits.

## 8. Releases

Changesets runs in pre mode with the tag `next`, so a release is `0.1.0-next.N`. CI publishes nothing. The owner publishes from a terminal, because npm asks for a second factor.

1. Merge the pull requests of the release. Each change to the library brings its changeset in `.changeset/`.
2. On a branch from an up-to-date `main`, run `GITHUB_TOKEN="$(gh auth token)" pnpm version-packages`. The changelog plugin needs the token to link pull requests and authors.
3. Read the new section of `packages/pixi-marrow/CHANGELOG.md`. The version in `packages/pixi-marrow/package.json` moved, and the changesets moved into `.changeset/pre/`.
4. Commit it as `chore: release pixi-marrow <version>` and open the release pull request. Merge it when CI passes. Then wait for the CI run of the merge commit.
5. On `main` at that commit, with a clean working tree, run `pnpm install --frozen-lockfile` and `pnpm changeset publish`.
6. `prepublishOnly` of the package runs `pnpm build` before the package manager makes the tarball. So the tarball never holds an old `dist`. `prepack` copies README and LICENSE into the package, and `postpack` removes them.
7. Push the tag that `changeset publish` made: `git push --follow-tags`.
8. Until 1.0, `latest` points at the newest pre-release too: `npm dist-tag add pixi-marrow@<version> latest`. A new version can take some minutes to show in `npm view pixi-marrow dist-tags`.
