#!/usr/bin/env node
/**
 * Packs packages/pixi-marrow without writing a tarball and checks what the tarball would hold.
 *
 * - Every entry point of the manifest is inside: `main`, `module`, `types`, each target of
 *   `exports` and each target of `bin`. So are README and LICENSE.
 * - Nothing else is inside. Each path of the tarball must match a pattern of ALLOWED. A stray
 *   file, such as a test, a source map or a local note, fails the check.
 *
 * While the package is private there is no LICENSE yet, so it is not required.
 *
 * usage: pnpm build && node scripts/check-publish-contents.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What the tarball may hold. To ship a new file, add its pattern here and its path to `files` of
 * the manifest. A pattern is a path, where `**` stands for any folders and `*` for one name.
 */
const ALLOWED = [
    'package.json',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'dist/**/*.js',
    'dist/**/*.d.ts',
    'bin/**',
    // guidance for coding agents that ships with the package
    'AGENTS.md',
    'llms.txt',
    'perf-rules.json',
    'skills/**',
];

/** A pattern of ALLOWED as a regular expression over a whole path. */
function toRegExp(pattern) {
    const source = pattern
        .split(/(\*\*\/|\*\*|\*)/)
        .map((part) => {
            if (part === '**/') return '(?:[^/]+/)*';
            if (part === '**') return '.*';
            if (part === '*') return '[^/]*';

            return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');

    return new RegExp(`^${source}$`);
}

const pkgDir = fileURLToPath(new URL('../packages/pixi-marrow/', import.meta.url));
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const [report] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: pkgDir, encoding: 'utf8' }));
const files = new Set(report.files.map((f) => f.path));
const clean = (path) => path.replace(/^\.\//, '');
const docs = pkg.private ? ['README.md'] : ['README.md', 'LICENSE'];
const wanted = new Set([...docs, pkg.main, pkg.module, pkg.types].filter(Boolean).map(clean));
const errors = [];

/** Every file a value of `exports` names, however deep its conditions nest. */
function targets(value) {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') return Object.values(value).flatMap(targets);

    return [];
}
for (const target of targets(pkg.exports)) wanted.add(clean(target));

// `bin` is one path, or a map of command name to path
const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {});

for (const target of bins) wanted.add(clean(target));
// npm publish removes a bin whose path starts with ./, so the command would be missing from the package
for (const target of bins.filter((path) => path.startsWith('./'))) {
    errors.push(`bin ${target} starts with ./, and npm publish removes it. Write ${clean(target)}.`);
}

const missing = [...wanted].filter((p) => !files.has(p));

if (missing.length) {
    errors.push(`missing from the tarball:\n  ${missing.join('\n  ')}\nRun \`pnpm build\` first.`);
}

const allowed = ALLOWED.map(toRegExp);
const stray = [...files].filter((path) => !allowed.some((pattern) => pattern.test(path)));

if (stray.length) {
    errors.push(
        `in the tarball but not in the allow list:\n  ${stray.join('\n  ')}\nRemove the file, or add a pattern to ALLOWED in scripts/check-publish-contents.mjs.`,
    );
}

for (const error of errors) console.error(`check-publish-contents: ${error}`);
if (errors.length) process.exit(1);
console.log(
    `check-publish-contents: ${files.size} files, all ${wanted.size} entry points present, none outside the allow list (${(report.size / 1024).toFixed(1)} kB packed)`,
);
