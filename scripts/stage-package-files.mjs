#!/usr/bin/env node
/**
 * Copies the repo's README and LICENSE into packages/pixi-marrow for publishing.
 *
 * `files` in the package manifest lists both, but npm silently drops an entry that
 * matches nothing, so without this the tarball would ship no README (a blank page on
 * npmjs.com) and no LICENSE. Runs from `prepack`. `postpack --clean` removes the
 * copies again so they never drift from the originals.
 *
 * While the package is private there is no LICENSE yet, and its absence is not an error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'packages/pixi-marrow');
const FILES = ['README.md', 'LICENSE'];
const clean = process.argv.includes('--clean');
const isPrivate = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).private === true;
const staged = [];

for (const name of FILES) {
    const dest = join(PKG, name);

    if (clean) {
        await rm(dest, { force: true });
        staged.push(name);
        continue;
    }
    const src = join(ROOT, name);

    if (!existsSync(src)) {
        if (name === 'LICENSE' && isPrivate) continue;
        console.error(`stage-package-files: ${name} is missing at the repo root. The published package needs it.`);
        process.exit(1);
    }
    await copyFile(src, dest);
    staged.push(name);
}
// stderr: `npm pack --json` expects nothing but JSON on stdout
console.error(`stage-package-files: ${clean ? 'removed' : 'staged'} ${staged.join(', ')}`);
