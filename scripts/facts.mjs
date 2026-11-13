/**
 * Facts that more than one file repeats. scripts/gen-facts.mjs writes them into README.md and
 * AGENTS.md between marker comments, and fails the build when a copy is stale.
 */

export const STATUS =
    'Pre-release, published as `pixi-marrow@next`. Skeletons of Spine 4.1, 4.2 and 4.3 load, play and draw in PixiJS v8 with every constraint solved: IK, transform, path, physics and sliders. The poses equal the official cores to the bit, and the picture matches the official Pixi runtime. Small skeletons share draw calls, and a skeleton at rest costs close to nothing.';

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
    {
        specifier: 'pixi-marrow/debug',
        holds: '`MarrowDebug`: overlays of bones, attachment shapes, bounding boxes, clipping, paths, points, events and overdraw over a `MarrowSpine`. Draws with the optional peer `pixi-silk`.',
    },
    {
        specifier: 'pixi-marrow/bake',
        holds: '`bakeAnimation` and `bakeAnimations`: animations sampled at a fixed rate, at build time in Node or in a game. `encodeBakedClips`, `decodeBakedClips` and `addBakedClips` hand the clips to an asset. No Pixi.',
    },
    {
        specifier: 'pixi-marrow/perf',
        holds: '`createProbe`: times the pose, geometry and event work of every update of one `MarrowSpine` and counts what the renderer did. For benchmarks and profiling.',
    },
];
