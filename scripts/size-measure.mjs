/**
 * Measures what an app pays for pixi-marrow. scripts/size-check.mjs judges the numbers, and
 * scripts/facts.mjs hands them to the docs, so both read one measurement.
 *
 * It bundles typical imports of the built package the way an app bundler does: package `exports`
 * and `sideEffects`, pixi.js external, minified. A size counts the code an app loads up front.
 * Chunks behind a dynamic import() load only when used, so they are measured on their own.
 *
 * usage: import { measureSizes } from './size-measure.mjs'. Run `pnpm build` first.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';
import { ROOT_IMPORT_ENTRY } from './size-limit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = join(root, 'packages/pixi-marrow');
const work = join(root, 'node_modules/.cache/size-check');

/** name: [what the app imports, markers that must NOT end up in that bundle, subpath (default the root)] */
const IMPORTS = {
    // the root import does not carry the probes of pixi-marrow/perf, and the perf report, the clip
    // kernel, the mesh mode and the cuts of overdraw load on demand. The markers are a message of
    // the probes, a reason of the report, a message of the kernel, the label of the meshes of the
    // mesh mode and a field of the search for covered slots
    everything: [
        '*',
        [
            'has a probe that measures its updates',
            'a draw range samples up to 8',
            'A clip polygon without a vertex cannot clip',
            'marrow-range',
            'coveredBy',
        ],
    ],
    // a game that loads its files by URL does not carry the parsers for Pixi Assets or the code that reads them,
    // and the markers are the name of one and a message of the code that reads Assets. The idle cache
    // loads on demand, and its marker is the label of the sprite of an image
    'root (MarrowSpine)': [
        'MarrowSpine',
        [
            'has a probe that measures its updates',
            'marrow-range',
            'marrowAtlasLoader',
            'Pixi Assets holds no',
            'marrow-debug',
            'marrow-idle',
            // the baked playback loads on demand: a reason it gives
            'the next update plays baked',
            // instanced draws are in the chunk of the mesh mode: the name of their pipe
            'marrowInstances',
        ],
    ],
    // the headless core has no Pixi in it. pixi.js is external, so an import of it stays visible
    'core (everything)': ['*', ['pixi.js'], '/core'],
    'core (sniffSkeleton)': ['sniffSkeleton', ['pixi.js'], '/core'],
    // an app that imports skeletons pays for the dispatcher up front, and loads one reader on demand
    'core (importSkeleton)': ['importSkeleton', ['pixi.js'], '/core'],
    // reading an atlas does not pull in the skeleton readers. The marker is a message of theirs
    'core (importAtlas)': ['importAtlas', ['pixi.js', 'JSON cannot be parsed'], '/core'],
    // the pose engine of one Spine version loads on demand, like the readers
    'core (createPoseEngine)': ['createPoseEngine', ['pixi.js'], '/core'],
    'optimize (generateNames)': ['generateNames', ['pixi.js'], '/optimize'],
    // a probe holds its display object by shape, so the entry needs no Pixi and no code of the root import
    'perf (createProbe)': ['createProbe', ['pixi.js', 'marrow-skeleton'], '/perf'],
    // the overlays draw with pixi-silk, an optional peer that stays outside the bundle like pixi.js
    'debug (MarrowDebug)': ['MarrowDebug', [], '/debug'],
    // the baker runs in Node: no Pixi and no code of the root import
    'bake (bakeAnimation)': ['bakeAnimation', ['pixi.js', 'marrow-skeleton'], '/bake'],
};

/**
 * Chunks of the root import that load on demand and are listed by name, each found by a text
 * only its code holds: the mesh mode by the label of its meshes, the code for clips by a message
 * of the clip kernel, the cuts of overdraw by a field of the search for covered slots, the idle
 * cache by the label of the sprite of an image, the baked playback by a reason it gives.
 */
const NAMED_CHUNKS = {
    'the mesh mode': 'marrow-range',
    'the code for clips': 'A clip polygon without a vertex cannot clip',
    'the cuts of overdraw': 'coveredBy',
    'the idle cache': 'marrow-idle',
    'the baked playback': 'the next update plays baked',
};

/**
 * Code that a game loads the first time a skeleton needs it, each named by the module that the
 * dynamic import() loads. The size is that chunk with the chunks it imports and the root import
 * does not hold. Two readers share such chunks, so the sizes of two entries can count one chunk twice.
 * The key is the name in the report, in ci/size-baseline.json and in `ON_DEMAND_LIMITS` of
 * scripts/size-limit.mjs. `fact` is its name under `size` in scripts/facts.json.
 */
