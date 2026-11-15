#!/usr/bin/env node
/**
 * What an app pays for pixi-marrow: bundles typical imports of the built package the way an app
 * bundler does (package `exports` and `sideEffects`, pixi.js external, minified) and reports the
 * gzipped size of each, compared with ci/size-baseline.json. Also checks that tree-shaking works:
 * an import that has no business pulling in a module must not contain its marker. Sizes count the
 * code an app loads up front. Chunks behind a dynamic import() load only when used, so they are
 * listed on their own and not added.
 *
 * The root import also has a limit of its own, `ROOT_IMPORT_LIMIT` of scripts/size-limit.mjs. The
 * baseline moves with every accepted change, so 10% over it can add up to far more than the limit.
 * The readers, the pose engines, the mesh mode and the code for clips load on demand, and each
 * has a limit too: `ON_DEMAND_LIMITS`.
 *
 * scripts/facts.mjs imports `measureSizes` for the sizes that the docs state, so the docs and this
 * check read one measurement. The report and the verdict run only when this file is the script.
 *
 *   --check   fail when an import grew more than 10% over the baseline, the root import or code
 *             on demand is over its limit, or a marker check fails
 *   --update  rewrite the baseline. Refused when a limit is passed
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';
import { ON_DEMAND_LIMITS, ROOT_IMPORT_ENTRY, ROOT_IMPORT_LIMIT } from './size-limit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = join(root, 'packages/pixi-marrow');
const baselinePath = join(root, 'ci/size-baseline.json');
const work = join(root, 'node_modules/.cache/size-check');
const TOLERANCE = 0.1;

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
                    `${what}: no chunk on demand starts at dist/${module}. Fix ON_DEMAND in scripts/size-check.mjs`,
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

/** The report and the verdict of the command line. */
async function main() {
    const { results: upfront, onDemand, notes, failures } = await measureSizes();
    // one table: the imports, then the code on demand, which has no size before gzip to show
    const results = { ...upfront, ...onDemand };

    for (const note of notes) console.log(note);

    const baseline = (() => {
        try {
            return JSON.parse(readFileSync(baselinePath, 'utf8'));
        } catch {
            return {};
        }
    })();
    const width = Math.max(...Object.keys(results).map((n) => n.length));

    console.log(`${'import'.padEnd(width)}  ${'minified'.padStart(10)}  ${'gzip'.padStart(9)}  baseline`);
    for (const [name, { minified, gzip }] of Object.entries(results)) {
        const base = baseline[name]?.gzip;
        const drift = base ? (gzip - base) / base : 0;
        const note = base ? `${kb(base)} (${drift >= 0 ? '+' : ''}${(drift * 100).toFixed(1)}%)` : 'none';

        console.log(
            `${name.padEnd(width)}  ${(minified === undefined ? '' : kb(minified)).padStart(10)}  ${kb(gzip).padStart(9)}  ${note}`,
        );
        if (base && drift > TOLERANCE)
            failures.push(`${name}: ${kb(gzip)} gzip is more than 10% over the baseline ${kb(base)}`);
        if (!base && process.argv.includes('--check'))
            failures.push(`${name}: no baseline. Record one with: pnpm size:update`);
    }

    // a limit is not a baseline: --update does not accept a size over one
    const limits = { [ROOT_IMPORT_ENTRY]: ROOT_IMPORT_LIMIT, ...ON_DEMAND_LIMITS };
    const overLimit = [];

    for (const [name, limit] of Object.entries(limits)) {
        const size = results[name]?.gzip;

        if (size === undefined)
            overLimit.push(`${name}: not measured, though scripts/size-limit.mjs has a limit for it`);
        else if (size > limit) {
            overLimit.push(`${name}: ${kb(size)} gzip is over the limit of ${kb(limit)} in scripts/size-limit.mjs`);
        } else console.log(`size-check: ${name} is ${kb(limit - size)} under its limit`);
    }
    for (const name of Object.keys(onDemand)) {
        if (!(name in ON_DEMAND_LIMITS))
            overLimit.push(`${name}: no limit in ON_DEMAND_LIMITS of scripts/size-limit.mjs`);
    }
    failures.unshift(...overLimit);

    if (process.argv.includes('--update') && !overLimit.length) {
        writeFileSync(
            baselinePath,
            `${JSON.stringify(Object.fromEntries(Object.entries(results).map(([n, r]) => [n, { gzip: r.gzip }])), null, 2)}\n`,
        );
        console.log('size-check: baseline updated');
    } else if (failures.length) {
        for (const f of failures) console.error(`size-check: ${f}`);
        if (overLimit.length) {
            console.error(
                'Make that code smaller, or raise the limit in scripts/size-limit.mjs in a commit of its own that says why.',
            );
        }
        if (process.argv.includes('--check') || process.argv.includes('--update')) {
            if (!overLimit.length) console.error('If the growth is intended: pnpm size:update');
            process.exit(1);
        }
    }
}

// the path of the command line can pass through a link, and the URL of a module never does
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
