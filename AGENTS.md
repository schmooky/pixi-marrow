# AGENTS.md

Instructions for AI coding agents and for people working in this repo. Read it before you change anything.

## 1. What this repo is

pixi-marrow is a Spine runtime for PixiJS v8. It has its own pose core and its own render path, and it plays Spine 4.1, 4.2 and 4.3 skeletons. The plan, the classes and the milestones are in `docs/DESIGN.md`.

<!-- facts:status -->
Pre-release, milestone M2b. Skeletons of Spine 4.1, 4.2 and 4.3 load, play and draw in PixiJS v8, and the picture matches the official runtime. Constraints and clipping are not solved yet: a skeleton with constraints plays only with them ignored.
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
```

Entry points:

<!-- facts:entry-points -->
| Import | Holds |
|---|---|
| `pixi-marrow` | `MarrowSpine`, the display object, with `MarrowAsset`, `Track` and `MarrowError`. Needs `pixi.js`. |
| `pixi-marrow/core` | `importSkeleton`, `importAtlas`, `createPoseEngine`, the geometry functions, `describeSkeleton` and the model types. No Pixi. Runs in Node. |
| `pixi-marrow/optimize` | `generateNames` and the `pixi-marrow` command line tool (`info`, `typegen`). Runs in Node. |
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
| geometry | `src/geometry` | Templates, tight meshes, clipping |
| render | `src/render` | The Pixi pipe, batcher and shader |
| api | `src/api` | The display object and handles |
| features | `src/bake`, `src/debug`, `src/perf`, `src/optimize` | Optional entry points |

`base`, `model`, `formats`, `pose`, `geometry`, `render`, `api` and `optimize` have files today. The others arrive with their milestones.

`src/render` turns a pose into Pixi meshes (`SkeletonView`). `src/api` is the public display object (`MarrowSpine`) on top of a pose engine and a view.

`src/pose` has two engines behind one interface: `legacy` plays 4.1 and 4.2 skeletons, `v43` plays 4.3 skeletons. The official runtimes mix animations differently, so they do not share a player.

`src/formats` has one folder per reader: `json42` and `binary42` read 4.1 and 4.2 files, `json43` and `binary43` read 4.3 files. `shared` holds what they have in common.

`base`, `model`, `formats` and `pose` are the headless core. They never import `pixi.js`.

## 4. Invariants

- Parity is the law. The official `spine-core` of a file's version is the specification. A change that makes a parity test fail is wrong.
- No `spine-core` in `src`. The official cores are imported in tests only.
- The model is a faithful import. A reader stores what its file holds and does not convert between versions.
- A reader mirrors the official reader of its own version, bugs included. It is stricter only where the official reader would crash, hang or store garbage. There it throws.
- No runtime dependencies. `pixi.js` will be the one peer.
- Speed and memory are goals of equal weight. Pose data lives in typed arrays. A played loop allocates nothing after warm-up. Data that all instances can share is stored once.
- An optimization that is on by default must be exact. It needs a test that runs it on and off.
- Never fail silently. Unsupported data throws `MarrowError` with a code, the cause and the fix.
- Source files stay under 500 lines. No `as any`, no double casts, no TypeScript suppression comments.
- Public symbols have TSDoc with a one-line summary and an `@example`.
- Text is plain ASCII, without filler words, in short sentences. `pnpm lint:prose` checks it.

## 5. Common tasks

| Task | Steps |
|---|---|
| Add an entry point | Add the export to `packages/pixi-marrow/package.json`, the file to `src/` and a row to `scripts/facts.mjs`. Then run `pnpm facts` and `pnpm api:update`. |
| Change the public API | Change the code, run `pnpm build` and `pnpm api:update`, and commit `packages/pixi-marrow/api.md`. |
| Change the model | Change the types in `src/model`, the reference in `tests/parity/model41.ts`, `model42.ts` and `model43.ts`, and every reader. `tests/parity/model.test.ts` decides when it is right. |
| Add an official fixture | Add the rig name to `rigs` in `fixtures/manifest.json`, then run `pnpm fixtures:refresh`. |
| Add your own fixture | Put the skeleton and its atlas into `fixtures/local/`. |
| Add an error code | Extend `MarrowErrorCode` in `src/base/errors.ts` and throw it with a `fix`. |
| Accept a size change | Run `pnpm size:update`. |
| Accept a change in bytes per instance | Run `pnpm memory:update`. |

## 6. Before you say done

```bash
pnpm check
```

It runs every gate. First lint, the prose check, typecheck, the source rules and the facts check. Then tests with coverage, the build, the API snapshot, the publish contents check, the size check and the dead code check. CI runs the same steps.

A change to `src/render`, `src/api` or the shaders also needs the pixel check, which is not part of `pnpm check` because it needs Google Chrome:

```bash
pnpm check:render
```

It draws rigs with pixi-marrow and with the official Pixi runtime in headless Chrome, on WebGL2 and WebGPU, and compares the pixels. Images of failing cases land in `.shots/render/`.

Library changes need a changeset. Run `pnpm changeset`.

## 7. How to work here

- Read `docs/DESIGN.md` before designing anything. Update it when a decision changes.
- Write the test first when the official core defines the answer.
- Keep performance claims out of the docs until spine-benchmark has measured them.
- Commit messages follow Conventional Commits.