export const ON_DEMAND = {
    'on demand (reader of 4.1 and 4.2 JSON)': { module: 'formats/json42/index.js', fact: 'readers.json42' },
    'on demand (reader of 4.1 and 4.2 binary)': { module: 'formats/binary42/index.js', fact: 'readers.binary42' },
    'on demand (reader of 4.3 JSON)': { module: 'formats/json43/index.js', fact: 'readers.json43' },
    'on demand (reader of 4.3 binary)': { module: 'formats/binary43/index.js', fact: 'readers.binary43' },
    'on demand (pose engine of 4.1 and 4.2)': { module: 'pose/legacy/index.js', fact: 'engines.legacy' },
    'on demand (pose engine of 4.3)': { module: 'pose/v43/index.js', fact: 'engines.v43' },
    'on demand (mesh mode)': { module: 'render/mesh-paint.js', fact: 'meshMode' },
    'on demand (clipping)': { module: 'render/batch-clip.js', fact: 'clipping' },
};

const gzip = (code) => gzipSync(code, { level: 9 }).length;

/**
 * Bundles every import of IMPORTS and measures it.
 *
 * - `results`: per import, the minified and the gzipped bytes of the code it loads up front.
 * - `onDemand`: per entry of ON_DEMAND, the gzipped bytes a game loads when it first needs it.
 * - `notes`: lines for the report. `failures`: a marker that tree shaking should have removed,
 *   or code that should be a chunk of its own and is not.
 */
export async function measureSizes() {
    const results = {};
    const onDemand = {};
    const notes = [];
    const failures = [];

    if (!existsSync(join(pkgDir, 'dist/index.js'))) {
        throw new Error('packages/pixi-marrow/dist is missing. Run: pnpm build');
    }
    // a scratch project that depends on the built package, so resolution goes through its package.json
    rmSync(work, { recursive: true, force: true });
    mkdirSync(join(work, 'node_modules'), { recursive: true });
    symlinkSync(pkgDir, join(work, 'node_modules/pixi-marrow'), 'dir');

    for (const [name, [specifiers, forbidden, subpath = '']] of Object.entries(IMPORTS)) {
        const entry = join(work, `${Object.keys(results).length}.js`);

        writeFileSync(
            entry,
            specifiers === '*'
                ? `export * from 'pixi-marrow${subpath}';\n`
                : `export { ${specifiers} } from 'pixi-marrow${subpath}';\n`,
        );
        const bundle = await rolldown({ input: entry, external: [/^pixi\.js/, /^pixi-silk/], logLevel: 'silent' });
        const { output } = await bundle.generate({ format: 'esm', minify: true });
        // the entry and its static imports. Dynamic chunks load on demand
        const chunks = new Map(output.filter((c) => c.type === 'chunk').map((c) => [c.fileName, c]));
        const closure = (start, seen = new Set()) => {
            if (!start || seen.has(start)) return seen;
            seen.add(start);
            for (const imported of start.imports) closure(chunks.get(imported), seen);

            return seen;
        };
        const upfront = closure([...chunks.values()].find((c) => c.isEntry));
        const code = [...upfront].map((chunk) => chunk.code).join('\n');
        const lazy = [...chunks.values()].filter((c) => !upfront.has(c));

        if (lazy.length) {
            const lazyCode = lazy.map((c) => c.code).join('\n');

            notes.push(`${name}: + ${kb(gzip(lazyCode))} gzip on demand (${lazy.length} chunk)`);
        }
        for (const [what, marker] of name === 'everything' ? Object.entries(NAMED_CHUNKS) : []) {
            const chunk = lazy.find((c) => c.code.includes(marker));

            if (chunk) notes.push(`${name}: ${what} is ${kb(gzip(chunk.code))} gzip on demand`);
            else failures.push(`${name}: no chunk on demand holds "${marker}", so ${what} is not a chunk of its own`);
        }
        for (const [what, { module }] of name === ROOT_IMPORT_ENTRY ? Object.entries(ON_DEMAND) : []) {
            const chunk = lazy.find((c) => c.isDynamicEntry && c.facadeModuleId === join(pkgDir, 'dist', module));

            if (!chunk) {
                failures.push(
                    `${what}: no chunk on demand starts at dist/${module}. Fix ON_DEMAND in scripts/size-measure.mjs`,
                );
                continue;
            }
            const own = [...closure(chunk)].filter((c) => !upfront.has(c));

            onDemand[what] = { gzip: own.reduce((sum, c) => sum + gzip(c.code), 0) };
        }

        await bundle.close();
        results[name] = { minified: code.length, gzip: gzip(code) };
        for (const marker of forbidden) {
            if (code.includes(marker)) failures.push(`${name}: bundle contains "${marker}" (tree-shaking broke)`);
        }
    }
    rmSync(work, { recursive: true, force: true });

    return { results, onDemand, notes, failures };
}

/** Bytes as kilobytes with two decimals, for a report. */
export function kb(n) {
    return `${(n / 1024).toFixed(2)} kB`;
}
