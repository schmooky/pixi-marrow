#!/usr/bin/env node
/**
 * What an app pays for pixi-marrow: bundles typical imports of the built package the way an app
 * bundler does (package `exports` and `sideEffects`, pixi.js external, minified) and reports the
 * gzipped size of each, compared with ci/size-baseline.json. Also checks that tree-shaking works:
 * an import that has no business pulling in a module must not contain its marker. Sizes count the
 * code an app loads up front. Chunks behind a dynamic import() load only when used, so they are
 * listed on their own and not added.
 *
 *   --check   fail when an import grew more than 10% over the baseline, or a marker check fails
 *   --update  rewrite the baseline
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

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
};

// a scratch project that depends on the built package, so resolution goes through its package.json
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'node_modules'), { recursive: true });
symlinkSync(pkgDir, join(work, 'node_modules/pixi-marrow'), 'dir');

/**
 * Chunks of the root import that load on demand and are listed by name, each found by a text
 * only its code holds: the mesh mode by the label of its meshes, the code for clips by a message
 * of the clip kernel, the cuts of overdraw by a field of the search for covered slots.
 */
const NAMED_CHUNKS = {
    'the mesh mode': 'marrow-range',
    'the code for clips': 'A clip polygon without a vertex cannot clip',
    'the cuts of overdraw': 'coveredBy',
};

const kb = (n) => `${(n / 1024).toFixed(2)} kB`;
const results = {};
const failures = [];

for (const [name, [specifiers, forbidden, subpath = '']] of Object.entries(IMPORTS)) {
    const entry = join(work, `${Object.keys(results).length}.js`);

    writeFileSync(
        entry,
        specifiers === '*'
            ? `export * from 'pixi-marrow${subpath}';\n`
            : `export { ${specifiers} } from 'pixi-marrow${subpath}';\n`,
    );
    const bundle = await rolldown({ input: entry, external: [/^pixi\.js/], logLevel: 'silent' });
    const { output } = await bundle.generate({ format: 'esm', minify: true });
    // the entry and its static imports. Dynamic chunks load on demand
    const chunks = new Map(output.filter((c) => c.type === 'chunk').map((c) => [c.fileName, c]));
    const upfront = new Set();
    const visit = (chunk) => {
        if (!chunk || upfront.has(chunk)) return;
        upfront.add(chunk);
        for (const imported of chunk.imports) visit(chunks.get(imported));
    };

    visit([...chunks.values()].find((c) => c.isEntry));
    const code = [...upfront].map((chunk) => chunk.code).join('\n');
    const lazy = [...chunks.values()].filter((c) => !upfront.has(c));

    if (lazy.length) {
        const lazyCode = lazy.map((c) => c.code).join('\n');

        console.log(`${name}: + ${kb(gzipSync(lazyCode, { level: 9 }).length)} gzip on demand (${lazy.length} chunk)`);
    }
    for (const [what, marker] of name === 'everything' ? Object.entries(NAMED_CHUNKS) : []) {
        const chunk = lazy.find((c) => c.code.includes(marker));

        if (chunk) console.log(`${name}: ${what} is ${kb(gzipSync(chunk.code, { level: 9 }).length)} gzip on demand`);
        else failures.push(`${name}: no chunk on demand holds "${marker}", so ${what} is not a chunk of its own`);
    }

    await bundle.close();
    results[name] = { minified: code.length, gzip: gzipSync(code, { level: 9 }).length };
    for (const marker of forbidden) {
        if (code.includes(marker)) failures.push(`${name}: bundle contains "${marker}" (tree-shaking broke)`);
    }
}
rmSync(work, { recursive: true, force: true });

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

    console.log(`${name.padEnd(width)}  ${kb(minified).padStart(10)}  ${kb(gzip).padStart(9)}  ${note}`);
    if (base && drift > TOLERANCE)
        failures.push(`${name}: ${kb(gzip)} gzip is more than 10% over the baseline ${kb(base)}`);
    if (!base && process.argv.includes('--check'))
        failures.push(`${name}: no baseline. Record one with: pnpm size:update`);
}

if (process.argv.includes('--update')) {
    writeFileSync(
        baselinePath,
        `${JSON.stringify(Object.fromEntries(Object.entries(results).map(([n, r]) => [n, { gzip: r.gzip }])), null, 2)}\n`,
    );
    console.log('size-check: baseline updated');
} else if (failures.length) {
    for (const f of failures) console.error(`size-check: ${f}`);
    if (process.argv.includes('--check')) {
        console.error('If the growth is intended: pnpm size:update');
        process.exit(1);
    }
}
