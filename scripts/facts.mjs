/**
 * Facts that more than one file repeats. scripts/gen-facts.mjs writes them into README.md and
 * AGENTS.md between marker comments, and fails the build when a copy is stale.
 */

export const STATUS =
    'Pre-release, milestone M2b. Skeletons of Spine 4.1, 4.2 and 4.3 load, play and draw in PixiJS v8, and the picture matches the official runtime. Constraints and clipping are not solved yet: a skeleton with constraints plays only with them ignored.';

/** One row per subpath export of packages/pixi-marrow/package.json. */
export const ENTRY_POINTS = [
    {
        specifier: 'pixi-marrow',
        holds: '`MarrowSpine`, the display object, with `MarrowAsset`, `Track` and `MarrowError`. Needs `pixi.js`.',
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
