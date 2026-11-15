import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        setupFiles: ['./tests/setup.ts'],
        // Some tests take seconds on a laptop: they warm the JavaScript engine up until it stops
        // allocating, or read every page image. A CI runner is several times slower, and its speed
        // changes from run to run. The default of 5 seconds is too short on a slow run.
        testTimeout: 60_000,
        hookTimeout: 60_000,
        // the heap checks of tests/render/heap.ts collect garbage before each window they measure,
        // so that a collection that a busy runner happens to make cannot spoil a window
        execArgv: ['--expose-gc'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // entry files only re-export
            exclude: ['src/index.ts', 'src/core.ts', 'src/optimize.ts'],
            thresholds: {
                lines: 90,
                functions: 90,
                statements: 90,
                branches: 85,
                // The pose core and the readers are the parts that parity decides. The numbers for
                // the whole source would let one of them fall far while the rest holds the mean.
                // So each has thresholds of its own, set just under the coverage of 2026-11-15:
                // pose 99.77, 99.88, 99.31 and 94.32, formats 99.93, 100, 99.60 and 94.82.
                'src/pose/**': {
                    lines: 99.5,
                    functions: 99.5,
                    statements: 99,
                    branches: 94,
                },
                'src/formats/**': {
                    lines: 99.5,
                    functions: 99.5,
                    statements: 99,
                    branches: 94.5,
                },
            },
        },
    },
});
