import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarrowSpine, type PerfEntry } from '../../src/index';
import { cutCodeState, loadCutCode } from '../../src/render/cut-code';
import type { CoverSlot } from '../render/cover-rig';
import { coverAsset } from './cover-asset';
import { FRAME, fixtureAsset } from './helpers';
import { boyAsset } from './pages';

/*
 * The code that cuts overdraw is a chunk of its own, and a chunk can fail to load. An asset
 * still loads then, with its outlines, and its display objects keep their quads and draw every
 * slot. In this file the chunk never loads.
 */

vi.mock('../../src/render/cut-work', () => {
    throw new Error('the chunk did not load');
});

/** A small slot behind a big one: the small one is covered where the cuts run. */
const BEHIND: readonly CoverSlot[] = [
    { name: 'small', shows: 'small' },
    { name: 'big', shows: 'big' },
];

const WHY =
    /^the chunk of pixi-marrow with the code that cuts did not load, so every region keeps its quad and every slot is drawn\. Check the network/;

describe('an asset whose code that cuts does not load', () => {
    const made: MarrowSpine[] = [];

    /** The rows of the report about the cuts, by feature. */
    async function rows(spine: MarrowSpine): Promise<Record<string, PerfEntry | undefined>> {
        const report = await spine.perf.report();

        return Object.fromEntries(
            ['tightMesh', 'occlusion', 'outlines'].map((name) => [name, report.find((row) => row.feature === name)]),
        );
    }

    function create(asset: ConstructorParameters<typeof MarrowSpine>[0]): MarrowSpine {
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it('is not asked for by an asset whose scan reads no page, and by one without outlines', async () => {
        const unread = await fixtureAsset('4.2/speedy-ess.skel', { outlines: 'auto' });
        const off = await coverAsset(BEHIND, { outlines: 'off' });

        await unread.optimized;
        expect(unread.outlinesState).toBe('unread');
        expect(off.outlinesState).toBe('off');
        const spine = create(unread);

        for (let frame = 0; frame < 5; frame++) spine.update(FRAME);
        expect(cutCodeState()).toBe('idle');
        expect((await rows(spine)).occlusion).toMatchObject({
            value: 'off',
            reason: 'the scan could read no page image',
        });
        unread.destroy();
        off.destroy();
    });

    it('loads all the same with outlines, and its display objects keep their quads, draw every slot and say why', async () => {
        expect(cutCodeState()).toBe('idle');
        const asset = await coverAsset(BEHIND);

        // the load waited for the chunk, which then did not come
        expect(cutCodeState()).toBe('failed');
        expect(asset.outlinesState).toBe('given');
        expect(asset.outlines?.regions.length).toBeGreaterThan(0);
        const spine = create(asset);

        // a display object that is made with outlines asks again, and that load fails too
        expect(cutCodeState()).toBe('loading');
        await loadCutCode();
        expect(cutCodeState()).toBe('failed');
        for (let frame = 0; frame < 70; frame++) spine.update(FRAME);
        expect(cutCodeState()).toBe('failed');
        expect(spine.stats).toMatchObject({ coveredSlots: 0, tightRanges: 0, vertices: 8, indices: 12, drawCalls: 1 });
        expect(await rows(spine)).toMatchObject({
            tightMesh: { value: 'off', reason: expect.stringMatching(WHY) },
            occlusion: { value: 'off', reason: expect.stringMatching(WHY) },
            outlines: { value: 'given' },
        });
        // the bytes the instances share count no triangle of an outline
        expect((await spine.perf.memory()).shared).toBeGreaterThan(0);
    });

    it('still reads outlines from the page images, which its display objects cannot use', async () => {
        const { asset } = await boyAsset();

        await asset.optimized;
        expect(asset.outlinesState).toBe('scanned');
        expect(cutCodeState()).toBe('failed');
        const spine = create(asset);
        const { vertices } = spine.stats;

        await loadCutCode();
        for (let frame = 0; frame < 5; frame++) spine.update(FRAME);
        expect(spine.stats).toMatchObject({ coveredSlots: 0, tightRanges: 0, vertices });
        expect(await rows(spine)).toMatchObject({
            tightMesh: { value: 'off', reason: expect.stringMatching(WHY) },
            occlusion: { value: 'off', reason: expect.stringMatching(WHY) },
            outlines: { value: 'scanned' },
        });
    });
});
