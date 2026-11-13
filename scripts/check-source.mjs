#!/usr/bin/env node
/**
 * Rules for the library source that the linter cannot express.
 *
 * - Layers. A file imports only from its own layer or the layers below it:
 *   base, model, formats, pose, geometry, render, api, then the feature folders.
 * - The headless core (base, model, formats, pose, geometry and src/core.ts) never imports pixi.js.
 * - No runtime dependencies. The source imports nothing from npm except pixi.js. The official
 *   Spine cores are for tests. Node built-ins are allowed in src/optimize only. pixi-silk, an
 *   optional peer, is allowed in src/debug only: the debug overlays draw with it.
 * - Size. No source or test file is longer than 500 lines.
 * - Casts. No `as any`, no double cast through unknown, no TypeScript suppression comments.
 *
 * usage: node scripts/check-source.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgDir = join(root, 'packages/pixi-marrow');
const srcDir = join(pkgDir, 'src');
const LAYERS = ['base', 'model', 'formats', 'pose', 'geometry', 'render', 'api'];
const FEATURES = ['bake', 'debug', 'perf', 'optimize'];
const HEADLESS = ['base', 'model', 'formats', 'pose', 'geometry'];
const MAX_LINES = 500;
const CASTS = [
    [/\bas any\b/, '`as any`'],
    [/\bas unknown as\b/, 'a double cast through unknown'],
    [/@ts-(ignore|nocheck)/, 'a TypeScript suppression comment'],
];
const IMPORT =
    /(?:\bimport|\bexport)\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g;

const errors = [];
const fail = (file, message) => errors.push(`${relative(root, file)}: ${message}`);

function walk(dir) {
    if (!existsSync(dir)) return [];

    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);

        if (statSync(path).isDirectory()) return walk(path);

        return name.endsWith('.ts') ? [path] : [];
    });
}

/** The folder under src a file is in, or its file name when it is an entry file at the top of src. */
const areaOf = (file) => relative(srcDir, file).split(sep)[0];

/** The layers a file may import from, or undefined when the file is in no known place. */
function allowedLayers(area) {
    if (LAYERS.includes(area)) return LAYERS.slice(0, LAYERS.indexOf(area) + 1);
    if (FEATURES.includes(area)) return [...LAYERS, area];
    if (area === 'index.ts') return LAYERS;
    if (area === 'core.ts') return HEADLESS;

    const feature = area.replace(/\.ts$/, '');

    return FEATURES.includes(feature) ? [...LAYERS, feature] : undefined;
}

const isHeadless = (area) => HEADLESS.includes(area) || area === 'core.ts';
const isOptimize = (area) => area === 'optimize' || area === 'optimize.ts';

function checkImport(file, area, allowed, specifier) {
    if (specifier.startsWith('.')) {
        const target = areaOf(resolve(dirname(file), specifier));

        if (target === '..') fail(file, `imports "${specifier}", which is outside src`);
        else if (!LAYERS.includes(target) && !FEATURES.includes(target))
            fail(file, `imports "${specifier}". Entry files are for consumers, not for the source`);
        else if (!allowed.includes(target))
            fail(file, `${area} imports from ${target}. Allowed: ${allowed.join(', ')}`);

        return;
    }
    if (specifier === 'pixi.js' || specifier.startsWith('pixi.js/')) {
        if (isHeadless(area)) fail(file, 'the headless core must not import pixi.js');

        return;
    }
    if (specifier.startsWith('node:')) {
        if (!isOptimize(area)) fail(file, `imports "${specifier}". Node built-ins are for src/optimize only`);

        return;
    }
    if (specifier === 'pixi-silk' || specifier.startsWith('pixi-silk/')) {
        if (area !== 'debug') fail(file, `imports "${specifier}". pixi-silk is an optional peer of src/debug only`);

        return;
    }
    fail(file, `imports "${specifier}". The library has no runtime dependencies`);
}

for (const file of walk(srcDir)) {
    const area = areaOf(file);
    const allowed = allowedLayers(area);
    const text = readFileSync(file, 'utf8');

    if (!allowed) {
        fail(file, `"${area}" is not a known layer or entry file. Add it to scripts/check-source.mjs`);
        continue;
    }
    for (const match of text.matchAll(IMPORT)) checkImport(file, area, allowed, match[1] ?? match[2] ?? match[3]);
    for (const [pattern, what] of CASTS) {
        if (pattern.test(text)) fail(file, `contains ${what}`);
    }
}

for (const file of [...walk(srcDir), ...walk(join(pkgDir, 'tests'))]) {
    const lines = readFileSync(file, 'utf8').split('\n').length;

    if (lines > MAX_LINES) fail(file, `${lines} lines. The limit is ${MAX_LINES}: split the file`);
}

for (const error of errors) console.error(`check-source: ${error}`);
console.log(`check-source: ${walk(srcDir).length} source files, ${errors.length} problems`);
process.exit(errors.length ? 1 : 0);
