/**
 * Facts that more than one file repeats. scripts/gen-facts.mjs writes them into README.md and
 * AGENTS.md between marker comments, and fails the build when a copy is stale.
 */

export const STATUS =
    'Pre-release, milestone M3. Skeletons of Spine 4.1, 4.2 and 4.3 load, play and draw in PixiJS v8, with IK, transform and path constraints and with clipping, and the picture matches the official runtime. Physics and slider constraints are not solved yet: a skeleton that has them plays only with them ignored.';

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
        holds: '`generateNames`, `buildAtlasOutlines`, `decodePng` and the `pixi-marrow` command line tool (`info`, `typegen`, `outlines`). Runs in Node.',
    },
];
