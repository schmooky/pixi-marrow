# pixi-marrow

A Spine runtime for PixiJS v8 with its own pose core. It plays Spine 4.1, 4.2 and 4.3 skeletons.

<!-- facts:status -->
Pre-release, milestone M2a. Skeletons of Spine 4.1, 4.2 and 4.3 import and play without a renderer, and their poses equal the official runtimes exactly. Constraints are not solved yet. Nothing renders yet.
<!-- /facts:status -->

The plan is in [docs/DESIGN.md](docs/DESIGN.md).

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
| `pixi-marrow` | `MarrowError`. The display object arrives with milestone M2b. |
| `pixi-marrow/core` | `importSkeleton`, `importAtlas`, `createPoseEngine`, the geometry functions, `describeSkeleton` and the model types. No Pixi. Runs in Node. |
| `pixi-marrow/optimize` | `generateNames` and the `pixi-marrow` command line tool (`info`, `typegen`). Runs in Node. |
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
