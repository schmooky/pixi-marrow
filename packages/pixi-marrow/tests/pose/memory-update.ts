import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { BASELINE_PATH, measureInstanceBytes } from './memory';

/*
 * `pnpm memory:update`: measures the bytes per instance of every official fixture and writes them
 * to ci/memory-baseline.json.
 */
it('writes the memory baseline', async () => {
    const measured = await measureInstanceBytes();
    const total = Object.values(measured).reduce((sum, bytes) => sum + bytes, 0);

    writeFileSync(BASELINE_PATH, `${JSON.stringify(measured, null, 2)}\n`);
    console.log(`memory baseline: ${Object.keys(measured).length} fixtures, ${total} bytes in total`);
    expect(total).toBeGreaterThan(0);
});
