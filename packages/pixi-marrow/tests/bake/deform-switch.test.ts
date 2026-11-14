import { describe, expect, it } from 'vitest';
import { playBaked } from '../../src/bake/playback';
import type { PoseEngine } from '../../src/core';
import { animationIndex, VERSIONS } from '../api/helpers';
import { bakeable, DT, displayEngine, hostOf, modelOf, poseDifference } from './kit';

/*
 * Baked playback and `PoseEngine.deform`, which `lod` turns off for a skeleton drawn small. While
 * it is off, a baked frame writes no deform, so the meshes keep their setup vertices. A change of
 * the switch that clears a deform makes one update pose live, and baked playback goes on after it.
 * Turned back on, the next baked frame writes its deform.
 */

/** The slots with a deform. */
function deformed(engine: PoseEngine): number[] {
    return [...engine.state.deformLengths].flatMap((length, slot) => (length > 0 ? [slot] : []));
}

describe.each(VERSIONS)('baked playback and the deform switch in %s', (version) => {
    it('writes no deform while the switch is off, and the deform again once it is on', async () => {
        const model = await modelOf(`${version}/alien-pro.skel`);
        const host = await hostOf(model);
        const live = displayEngine(host);
        const baked = displayEngine(host);
        const tally = playBaked(host, baked, null);
        const death = animationIndex(model, 'death');
        const both = (times: number): void => {
            for (let i = 0; i < times; i++) {
                live.update(DT);
                baked.update(DT);
            }
        };

        expect(bakeable(model)).toBe(true);
        live.setAnimation(0, death, false);
        baked.setAnimation(0, death, false);
        both(20);
        expect(tally.baked).toBeGreaterThan(0);
        expect(deformed(baked).length).toBeGreaterThan(0);

        baked.deform = false;
        expect(deformed(baked)).toEqual([]);
        const before = tally.baked;

        baked.update(DT);
        live.update(DT);
        // the switch changed: this update was posed by the engine
        expect(tally.baked).toBe(before);
        for (let i = 0; i < 30; i++) {
            both(1);
            expect(deformed(baked)).toEqual([]);
        }
        expect(tally.baked).toBeGreaterThan(before + 20);

        baked.deform = true;
        both(1);
        expect(deformed(baked).length).toBeGreaterThan(0);
        expect(poseDifference(live.state, baked.state, false)).toBeNull();
        both(10);
        expect(tally.last).toContain('baked');
        expect(deformed(baked)).toEqual(deformed(live));
    });
    it('poses live while the deform is off and a path follows a deform of the clip', async () => {
        const model = await modelOf(`${version}/stretchyman-pro.skel`);
        const host = await hostOf(model);
        const live = displayEngine(host);
        const baked = displayEngine(host);
        const tally = playBaked(host, baked, null);
        const sneak = animationIndex(model, 'sneak');

        live.setAnimation(0, sneak, true);
        baked.setAnimation(0, sneak, true);
        for (let i = 0; i < 20; i++) {
            live.update(DT);
            baked.update(DT);
        }
        expect(tally.baked).toBeGreaterThan(0);
        live.deform = false;
        baked.deform = false;
        for (let i = 0; i < 30; i++) {
            live.update(DT);
            baked.update(DT);
            // the bones on the path follow the setup path, as in a live update
            expect(poseDifference(live.state, baked.state, false)).toBeNull();
        }
        expect(tally.last).toContain('a path the clip deforms');
    });
});
