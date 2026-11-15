import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, type PoseEngine } from '../../src/core';
import { listFixtures, readFixture } from '../parity/fixtures';
import type { RigFiles } from '../parity/official';
import { createPair, differences, type Pair, playBoth, updateBoth } from './v43-pair';

/*
 * What happens when a game changes the animation of a track faster than the mix takes.
 *
 * The entry a track mixes from stays until the mix to the next entry is complete. When a new
 * entry comes first, the old ones wait in a chain. The 4.2 runtime drops an entry of the chain
 * once nothing of it shows. The official 4.3 runtime, version 4.3.13, keeps every entry while the
 * track changes faster than its mix: a held timeline of an old entry keeps its alpha. Each entry
 * of the chain is applied in every update, so an update costs more with every change. The chain
 * ends as a whole when one mix runs to its end.
 *
 * Measured on spineboy with a mix of 0.25 seconds and a change every 10 updates, on an Apple M4:
 * an update takes about 10 microseconds at the start and about 700 after a minute. The update
 * after a change then takes about 9 milliseconds, because the hold modes of the chain are computed.
 *
 * The 4.3 engine does the same, because the pose must equal the official one to the bit: the
 * entries that follow mix from the numbers an old entry writes. This test states that behavior.
 * It does not call it right.
 */

const DT = 1 / 60;
const MIX = 0.25;
/** Updates between two changes of animation: 10 updates are 0.167 seconds, less than the mix. */
const EVERY = 10;
const CHANGES = 60;

function files(id: string): RigFiles {
    const fixture = listFixtures().find((candidate) => candidate.id === id);

    if (fixture === undefined) throw new Error(`no fixture ${id}`);

    return readFixture(fixture);
}

/** The entries that have started and not ended, counted from the events of an engine. */
function alive(engine: PoseEngine, count: { alive: number }): void {
    for (const event of engine.takeEvents()) {
        if (event.type === 'start') count.alive++;
        else if (event.type === 'end') count.alive--;
    }
}

describe('a track that changes its animation faster than the mix', () => {
    it('keeps every entry in 4.3, as the official 4.3 core does, until one mix ends', async () => {
        const pair: Pair = await createPair(files('4.3/spineboy-pro.skel'));
        const names = pair.data.animations.map((animation) => animation.name);
        const mine = { alive: 0 };
        const theirs = { alive: 0 };

        pair.engine.defaultMix = MIX;
        pair.state.data.defaultMix = MIX;
        pair.state.addListener({ start: () => theirs.alive++, end: () => theirs.alive-- });
        for (let change = 0; change < CHANGES; change++) {
            playBoth(pair, 0, names.indexOf(change % 2 === 0 ? 'walk' : 'run'), true);
            for (let i = 0; i < EVERY; i++) updateBoth(pair, DT);
            alive(pair.engine, mine);
            expect(differences(pair, `after change ${change}`)).toEqual([]);
        }
        // one entry per change: none has ended
        expect(mine.alive).toBe(CHANGES);
        expect(theirs.alive).toBe(CHANGES);

        // the track stays on one animation for longer than the mix: the whole chain ends
        for (let i = 0; i < 20; i++) updateBoth(pair, DT);
        alive(pair.engine, mine);
        expect(differences(pair, 'after the mix ended')).toEqual([]);
        expect(mine.alive).toBe(1);
        expect(theirs.alive).toBe(1);
    });

    it('keeps a few entries in 4.2', async () => {
        const model = await importSkeleton(files('4.2/spineboy-pro.skel').skeleton);
        const engine = await createPoseEngine(model);
        const index = (name: string): number => model.animations.findIndex((animation) => animation.name === name);
        const count = { alive: 0 };

        engine.defaultMix = MIX;
        for (let change = 0; change < CHANGES; change++) {
            engine.setAnimation(0, index(change % 2 === 0 ? 'walk' : 'run'), true);
            for (let i = 0; i < EVERY; i++) engine.update(DT);
            alive(engine, count);
            expect(count.alive).toBeLessThan(6);
        }
    });
});
