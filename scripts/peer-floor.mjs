#!/usr/bin/env node
/**
 * The lowest version of each peer of packages/pixi-marrow, read from the start of its range in
 * `peerDependencies`. The job `pixi-floor` of CI installs them and runs the typecheck and the unit
 * tests on them, so the floor is stated once, in the manifest.
 *
 * `--check` also compares pnpm-lock.yaml with the one of the commit. `pnpm add` asks the registry,
 * so the lockfile of the job is not the committed one. The only packages it may add are the peers
 * at their floors. Then every other package of the job is one that the committed lockfile pins,
 * and a floor is one exact version, which the registry never replaces.
 *
 * A second lockfile for the floors, installed frozen, would pin those two as well. But every
 * change of a dependency would have to write it again, and Dependabot cannot.
 *
 * usage: node scripts/peer-floor.mjs           prints `name@version` per peer, for `pnpm add`
 *        node scripts/peer-floor.mjs --check   fails unless the package resolves each peer to it
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = fileURLToPath(new URL('../packages/pixi-marrow/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const floors = Object.entries(manifest.peerDependencies ?? {}).map(([name, range]) => {
    const version = /^\^?(\d+\.\d+\.\d+)$/.exec(range)?.[1];

    if (!version) {
        console.error(`peer-floor: the range "${range}" of ${name} does not start at one version, as ^8.21.0 does`);
        process.exit(1);
    }

    return { name, version };
});

if (!process.argv.includes('--check')) {
    console.log(floors.map(({ name, version }) => `${name}@${version}`).join(' '));
    process.exit(0);
}
const wrong = [];

for (const { name, version } of floors) {
    const resolved = JSON.parse(readFileSync(join(pkgDir, 'node_modules', name, 'package.json'), 'utf8')).version;

    console.log(`peer-floor: ${name} ${resolved}, the floor is ${version}`);
    if (resolved !== version) wrong.push(name);
}
if (wrong.length) {
    console.error(
        `peer-floor: ${wrong.join(', ')} not at the floor. Run: pnpm --filter pixi-marrow add --save-dev $(node scripts/peer-floor.mjs)`,
    );
    process.exit(1);
}

/** The `name@version` of every package in the `packages` section of a lockfile. */
function lockedPackages(lockfile) {
    const start = lockfile.indexOf('\npackages:\n');
    const end = lockfile.indexOf('\nsnapshots:\n', start);

    if (start === -1 || end === -1) {
        console.error('peer-floor: pnpm-lock.yaml has no packages section before a snapshots section');
        process.exit(1);
    }

    return new Set(
        [...lockfile.slice(start, end).matchAll(/^ {2}'?([^\s':]+@[^\s':]+)'?:$/gm)].map((match) => match[1]),
    );
}

const committed = lockedPackages(
    execFileSync('git', ['show', 'HEAD:pnpm-lock.yaml'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
);
const allowed = new Set(floors.map(({ name, version }) => `${name}@${version}`));
const added = [...lockedPackages(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'))].filter(
    (entry) => !committed.has(entry) && !allowed.has(entry),
);

if (added.length) {
    console.error(
        `peer-floor: the install added packages that the committed pnpm-lock.yaml does not pin:\n  ${added.join('\n  ')}`,
    );
    process.exit(1);
}
console.log('peer-floor: every other package is one that the committed pnpm-lock.yaml pins');
