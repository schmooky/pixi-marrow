#!/usr/bin/env node
/**
 * Packs packages/pixi-marrow and verifies that every entry point in its manifest,
 * plus README and LICENSE, is inside the tarball.
 *
 * While the package is private there is no LICENSE yet, so it is not required.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('../packages/pixi-marrow/', import.meta.url));
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const [report] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: pkgDir, encoding: 'utf8' }));
const files = new Set(report.files.map((f) => f.path));
const docs = pkg.private ? ['README.md'] : ['README.md', 'LICENSE'];
const wanted = new Set([...docs, pkg.main, pkg.module, pkg.types].filter(Boolean).map((p) => p.replace(/^\.\//, '')));

for (const target of Object.values(pkg.exports)) {
    if (typeof target === 'string') wanted.add(target.replace(/^\.\//, ''));
    else for (const p of Object.values(target)) wanted.add(p.replace(/^\.\//, ''));
}
const missing = [...wanted].filter((p) => !files.has(p));

if (missing.length) {
    console.error(
        `check-publish-contents: missing from the tarball:\n  ${missing.join('\n  ')}\nRun \`pnpm build\` first.`,
    );
    process.exit(1);
}
console.log(
    `check-publish-contents: ${files.size} files, all ${wanted.size} entry points present (${(report.size / 1024).toFixed(1)} kB packed)`,
);
