import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

interface ExportTarget {
    default: string;
}

const pkg: { exports: Record<string, string | ExportTarget> } = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

// one build entry per subpath export: ./dist/core.js is built from src/core.ts
const entry = Object.values(pkg.exports).flatMap((target) =>
    typeof target === 'string' ? [] : [target.default.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts')],
);

export default defineConfig({
    entry,
    // ESM only, one output file per source module: with `sideEffects: false` an app's bundler
    // drops every module it does not use
    format: 'esm',
    unbundle: true,
    platform: 'neutral',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    // declarations come from oxc (tsconfig `isolatedDeclarations`): no type checker in the build
    dts: true,
    sourcemap: false,
    // package checks on every build: exports, files and types must resolve for ESM consumers
    publint: true,
    attw: { profile: 'esm-only', level: 'error' },
});
