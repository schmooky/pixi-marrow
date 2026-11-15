#!/usr/bin/env node
/**
 * The lowest version of each peer of packages/pixi-marrow, read from the start of its range in
 * `peerDependencies`. The job `pixi-floor` of CI installs them and runs the typecheck and the unit
 * tests on them, so the floor is stated once, in the manifest.
 *
 * usage: node scripts/peer-floor.mjs           prints `name@version` per peer, for `pnpm add`
 *        node scripts/peer-floor.mjs --check   fails unless the package resolves each peer to it
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
