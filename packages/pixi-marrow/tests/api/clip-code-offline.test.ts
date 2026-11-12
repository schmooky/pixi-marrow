import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarrowSpine } from '../../src/index';
import { batchClipper, loadBatchClipper } from '../../src/render/clip-code';
import { FRAME, fixtureAsset } from './helpers';

/*
 * The code that clips in a batch is a chunk of its own, and a chunk can fail to load. An asset
 * still loads then, and a clip draws as in the mesh mode.
 */

vi.mock('../../src/render/batch-clip', () => {
    throw new Error('the chunk did not load');
});

describe('an asset whose code for clips in a batch did not load', () => {
    const made: MarrowSpine[] = [];

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it('draws a clip with meshes and a stencil mask, and its report says why', async () => {
        const asset = await fixtureAsset('4.2/coin-pro.skel');
        const spine = new MarrowSpine(asset, { autoUpdate: false, renderMode: 'batched' });

        made.push(spine);
        expect(batchClipper()).toBeUndefined();
        spine.play('animation', { loop: true });
        for (let frame = 0; frame < 40; frame++) spine.update(FRAME);
        expect(spine.stats).toMatchObject({ renderMode: 'mesh', clips: 1, maskDraws: 2 });
        expect((await spine.perf.report())[0]).toEqual({
            feature: 'renderMode',
            value: 'mesh',
            reason: 'the option renderMode is "batched", and a clipping attachment cuts a visible slot while the code that clips in a batch is not loaded: the clip draws with meshes and a stencil mask. It has draw calls of its own, and the GPU places its vertices',
        });
        // the next asset asks again, and a load that fails never rejects
        await expect(loadBatchClipper()).resolves.toBeUndefined();
        expect(batchClipper()).toBeUndefined();
    });
});
