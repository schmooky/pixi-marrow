/**
 * Facts that more than one file repeats. scripts/gen-facts.mjs writes them into README.md and
 * AGENTS.md between marker comments, and fails the build when a copy is stale.
 */

export const STATUS =
    'Pre-release, milestone M1. Skeleton and atlas files of Spine 4.1, 4.2 and 4.3 import into a model that matches the official runtimes. Nothing renders yet.';

/** One row per subpath export of packages/pixi-marrow/package.json. */
export const ENTRY_POINTS = [
    {
        specifier: 'pixi-marrow',
        holds: '`MarrowError`. The display object arrives with milestone M2.',
    },
    {
        specifier: 'pixi-marrow/core',
        holds: '`importSkeleton`, `importAtlas`, `describeSkeleton`, `sniffSkeleton` and the model types. No Pixi. Runs in Node.',
    },
    {
        specifier: 'pixi-marrow/optimize',
        holds: '`generateNames` and the `pixi-marrow` command line tool (`info`, `typegen`). Runs in Node.',
    },
];
