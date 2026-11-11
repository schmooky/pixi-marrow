/**
 * Facts that more than one file repeats. scripts/gen-facts.mjs writes them into README.md and
 * AGENTS.md between marker comments, and fails the build when a copy is stale.
 */

export const STATUS =
    'Pre-release, milestone M2a. Skeletons of Spine 4.1, 4.2 and 4.3 import and play without a renderer, and their poses equal the official runtimes exactly. Constraints are not solved yet. Nothing renders yet.';

/** One row per subpath export of packages/pixi-marrow/package.json. */
export const ENTRY_POINTS = [
    {
        specifier: 'pixi-marrow',
        holds: '`MarrowError`. The display object arrives with milestone M2b.',
    },
    {
        specifier: 'pixi-marrow/core',
        holds: '`importSkeleton`, `importAtlas`, `createPoseEngine`, the geometry functions, `describeSkeleton` and the model types. No Pixi. Runs in Node.',
    },
    {
        specifier: 'pixi-marrow/optimize',
        holds: '`generateNames` and the `pixi-marrow` command line tool (`info`, `typegen`). Runs in Node.',
    },
];
