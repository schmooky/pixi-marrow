import { describe, expect, it, vi } from 'vitest';
import { loadIdleCode } from '../../src/api/idle-cache';
import { MarrowSpine } from '../../src/index';
import { fixtureAsset } from './helpers';
import { fakeRenderer, frame, idleSprite, viewContainer } from './idle-stage';

/*
 * The code of the idle cache is a chunk of its own, and a chunk can fail to load. A skeleton
 * then draws live. In this file the chunk never loads.
 */

vi.mock('../../src/api/idle-image', () => {
    throw new Error('the chunk did not load');
});

describe('a display object whose idle cache does not load', () => {
    it('draws live, and the next display object asks for the code again', async () => {
        const asset = await fixtureAsset('4.2/speedy-ess.skel');
        const spine = new MarrowSpine(asset, { autoUpdate: false, idleCache: 'auto' });
        const fake = fakeRenderer(spine);

        // a load that fails never rejects
        await expect(loadIdleCode()).resolves.toBeUndefined();
        for (let i = 0; i < 100; i++) frame(spine, fake);
        expect(idleSprite(spine)).toBeUndefined();
        expect(viewContainer(spine).visible).toBe(true);
        expect(fake.renders).toHaveLength(0);
        const next = new MarrowSpine(asset, { autoUpdate: false, perf: 'balanced' });

        await expect(loadIdleCode()).resolves.toBeUndefined();
        next.destroy();
        spine.destroy();
    });
});
