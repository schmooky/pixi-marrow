/**
 * Facts that more than one file repeats: the one source for what the docs state about the code.
 *
 * - STATUS and ENTRY_POINTS are sentences, written here once.
 * - `collectFacts()` gives the numbers. Each is read from the source, from a manifest or measured
 *   from the build. None is typed here, so a number in the docs cannot differ from the code.
 *
 * scripts/gen-facts.mjs writes them into README.md and AGENTS.md at marker comments and into
 * scripts/facts.json, and fails the build when a copy is stale. A page of the site imports
 * scripts/facts.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureSizes, ON_DEMAND } from './size-check.mjs';
import { ON_DEMAND_LIMITS, ROOT_IMPORT_ENTRY, ROOT_IMPORT_LIMIT } from './size-limit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = join(root, 'packages/pixi-marrow');

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
        holds: '`generateNames`, `buildAtlasOutlines`, `decodePng` and the `pixi-marrow` command line tool (`info`, `typegen`, `outlines`, `rules`, `diagnose`). Runs in Node.',
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
        specifier: 'pixi-marrow/diagnose',
        holds: '`diagnose`, `watch`, `inspect`, `serializeTree`, `diagnoseTree` and `installDevtools`. They read every skeleton of a Pixi scene tree as plain data. They name each cause of cost with a rule id and a docs address. For coding agents and PixiJS DevTools.',
    },
    {
        specifier: 'pixi-marrow/perf-rules.json',
        holds: 'The catalogue of the performance rules as JSON: id, pattern, cost, fix and docs address of each.',
    },
    {
        specifier: 'pixi-marrow/perf',
        holds: '`createProbe`: times the pose, geometry and event work of every update of one `MarrowSpine` and counts what the renderer did. For benchmarks and profiling.',
    },
];

/** The text of a source file of the library. */
const source = (file) => readFileSync(join(pkgDir, 'src', file), 'utf8');

/** The number that `const NAME = <number>;` assigns in a source file. Throws when it is not there. */
function constant(file, name) {
    const match = new RegExp(`^(?:export )?const ${name} = ([0-9][0-9_.]*);`, 'm').exec(source(file));

    if (!match) {
        throw new Error(
            `facts: src/${file} has no "const ${name} = <number>;". Point scripts/facts.mjs at its new place`,
        );
    }

    return Number(match[1].replaceAll('_', ''));
}

/** The one number that every match of `pattern` captures in a source file. Throws for none or for two. */
function literal(file, pattern, what) {
    const found = new Set([...source(file).matchAll(pattern)].map((match) => Number(match[1])));

    if (found.size !== 1) {
        throw new Error(
            `facts: src/${file} states ${what} ${found.size} ways. Point scripts/facts.mjs at its new place`,
        );
    }

    return [...found][0];
}

/** `PERF_PRESETS` of src/api/presets.ts: per preset, each setting and its value. */
function presets() {
    const text = source('api/presets.ts');
    const start = text.indexOf('export const PERF_PRESETS');
    const body = text.slice(start, text.indexOf('\n});', start));
    const found = {};

    for (const [, name, settings] of body.matchAll(/^ {4}(\w+): Object\.freeze\(\{([^}]*)\}\),$/gm)) {
        found[name] = Object.fromEntries(
            [...settings.matchAll(/^\s*(\w+): (?:'([^']*)'|([0-9.]+)),$/gm)].map(([, key, text, number]) => [
                key,
                text ?? Number(number),
            ]),
        );
    }
    const names = Object.keys(found);
    const keys = names.map((name) => Object.keys(found[name]).join());

    if (start === -1 || names.length === 0 || keys.some((list) => list === '' || list !== keys[0])) {
        throw new Error('facts: cannot read PERF_PRESETS of src/api/presets.ts. Teach scripts/facts.mjs its new shape');
    }

    return found;
}

/** The start of a range such as `^8.21.0` or `>=22.12`. */
function floorOf(range, what) {
    const version = /^(?:\^|>=)?\s*(\d+(?:\.\d+){1,2})$/.exec(range ?? '')?.[1];

    if (!version) throw new Error(`facts: the range "${range}" of ${what} does not start at one version`);

    return version;
}

