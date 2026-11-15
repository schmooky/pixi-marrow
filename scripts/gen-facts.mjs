#!/usr/bin/env node
/**
 * Writes the shared facts (scripts/facts.mjs) into the files that repeat them.
 *
 * A block sits between two marker comments and is replaced as a whole. The blocks are `status`,
 * `entry-points` and `presets`:
 *
 *   <!-- facts:entry-points -->
 *   ...generated...
 *   <!-- /facts:entry-points -->
 *
 * One value inside a sentence sits between two marker comments too. Its name is a path into
 * scripts/facts.json:
 *
 *   Skeletons of up to <!-- fact:batch.autoVertices -->1024<!-- /fact --> vertices share draw calls.
 *
 * The facts also go to scripts/facts.json, which a page of the site can import. A page that
 * imports a value needs no marker.
 *
 * Also checks that every subpath export of the package has a row in ENTRY_POINTS, and no row is
 * left over.
 *
 *   --check   change nothing, fail when a file is stale
 *
 * usage: pnpm build && node scripts/gen-facts.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFacts, ENTRY_POINTS, presetTable, STATUS } from './facts.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = ['README.md', 'AGENTS.md'];
const JSON_PATH = 'scripts/facts.json';
/** Blocks that a file must hold. The others are written where a file has their markers. */
const REQUIRED = ['status', 'entry-points'];
const INLINE = /<!-- fact:([^\s>]+) -->([\s\S]*?)<!-- \/fact -->/g;
const check = process.argv.includes('--check');
const errors = [];
const facts = await collectFacts().catch((error) => {
    console.error(`gen-facts: ${error.message.replace(/^facts: /, '')}`);
    process.exit(1);
});

const blocks = {
    status: STATUS,
    'entry-points': [
        '| Import | Holds |',
        '|---|---|',
        ...ENTRY_POINTS.map((entry) => `| \`${entry.specifier}\` | ${entry.holds} |`),
    ].join('\n'),
    presets: presetTable(facts.presets),
};

/** The fact at a path with dots, or undefined. */
const factAt = (path) =>
    path.split('.').reduce((at, key) => (at && typeof at === 'object' ? at[key] : undefined), facts);

// every export has a row, every row has an export
const pkg = JSON.parse(readFileSync(join(root, 'packages/pixi-marrow/package.json'), 'utf8'));
const exported = Object.keys(pkg.exports)
    .filter((key) => key !== './package.json')
    .map((key) => (key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`));
const listed = ENTRY_POINTS.map((entry) => entry.specifier);

for (const specifier of exported) {
    if (!listed.includes(specifier)) errors.push(`${specifier} is exported but has no row in scripts/facts.mjs`);
}
for (const specifier of listed) {
    if (!exported.includes(specifier)) errors.push(`${specifier} is in scripts/facts.mjs but not exported`);
}

const used = new Set();
let inline = 0;

for (const target of TARGETS) {
    const path = join(root, target);
    const before = readFileSync(path, 'utf8');
    let after = before;

    for (const [name, content] of Object.entries(blocks)) {
        const open = `<!-- facts:${name} -->`;
        const close = `<!-- /facts:${name} -->`;
        const start = after.indexOf(open);
        const end = after.indexOf(close);

        if (start === -1 && end === -1) continue;
        if (start === -1 || end < start) {
            errors.push(`${target}: the "${name}" block needs both ${open} and ${close}`);
            continue;
        }
        used.add(name);
        after = `${after.slice(0, start)}${open}\n${content}\n${after.slice(end)}`;
    }
    after = after.replace(INLINE, (whole, name, stated) => {
        const value = factAt(name);

        if (value === undefined || typeof value === 'object') {
            errors.push(`${target}: "${name}" is not one value of ${JSON_PATH}`);

            return whole;
        }
        inline++;
        if (check && stated !== String(value)) {
            errors.push(`${target}: ${name} is ${value} in the code, and the file says ${stated}`);
        }

        return `<!-- fact:${name} -->${value}<!-- /fact -->`;
    });
    // a marker that the pattern did not read would leave its number unchecked
    const markers = after.match(/<!-- (?:fact:|\/fact )/g)?.length ?? 0;

    if (markers !== 2 * [...after.matchAll(INLINE)].length) {
        errors.push(`${target}: a fact marker is not closed. Write <!-- fact:name -->value<!-- /fact -->`);
    }
    if (after === before) continue;
    if (check) errors.push(`${target} is stale. Run: pnpm facts`);
    else writeFileSync(path, after);
}
for (const name of REQUIRED) {
    if (!used.has(name)) errors.push(`no file has a "${name}" block`);
}

const json = `${JSON.stringify(facts, null, 2)}\n`;
const jsonPath = join(root, JSON_PATH);

if (!existsSync(jsonPath) || readFileSync(jsonPath, 'utf8') !== json) {
    if (check) errors.push(`${JSON_PATH} is stale. Run: pnpm facts`);
    else writeFileSync(jsonPath, json);
}

for (const error of errors) console.error(`gen-facts: ${error}`);
if (errors.length) process.exit(1);
console.log(
    `gen-facts: ${[...TARGETS, JSON_PATH].join(', ')} ${check ? 'are current' : 'written'} (${used.size} blocks, ${inline} values in sentences)`,
);
