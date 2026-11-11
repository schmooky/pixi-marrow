#!/usr/bin/env node
/**
 * Writes the shared facts (scripts/facts.mjs) into the files that repeat them.
 *
 * A block sits between two marker comments and is replaced as a whole:
 *
 *   <!-- facts:entry-points -->
 *   ...generated...
 *   <!-- /facts:entry-points -->
 *
 * Also checks that every subpath export of the package has a row in ENTRY_POINTS, and no row is
 * left over.
 *
 *   --check   change nothing, fail when a file is stale
 *
 * usage: node scripts/gen-facts.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRY_POINTS, STATUS } from './facts.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = ['README.md', 'AGENTS.md'];
const check = process.argv.includes('--check');
const errors = [];

const blocks = {
    status: STATUS,
    'entry-points': [
        '| Import | Holds |',
        '|---|---|',
        ...ENTRY_POINTS.map((entry) => `| \`${entry.specifier}\` | ${entry.holds} |`),
    ].join('\n'),
};

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
    if (after === before) continue;
    if (check) errors.push(`${target} is stale. Run: pnpm facts`);
    else writeFileSync(path, after);
}
for (const name of Object.keys(blocks)) {
    if (!used.has(name)) errors.push(`no file has a "${name}" block`);
}

for (const error of errors) console.error(`gen-facts: ${error}`);
if (errors.length) process.exit(1);
console.log(`gen-facts: ${TARGETS.join(', ')} ${check ? 'are current' : 'written'}`);
