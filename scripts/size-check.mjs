#!/usr/bin/env node
/**
 * What an app pays for pixi-marrow: bundles typical imports of the built package the way an app
 * bundler does (package `exports` and `sideEffects`, pixi.js external, minified) and reports the
 * gzipped size of each, compared with ci/size-baseline.json. Also checks that tree-shaking works:
 * an import that has no business pulling in a module must not contain its marker. Sizes count the
 * code an app loads up front. Chunks behind a dynamic import() load only when used, so they are
 * listed on their own and not added. scripts/size-measure.mjs measures, and this script judges.
 *
 * The root import also has a limit of its own, `ROOT_IMPORT_LIMIT` of scripts/size-limit.mjs. The
 * baseline moves with every accepted change, so 10% over it can add up to far more than the limit.
 * The readers, the pose engines, the mesh mode and the code for clips load on demand, and each
 * has a limit too: `ON_DEMAND_LIMITS`.
 *
 *   --check   fail when an import grew more than 10% over the baseline, the root import or code
 *             on demand is over its limit, or a marker check fails
 *   --update  rewrite the baseline. Refused when a limit is passed
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ON_DEMAND_LIMITS, ROOT_IMPORT_ENTRY, ROOT_IMPORT_LIMIT } from './size-limit.mjs';
import { kb, measureSizes } from './size-measure.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const baselinePath = join(root, 'ci/size-baseline.json');
const TOLERANCE = 0.1;

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

    if (size === undefined) overLimit.push(`${name}: not measured, though scripts/size-limit.mjs has a limit for it`);
    else if (size > limit) {
        overLimit.push(`${name}: ${kb(size)} gzip is over the limit of ${kb(limit)} in scripts/size-limit.mjs`);
    } else console.log(`size-check: ${name} is ${kb(limit - size)} under its limit`);
}
for (const name of Object.keys(onDemand)) {
    if (!(name in ON_DEMAND_LIMITS)) overLimit.push(`${name}: no limit in ON_DEMAND_LIMITS of scripts/size-limit.mjs`);
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
