import { expect, it } from 'vitest';
import { measureInstanceBytes, readBaseline, TOLERANCE } from './memory';

/*
 * Memory is a goal of the same weight as speed. This keeps the bytes one more instance costs from
 * growing unnoticed. When growth is intended, accept it with: pnpm memory:update
 */
it('keeps the bytes per instance within 10 percent of the baseline', async () => {
    const baseline = readBaseline();
    const measured = await measureInstanceBytes();
    const problems: string[] = [];

    for (const [id, bytes] of Object.entries(measured)) {
        const accepted = baseline[id];

        if (accepted === undefined) problems.push(`${id}: ${bytes} bytes, no baseline`);
        else if (bytes > accepted * (1 + TOLERANCE)) problems.push(`${id}: ${bytes} bytes, baseline ${accepted}`);
    }

    expect(Object.keys(measured).length).toBeGreaterThan(0);
    expect(problems, 'If the growth is intended, run: pnpm memory:update').toEqual([]);
});
