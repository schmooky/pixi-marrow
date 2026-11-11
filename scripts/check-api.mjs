#!/usr/bin/env node
/**
 * Snapshot of the public API, taken from the built declaration files.
 *
 * For every subpath export of the package, lists each exported symbol with its full declaration
 * and compares the result with packages/pixi-marrow/api.md. A change to the public surface shows
 * up as a change to that file, so it is seen in review.
 *
 * Also checks the docs every public symbol must have: a TSDoc comment, and an `@example` on
 * classes and functions.
 *
 * It reads declarations as text, with no type checker. It expects one statement per declaration
 * and no braces or semicolons inside string literal types.
 *
 *   --update  rewrite the snapshot
 *
 * usage: pnpm build && node scripts/check-api.mjs [--update]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = join(root, 'packages/pixi-marrow');
const snapshotPath = join(pkgDir, 'api.md');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const KINDS = 'class|function|const|interface|type|enum';
/** declarations that end at their closing brace, not at a semicolon */
const BLOCKS = new Set(['class', 'interface', 'enum']);
const errors = [];

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const names = (list) =>
    list
        .split(',')
        .map((part) => part.trim().replace(/^type\s+/, ''))
        .filter(Boolean)
        .map((part) => part.split(/\s+as\s+/));

/** What a declaration file exports: the exported name, the declared name and the file that declares it. */
function exportsOf(file) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const imported = new Map();
    const found = [];
    const moduleFile = (specifier) => join(dirname(file), specifier.replace(/\.js$/, '.d.ts'));

    if (/export\s*\*/.test(code)) errors.push(`${file}: "export *" hides the public surface. Export by name`);
    for (const match of code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
        for (const [name, local = name] of names(match[1])) imported.set(local, { name, file: moduleFile(match[2]) });
    }
    for (const match of code.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/g)) {
        for (const [local, exported = local] of names(match[1])) {
            const origin = match[2] ? { name: local, file: moduleFile(match[2]) } : imported.get(local);

            found.push({ exported, ...(origin ?? { name: local, file }) });
        }
    }
    for (const match of code.matchAll(
        new RegExp(`^export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:${KINDS})\\s+(\\w+)`, 'gm'),
    )) {
        found.push({ exported: match[1], name: match[1], file });
    }

    return found;
}

/** Index after the end of the statement that starts at `start`. Comments are skipped. */
function statementEnd(text, start, kind) {
    let depth = 0;

    for (let i = start; i < text.length; i++) {
        if (text.startsWith('/*', i)) {
            i = text.indexOf('*/', i) + 1;
            continue;
        }
        const ch = text[i];

        if (ch === '{' || ch === '(') depth++;
        else if (ch === '}' || ch === ')') {
            depth--;
            if (depth === 0 && ch === '}' && BLOCKS.has(kind)) return i + 1;
        } else if (ch === ';' && depth === 0) return i + 1;
    }

    return text.length;
}

/** Every declaration of `name` in `file`, without comments. Checks the TSDoc on the way. */
function declarationsOf({ name, file }) {
    const text = readFileSync(file, 'utf8');
    const pattern = new RegExp(`^export\\s+(?:declare\\s+)?(?:abstract\\s+)?(${KINDS})\\s+${name}\\b`, 'gm');
    const found = [];

    for (const match of text.matchAll(pattern)) {
        const before = text.slice(0, match.index).trimEnd();
        const doc = before.endsWith('*/') ? before.slice(before.lastIndexOf('/**')) : '';

        if (!doc) errors.push(`${name}: no TSDoc comment`);
        else if ((match[1] === 'class' || match[1] === 'function') && !doc.includes('@example')) {
            errors.push(`${name}: the TSDoc has no @example`);
        }
        found.push(
            stripComments(text.slice(match.index, statementEnd(text, match.index, match[1])))
                .split('\n')
                .filter((line) => line.trim())
                .join('\n'),
        );
    }
    if (!found.length) errors.push(`${name}: no declaration found in ${file}`);

    return found;
}

const sections = [];

for (const [key, target] of Object.entries(pkg.exports)) {
    if (typeof target === 'string') continue;
    const file = join(pkgDir, target.types);
    const specifier = key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`;

    if (!existsSync(file)) {
        console.error(`check-api: ${target.types} is missing. Run: pnpm build`);
        process.exit(1);
    }
    const body = exportsOf(file)
        .sort((a, b) => a.exported.localeCompare(b.exported))
        .flatMap((symbol) => {
            const note = symbol.exported === symbol.name ? [] : [`// exported as ${symbol.exported}`];

            return [...note, ...declarationsOf(symbol)];
        });

    sections.push(`## ${specifier}\n\n\`\`\`ts\n${body.join('\n')}\n\`\`\``);
}

const snapshot = [
    '# Public API',
    'Generated from the built declarations by `pnpm api:update`. Do not edit.\nA change in this file is a change to the public surface.',
    ...sections,
    '',
].join('\n\n');
const current = existsSync(snapshotPath) ? readFileSync(snapshotPath, 'utf8') : '';

for (const error of errors) console.error(`check-api: ${error}`);
if (errors.length) process.exit(1);

if (process.argv.includes('--update')) {
    writeFileSync(snapshotPath, snapshot);
    console.log('check-api: snapshot written to packages/pixi-marrow/api.md');
} else if (snapshot !== current) {
    const was = new Set(current.split('\n'));
    const now = new Set(snapshot.split('\n'));

    for (const line of was) if (!now.has(line)) console.error(`- ${line}`);
    for (const line of now) if (!was.has(line)) console.error(`+ ${line}`);
    console.error('check-api: the public API differs from packages/pixi-marrow/api.md.');
    console.error('If the change is intended: pnpm api:update, and commit the file.');
    process.exit(1);
} else {
    console.log(`check-api: ${sections.length} entry points match the snapshot`);
}
