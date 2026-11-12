import { describe, expect, it, vi } from 'vitest';
import { MarrowError } from '../../src/index';
import { clipCode, loadClipCode } from '../../src/render/clip-code';
import { loadFamily } from '../render/batch-check';
import { clipAttachment } from '../render/clip-check';
import { createRig, drawPose, slotIndex } from '../render/rig';
import { fixtureAsset, fixtureFiles } from './helpers';

/*
 * The code that clips is a chunk of its own, and a chunk can fail to load. A skeleton with a
 * clipping attachment cannot be drawn without it, so its asset does not load then.
 */

vi.mock('../../src/render/batch-clip', () => {
    throw new Error('the chunk did not load');
});

describe('a chunk with the code that clips that does not load', () => {
    it('fails the load of an asset with a clipping attachment, with an error that says what to do', async () => {
        const failed = fixtureAsset('4.2/coin-pro.skel');

        await expect(failed).rejects.toBeInstanceOf(MarrowError);
        await expect(failed).rejects.toMatchObject({
            code: 'invalid-data',
            fix: 'Check the network, and that the bundler wrote the chunks of pixi-marrow next to its entry and the server sends them.',
        });
        await expect(failed).rejects.toThrow(/The chunk of pixi-marrow with the code that clips did not load: /);
        expect(clipCode()).toBeUndefined();
        // every call tries again
        await expect(loadClipCode()).rejects.toBeInstanceOf(MarrowError);
        await expect(loadFamily('4.2/coin-pro.skel')).rejects.toBeInstanceOf(MarrowError);
    });

    it('leaves an asset without a clipping attachment alone', async () => {
        const asset = await fixtureAsset('4.2/speedy-ess.skel');

        expect(asset.info.features).not.toContain('clipping');
    });

    it('makes a view throw that meets a clip, and not before', async () => {
        const rig = await createRig(fixtureFiles('4.2/speedy-ess.skel'), undefined, {
            options: () => ({ renderMode: 'batched' }),
        });
        const { state } = rig.engine;

        rig.engine.update(0);
        drawPose(rig.view, state);
        state.attachments[slotIndex(rig, 'head')] = clipAttachment('clip', -1, [-900, -900, 900, -900, 0, 900]);
        expect(() => drawPose(rig.view, state)).toThrow(MarrowError);
        expect(() => drawPose(rig.view, state)).toThrow(/the code that clips is not loaded/);
    });
});
