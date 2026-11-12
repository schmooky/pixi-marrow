#!/usr/bin/env node
/**
 * Copies the rigs of the previews into public/rigs, which git ignores: the bee of the slot game
 * Bzzz and the big bee, with their atlas and its page image, from fixtures/bzzz. Those files
 * are in the repository, so the site builds on any clone. It runs before `dev` and `build`.
 *
 * usage: node scripts/copy-rigs.mjs   (from apps/site)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('..', import.meta.url));
const from = join(site, '../../fixtures/bzzz');
const out = join(site, 'public/rigs');

/** The skeletons a preview loads, with their atlas. The page images are read from the atlas. */
const RIGS = [
    { skeleton: 'animation_bee.skel', atlas: 'symbols.atlas' },
    { skeleton: 'animation_bee_big.skel', atlas: 'symbols.atlas' },
];

/** The page image names of an atlas: the first line, and every first line after an empty one. */
function pageNames(atlasText) {
    const lines = atlasText.split(/\r?\n/).map((line) => line.trim());

    return lines.filter((line, i) => line !== '' && (i === 0 || lines[i - 1] === ''));
}

const atlases = [...new Set(RIGS.map((rig) => rig.atlas))];
const lacks = [...RIGS.map((rig) => rig.skeleton), ...atlases].filter((file) => !existsSync(join(from, file)));

if (lacks.length > 0) {
    console.error(`copy-rigs: fixtures/bzzz lacks ${lacks.join(', ')}`);
    process.exit(1);
}

const pages = atlases.flatMap((atlas) => pageNames(readFileSync(join(from, atlas), 'utf8')));
const files = [...RIGS.map((rig) => rig.skeleton), ...atlases, ...new Set(pages)];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of files) copyFileSync(join(from, file), join(out, file));
console.log(`copy-rigs: ${files.length} files in apps/site/public/rigs (${files.join(', ')})`);
