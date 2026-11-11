#!/usr/bin/env node
/**
 * Downloads the skeletons the parity suite runs on: the official Spine example exports for
 * 4.1, 4.2 and 4.3, from the spine-runtimes repository at the commits pinned in
 * fixtures/manifest.json. Files land in fixtures/.cache/<version>/ and are not committed.
 * Every file is checked against the SHA-256 in the manifest.
 *
 *   (no flag)   download what is missing or changed
 *   --refresh   rebuild the manifest's file list from the upstream trees at the pinned commits,
 *               for the rig names in `rigs`, and record new hashes
 *
 * Your own rigs do not go through this script: drop them into fixtures/local/.
 *
 * usage: node scripts/fixtures.mjs [--refresh]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = join(root, 'fixtures/manifest.json');
const cacheDir = join(root, 'fixtures/.cache');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const API = `https://api.github.com/repos/${manifest.repository}`;
const RAW = `https://raw.githubusercontent.com/${manifest.repository}`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cachePath = (version, path) => join(cacheDir, version, basename(path));

async function get(url, json) {
    const headers = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
    const response = await fetch(url, { headers });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);

    return json ? response.json() : new Uint8Array(await response.arrayBuffer());
}

/** Paths of every file under examples/ at a version's pinned commit. */
async function examplePaths(version) {
    const top = await get(`${API}/git/trees/${manifest.commits[version]}`, true);
    const examples = top.tree.find((entry) => entry.path === 'examples');
    const tree = await get(`${API}/git/trees/${examples.sha}?recursive=1`, true);

    if (tree.truncated) throw new Error(`the examples tree for ${version} is too large for one request`);

    return tree.tree.filter((entry) => entry.type === 'blob').map((entry) => `examples/${entry.path}`);
}

/** The atlas that goes with a skeleton: same export folder, not premultiplied, best name match. */
function atlasFor(paths, skeletonPath, rig) {
    const folder = dirname(skeletonPath);
    const atlases = paths.filter(
        (path) => dirname(path) === folder && path.endsWith('.atlas') && !path.endsWith('-pma.atlas'),
    );
    const byName = atlases
        .filter((path) => rig.startsWith(basename(path, '.atlas')))
        .sort((a, b) => b.length - a.length);

    return byName[0] ?? (atlases.length === 1 ? atlases[0] : undefined);
}

async function refresh() {
    const files = [];

    for (const version of Object.keys(manifest.commits)) {
        const paths = await examplePaths(version);

        for (const rig of manifest.rigs) {
            const json = paths.find((path) => path.endsWith(`/export/${rig}.json`));
            const skel = paths.find((path) => path.endsWith(`/export/${rig}.skel`));
            const atlas = json && atlasFor(paths, json, rig);

            // a rig that a version does not have is skipped, not an error
            if (!json || !skel || !atlas) continue;
            const entry = { version, rig };

            for (const [kind, path] of Object.entries({ json, skel, atlas })) {
                const bytes = await get(`${RAW}/${manifest.commits[version]}/${path}`, false);

                entry[kind] = { path, sha256: sha256(bytes) };
                mkdirSync(join(cacheDir, version), { recursive: true });
                writeFileSync(cachePath(version, path), bytes);
            }
            files.push(entry);
        }
    }
    manifest.files = files;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`fixtures: manifest rebuilt with ${files.length} rigs`);
}

async function download() {
    let fetched = 0;
    let total = 0;

    for (const entry of manifest.files) {
        for (const kind of ['json', 'skel', 'atlas']) {
            const { path, sha256: expected } = entry[kind];
            const target = cachePath(entry.version, path);

            total++;
            if (existsSync(target) && sha256(readFileSync(target)) === expected) continue;
            const bytes = await get(`${RAW}/${manifest.commits[entry.version]}/${path}`, false);

            if (sha256(bytes) !== expected) {
                throw new Error(`${path} at ${entry.version} does not match the hash in fixtures/manifest.json`);
            }
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, bytes);
            fetched++;
        }
    }
    console.log(`fixtures: ${total} files in fixtures/.cache, ${fetched} downloaded`);
}

try {
    await (process.argv.includes('--refresh') ? refresh() : download());
} catch (error) {
    console.error(`fixtures: ${error.message}`);
    console.error('The parity suite needs these files. Check the network, then run: pnpm fixtures');
    process.exit(1);
}