/** Bytes as kilobytes with two digits that count: 32963 is 32, 7491 is 7.3. The docs say "about". */
const kilobytes = (bytes) => Number((bytes / 1024).toPrecision(2));

/** Sets `value` in `target` at a path with dots, and makes the objects on the way. */
function setAt(target, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let at = target;

    for (const key of keys) {
        at[key] ??= {};
        at = at[key];
    }
    at[last] = value;
}

/**
 * Every number the docs state, by a name with dots. Sizes are kilobytes, gzipped, with two digits
 * that count. It bundles the built package, so run `pnpm build` first.
 *
 */
export async function collectFacts() {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const workspace = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const { results, onDemand } = await measureSizes();
    const throttleSeconds = constant('api/pacing.ts', 'THROTTLE');
    const pixi = floorOf(manifest.peerDependencies?.['pixi.js'], 'pixi.js');
    const size = { root: kilobytes(results[ROOT_IMPORT_ENTRY].gzip) };

    for (const [name, { fact }] of Object.entries(ON_DEMAND)) {
        if (!onDemand[name]) throw new Error(`facts: "${name}" was not measured. See pnpm size:check`);
        setAt(size, fact, kilobytes(onDemand[name].gzip));
    }
    setAt(size, 'limit.root', ROOT_IMPORT_LIMIT / 1024);
    for (const [name, bytes] of Object.entries(ON_DEMAND_LIMITS)) {
        if (ON_DEMAND[name]) setAt(size, `limit.${ON_DEMAND[name].fact}`, bytes / 1024);
    }

    return {
        batch: {
            // the most vertices of a skeleton that `auto` draws in the batched mode
            autoVertices: constant('render/mode.ts', 'AUTO_BATCH_VERTICES'),
            // the atlas pages one batch samples
            pages: constant('render/batch-layout.ts', 'GROUP_PAGES'),
        },
        // the atlas pages one draw of the mesh mode samples
        mesh: { pages: constant('render/template.ts', 'MAX_PAGES') },
        lod: {
            // `lod: 'auto'` leaves physics and deform out below this size in pixels, and brings them back above the other
            below: constant('api/pacing.ts', 'LOD_SIZE'),
            back: constant('api/pacing.ts', 'LOD_BACK'),
        },
        offscreen: {
            // `offscreen: 'throttle'`: seconds between two updates, and updates a second
            throttleSeconds,
            throttleRate: 1 / throttleSeconds,
        },
        idleCache: {
            // updates at rest before `idleCache: 'auto'` takes the image, and its largest side in pixels
            waitUpdates: constant('api/idle-image.ts', 'IDLE_WAIT'),
            maxSide: constant('api/idle-image.ts', 'IDLE_MAX_SIDE'),
        },
        // combined skins that no skeleton shows and the runtime still keeps
        skins: { kept: constant('pose/shared/combine-skins.ts', 'KEPT_SKINS') },
        // frames a second of a baked clip, when the caller names none
        bake: { fps: literal('bake/record.ts', /options\.fps \?\? (\d+)/g, 'the default fps') },
        floor: {
            pixi,
            pixiShort: pixi.split('.').slice(0, 2).join('.'),
            pixiSilk: floorOf(manifest.peerDependencies?.['pixi-silk'], 'pixi-silk'),
            node: floorOf(workspace.engines?.node, 'engines.node of the root package.json'),
        },
        // what a game that imports `MarrowSpine` loads up front, then what loads on demand, then the limits
        size,
        presets: presets(),
    };
}

/** The presets as a Markdown table: a row per setting, a column per preset. */
export function presetTable(table) {
    const names = Object.keys(table);
    const cell = (value) => (typeof value === 'string' ? `\`${value}\`` : String(value));

    return [
        `| Setting | ${names.map((name) => `\`${name}\``).join(' | ')} |`,
        `|---|${names.map(() => '---').join('|')}|`,
        ...Object.keys(table[names[0]]).map(
            (setting) => `| \`${setting}\` | ${names.map((name) => cell(table[name][setting])).join(' | ')} |`,
        ),
    ].join('\n');
}
