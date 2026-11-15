#!/usr/bin/env node
/**
 * Fails when a pull request changes what the published package holds and brings no changeset.
 * The job `changeset-gate` of .github/workflows/pr.yml runs it.
 *
 * - What counts as a change of the package is TARBALL: everything that the tarball is made from.
 * - What counts as a changeset is a file added to `.changeset/` whose front matter names the
 *   package with `patch`, `minor` or `major`. Any other Markdown file there does not count.
 * - A release moves the changesets from `.changeset/` into `.changeset/pre/`. Such a move counts
 *   too, and a file that is only added to `.changeset/pre/` does not.
 * - It compares the head with the commit where the branch left the base. So a change that
 *   landed on the base after that is not held against the pull request.
 *
 * It uses git and the built-in modules of Node only, so it runs before `pnpm install`.
 *
 * usage: node scripts/changeset-gate.mjs <base> <head>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
/**
 * The files the tarball is made from. An entry that ends with `/` is a folder. Add a file here
 * when `files` of the manifest or scripts/stage-package-files.mjs starts to ship it.
 */
const TARBALL = [
    'packages/pixi-marrow/src/',
    'packages/pixi-marrow/bin/',
    'packages/pixi-marrow/package.json',
    // guidance for coding agents that ships with the package
    'packages/pixi-marrow/agent/',
    'packages/pixi-marrow/skills/',
    'packages/pixi-marrow/perf-rules.json',
    // how the build makes dist
    'packages/pixi-marrow/tsdown.config.ts',
    'packages/pixi-marrow/tsconfig.build.json',
    'packages/pixi-marrow/tsconfig.json',
    'tsconfig.json',
    // staged into the package when it is packed
    'README.md',
    'LICENSE',
    'scripts/stage-package-files.mjs',
];
const [base, head] = process.argv.slice(2);

if (!base || !head) {
    console.error('usage: node scripts/changeset-gate.mjs <base> <head>');
    process.exit(2);
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const name = JSON.parse(readFileSync(new URL('../packages/pixi-marrow/package.json', import.meta.url), 'utf8')).name;
/** Paths that differ between the fork point and the head, with the letter of the change. */
const changes = git('diff', '--name-status', '--no-renames', `${base}...${head}`)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
        const [status, path] = line.split('\t');

        return { status, path };
    });
const inTarball = changes
    .map((change) => change.path)
    .filter((path) => TARBALL.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry)));

if (inTarball.length === 0) {
    console.log('changeset-gate: no file of the published package changed. No changeset needed.');
    process.exit(0);
}

/** Whether the file at the head is a changeset that names the package with a kind of bump. */
function namesPackage(path) {
    const text = git('show', `${head}:${path}`);
    const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

    return new RegExp(`^\\s*(['"]?)${escaped}\\1\\s*:\\s*(patch|minor|major)\\s*$`, 'm').test(frontMatter);
}

const isChangeset = (path) => /^\.changeset\/[^/]+\.md$/.test(path) && path !== '.changeset/README.md';
const added = changes.filter((change) => change.status === 'A').map((change) => change.path);
const deleted = changes.filter((change) => change.status === 'D').map((change) => change.path);
const fresh = added.filter(isChangeset);
// a release moves .changeset/<name>.md to .changeset/pre/<name>.md
const moved = deleted.filter(isChangeset).map((path) => path.replace(/^\.changeset\//, '.changeset/pre/'));
const candidates = [...fresh, ...moved.filter((path) => added.includes(path))];
const valid = candidates.filter(namesPackage);

for (const path of candidates) {
    if (!valid.includes(path))
        console.error(`changeset-gate: ${path} does not name '${name}' with patch, minor or major.`);
}
if (valid.length === 0) {
    console.error(
        `changeset-gate: this pull request changes the published package and brings no changeset for '${name}':`,
    );
    for (const path of inTarball.slice(0, 20)) console.error(`  ${path}`);
    if (inTarball.length > 20) console.error(`  and ${inTarball.length - 20} more`);
    console.error(
        "Run 'pnpm changeset' and commit the file. A change that needs no release takes the label 'skip-changeset'.",
    );
    process.exit(1);
}
console.log(`changeset-gate: ${inTarball.length} files of the published package changed, with ${valid.join(', ')}`);
