---
'pixi-marrow': patch
---

A coding agent or a person can now find every skeleton of a scene and name what costs time in it.

Additions:

- The entry `pixi-marrow/diagnose`. `diagnose(root)` walks a Pixi scene tree and returns the causes of cost that one look finds. Each hit has a stable rule id from `MARROW001` to `MARROW026`. It also has the path of the skeleton, the path of the cause, the numbers, a fix and a docs address.
- `watch(root)` notes the counters of every skeleton. Its `report()` adds the causes that show only over time, such as a parent that moves or fades.
- `inspect(hero)` reads one skeleton into plain data: counts, render mode, draw calls, cuts, uploads, pacing, physics and memory.
- `serializeTree(root)` writes the tree as JSON, and `diagnoseTree(json)` runs the static rules on it without Pixi.
- `installDevtools()` puts the hook `__PIXI_MARROW__` on `globalThis`. The package registers nothing until a game calls it. `installDevtools({ warn: true })` prints each hit once per rule and skeleton.
- The command line tool has two more commands: `pixi-marrow rules [--json]` and `pixi-marrow diagnose <tree.json> [--json]`.
- The tarball ships `AGENTS.md` for coding agents that use the package, `perf-rules.json` and `skills/pixi-marrow/SKILL.md`. `pixi-marrow/perf-rules.json` is an export.
- A row of `perf.report()` can carry `rule`, `docs` and `data`. `rule` is the id of the rule that names its cause, and `data` holds the facts of the row for a program.
- `MarrowError.docs` is set for the codes `unsupported-version`, `unknown-name`, `not-registered` and `not-loaded`.
- Each warning of the runtime ends with the address of its docs page.

Fixes:

- The row `motion` of `perf.report()` said "placed no vertex and uploaded nothing" for a pose at rest below a container that moved or faded. It now says what the batch wrote, with the bytes of the frame and the rule id.
