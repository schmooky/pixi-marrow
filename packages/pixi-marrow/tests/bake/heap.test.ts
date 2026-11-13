import { describe, expect, it } from 'vitest';
import { playBaked } from '../../src/bake/playback';
import type { PoseEngine, SkeletonModel } from '../../src/core';
import { settle } from '../render/heap';
import { DT, displayEngine, hostOf, modelOf } from './kit';

/*
 * A baked update allocates nothing once it is warm: it advances the tracks and writes a frame
 * into the arrays of the pose state. An event that fires is an object, `complete` too, so the
 * animation has no event keys and plays slowly enough that no loop ends while the heap is
 * watched. A frame changes every 100 updates or so.
 */

/** The longest animation without event keys. */
function quietAnimation(model: SkeletonModel): number {
    let best = -1;

    model.animations.forEach(({ duration, timelines }, index) => {
        if (timelines.some(({ kind }) => kind === 'event')) return;
        if (best < 0 || duration > (model.animations[best]?.duration ?? 0)) best = index;
    });

    return best;
}

/** Updates of one frame, with what happened taken out. */
const updates = (engine: PoseEngine) => () => {
    engine.update(DT);
    engine.takeEvents();
};

describe.each(['4.1/spineboy-pro.skel', '4.2/raptor-pro.skel', '4.3/raptor-pro.skel', '4.3/spineboy-pro.skel'])(
    '%s',
    (id) => {
        it('plays baked without allocating', { timeout: 60_000 }, async () => {
            const model = await modelOf(id);
            const host = await hostOf(model);
            const baked = displayEngine(host);
            const tally = playBaked(host, baked, null);

            baked.timeScale = 0.01;
            baked.setAnimation(0, quietAnimation(model), true);
            expect(settle(updates(baked), 400)).toBeGreaterThan(0);
            expect(tally.unbaked).toBe(1);
        });
    },
);
