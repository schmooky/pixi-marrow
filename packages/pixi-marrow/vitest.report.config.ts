import { defineConfig } from 'vitest/config';

// `pnpm parity:ref`: prints one line per fixture with a checksum of its reference poses.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/parity/report.ts'],
        // the printed lines are the point of this run
        silent: false,
    },
});
