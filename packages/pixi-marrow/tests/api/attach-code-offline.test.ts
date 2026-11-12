import { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { MarrowSpine } from '../../src/index';
import { attachCodeState, loadAttachCode } from '../../src/render/attach-code';
import { coverAsset } from './cover-asset';
import { FRAME } from './helpers';

/*
 * The code that draws attached containers is a chunk of its own, and a chunk can fail to load.
 * An attached container then stays hidden. In this file the chunk never loads.
 */

vi.mock('../../src/render/attach-work', () => {
    throw new Error('the chunk did not load');
});

describe('a display object whose code for attached containers does not load', () => {
    it('keeps an attached container hidden, says so, and asks again with the next attach and not with every update', async () => {
        const asset = await coverAsset(
            [
                { name: 'a', shows: 'small', at: [50, 0] },
                { name: 'b', shows: 'small', at: [150, 0] },
            ],
            { outlines: 'off' },
        );
        const spine = new MarrowSpine(asset, { autoUpdate: false });
        const [label, other, marker] = [new Container(), new Container(), new Container()];

        spine.addChild(marker);
        spine.follow('bone-b', marker);
        spine.attach('a', label);
        expect(attachCodeState()).toBe('loading');
        // a load that fails never rejects
        await expect(loadAttachCode()).resolves.toBeUndefined();
        expect(attachCodeState()).toBe('failed');
        for (let frame = 0; frame < 5; frame++) spine.update(FRAME);
        expect(attachCodeState()).toBe('failed');
        expect(label.visible).toBe(false);
        expect(label.parent).toBeNull();
        // what needs no chunk works
        expect(marker.position.x).toBeCloseTo(150);
        expect((await spine.perf.report()).find((row) => row.feature === 'links')).toMatchObject({
            value: '1 attached, 1 following',
            reason: expect.stringContaining('did not load'),
        });
        // another attach is a command: it asks for the code again
        spine.attach('b', other);
        expect(attachCodeState()).toBe('loading');
        await loadAttachCode();
        expect(attachCodeState()).toBe('failed');
        // a container that is let go of is visible again
        spine.detach(label);
        expect(label.visible).toBe(true);
        spine.destroy();
        expect(other.visible).toBe(true);
    });
});
