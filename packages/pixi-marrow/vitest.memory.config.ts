import { defineConfig } from 'vitest/config';

// `pnpm memory:update`: rewrites ci/memory-baseline.json.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/pose/memory-update.ts'],
        // the printed line is the point of this run
        silent: false,
    },
});
