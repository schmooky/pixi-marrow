import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MarrowSpine } from '../../src/index';
import { attachCode, attachCodeState, loadAttachCode } from '../../src/render/attach-code';
import { createStage } from '../render/batch-stage';
import { coverAsset } from './cover-asset';
import { FRAME } from './helpers';

/*
 * The code that draws attached containers loads on demand. This file never loads it before a
 * display object asks for it, and its tests run in order: the code stays once it is there.
 */

describe('a display object before the code for attached containers is loaded', () => {
    it('does not ask for the code for a handle or for a container that follows a bone', async () => {
        const asset = await coverAsset([{ name: 'a', shows: 'small', at: [50, 0] }], { outlines: 'off' });
        const spine = new MarrowSpine(asset, { autoUpdate: false });
        const marker = new Container();

        spine.addChild(marker);
        spine.follow('bone-a', marker);
        spine.bone('bone-a').x = 70;
        spine.update(FRAME);
        // both work at once
        expect(marker.position.x).toBeCloseTo(70);
        expect(attachCodeState()).toBe('idle');
        expect(attachCode()).toBeUndefined();
        spine.destroy();
    });

    it('asks for the code with the first attached container, hides it until then and shows it with the next update, and lets go of one that waits', async () => {
        const stage = createStage();
        const asset = await coverAsset(
            [
                { name: 'a', shows: 'small', at: [50, 0] },
                { name: 'b', shows: 'small', at: [150, 0] },
            ],
            { outlines: 'off' },
        );
        const spine = new MarrowSpine(asset, { autoUpdate: false });
        const other = new MarrowSpine(asset, { autoUpdate: false });
        const label = new Container();
        const [detached, gone, kept] = [new Container(), new Container(), new Container()];

        stage.root.addChild(spine, other);
        spine.attach('a', label);
        // the call asked, and nothing was awaited since
        expect(attachCodeState()).toBe('loading');
        expect(label.visible).toBe(false);
        expect(label.parent).toBeNull();
        for (let frame = 0; frame < 3; frame++) {
            spine.update(FRAME);
            stage.render();
        }
        expect(label.visible).toBe(false);
        expect(stage.counts.draws).toHaveLength(1);
        // Containers that are let go of while they wait. A detach: the container is the caller's again, and visible
        spine.attach('b', detached);
        other.attach('a', kept);
        other.attach('b', gone);
        expect([detached.visible, gone.visible, kept.visible]).toEqual([false, false, false]);
        spine.detach(detached);
        expect(detached.visible).toBe(true);
        expect(detached.listenerCount('destroyed')).toBe(0);
        // a container that is destroyed while it waits frees its slot
        gone.destroy();
        other.attach('b', detached);
        // a display object that is destroyed lets go of what waits on it
        other.destroy();
        expect([kept.visible, detached.visible]).toEqual([true, true]);
        expect([kept.destroyed, detached.destroyed]).toEqual([false, false]);
        expect(kept.listenerCount('destroyed') + detached.listenerCount('destroyed')).toBe(0);
        await loadAttachCode();
        expect(attachCodeState()).toBe('loaded');
        // the code found nobody of them waiting: they are in no display list
        expect([detached.parent, kept.parent]).toEqual([null, null]);
        // the code is there: the container takes its place with the next update, also at rest
        const { skips } = spine.stats;

        spine.update(FRAME);
        stage.render();
        expect(spine.stats.skips).toBe(skips);
        expect(label.visible).toBe(true);
        expect(label.parent?.label).toBe('marrow-skeleton');
        expect(label.position.x).toBeCloseTo(50);
        // the skeleton is two batches around it
        expect(stage.counts.draws).toHaveLength(2);
        // a later container shows at once
        const second = new Container();

        spine.attach('b', second);
        expect(second.parent?.label).toBe('marrow-skeleton');
        spine.update(FRAME);
        expect(second.visible).toBe(true);
        spine.destroy();
    });
});
