import { afterEach, describe, expect, it } from 'vitest';
import { MarrowSpine } from '../../src/index';
import { clipCode } from '../../src/render/clip-code';
import { createStage } from '../render/batch-stage';
import { FRAME, fixtureAsset } from './helpers';

/*
 * The code that clips in a batch loads on demand: an asset asks for it when its skeleton has a
 * clipping attachment. The tests run in this order, since the code stays once it is loaded.
 */

describe('the code that clips in a batch', () => {
    const made: MarrowSpine[] = [];

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it('is not loaded by an asset without a clipping attachment', async () => {
        const asset = await fixtureAsset('4.2/speedy-ess.skel');
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        made.push(spine);
        expect(asset.info.features).not.toContain('clipping');
        spine.update(FRAME);
        expect(spine.stats.renderMode).toBe('batched');
        expect(clipCode()).toBeUndefined();
    });

    it('is there once an asset with a clipping attachment has loaded, and its clips stay in the batch', async () => {
        const stage = createStage();
        const asset = await fixtureAsset('4.2/coin-pro.skel');
        const spines = [0, 1, 2].map(() => new MarrowSpine(asset, { autoUpdate: false }));
        const [spine] = spines;

        made.push(...spines);
        if (spine === undefined) throw new Error('no spine');
        expect(asset.info.features).toContain('clipping');
        expect(clipCode()).toBeDefined();
        for (const item of spines) {
            item.play('animation', { loop: true });
            stage.root.addChild(item);
        }
        for (let frame = 0; frame < 40; frame++) {
            for (const item of spines) item.update(FRAME);
            stage.render();
        }
        // with the default options: one batch for the three, no mask and no mesh
        expect(spine.stats).toMatchObject({ renderMode: 'batched', clips: 1, maskDraws: 0, drawCalls: 1 });
        expect(stage.counts.draws).toHaveLength(1);
        expect(stage.counts.draws[0]?.kind).toBe('batch');
        expect(spine.children[0]?.children.map((child) => child.label)).toEqual(['marrow-batch']);
        const clipping = (await spine.perf.report()).find((row) => row.feature === 'clipping');

        expect(clipping?.value).toBe('1 clip, cut on the CPU');
        expect(clipping?.reason).toMatch(
            /^the clipping attachment of slot "clipping" cuts visible slots: their triangles/,
        );
        expect(clipping?.reason).toMatch(/keeps room for \d+ vertices and \d+ indices of cut triangles$/);
    });
});
