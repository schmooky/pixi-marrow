import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, type PoseEngine } from '../../src/core';
import { listFixtures, readFixture } from '../parity/fixtures';
import { measureUpdates, WINDOW } from './heap';

/*
 * A played loop allocates nothing after warm-up: the invariant of AGENTS.md, measured on live
 * engines with timelines playing. The budget and the method are in heap.ts.
 *
 * The cases cover both engines and what an update can run: plain bones, IK and transform
 * constraints, paths, physics, deforms, and two tracks with a mix.
 */

/** A fixture, the animations to play on tracks 0, 1 and so on, and what the case covers. */
const CASES: readonly (readonly [string, readonly string[], string])[] = [
    ['4.1/spineboy-pro.skel', ['walk'], 'the 4.1 world transforms'],
    ['4.2/speedy-ess.skel', ['run'], 'bones without constraints'],
    ['4.2/spineboy-pro.skel', ['walk'], 'IK and transform constraints'],
    ['4.2/spineboy-pro.skel', ['run', 'aim'], 'two tracks'],
    ['4.2/raptor-pro.skel', ['walk'], 'IK and bones that inherit in part'],
    ['4.2/vine-pro.skel', ['grow'], 'a path constraint'],
    ['4.2/celestial-circus-pro.skel', ['swing'], 'physics constraints'],
    ['4.3/speedy-ess.skel', ['run'], 'bones without constraints'],
    ['4.3/spineboy-pro.skel', ['walk'], 'IK and transform constraints'],
    ['4.3/spineboy-pro.skel', ['run', 'aim'], 'two tracks'],
    ['4.3/raptor-pro.skel', ['walk'], 'IK and bones that inherit in part'],
    ['4.3/vine-pro.skel', ['grow'], 'a path constraint'],
    ['4.3/celestial-circus-pro.skel', ['swing'], 'physics constraints'],
];

/**
 * The engines of every case stay alive to the end of the file. V8 throws optimized code away when
 * an object it was compiled for is collected, and the code then allocates until it is compiled again.
 */
const alive: PoseEngine[] = [];

async function playing(id: string, animations: readonly string[]): Promise<PoseEngine> {
    const fixture = listFixtures().find((candidate) => candidate.id === id);

    if (fixture === undefined) throw new Error(`no fixture ${id}`);
    const model = await importSkeleton(readFixture(fixture).skeleton);
    const engine = await createPoseEngine(model);

    animations.forEach((name, track) => {
        const index = model.animations.findIndex((animation) => animation.name === name);

        if (index < 0) throw new Error(`${id} has no animation ${name}`);
        engine.setAnimation(track, index, true);
    });
    alive.push(engine);

    return engine;
}

describe('a playing pose engine', () => {
    it.each(CASES)('allocates nothing per update: %s %j, %s', async (id, animations) => {
        const result = await measureUpdates(await playing(id, animations));

        const last = result.perUpdate.map((bytes) => bytes.toFixed(1)).join(', ');

        expect(result.quiet, `${last} bytes per update in the last windows of ${WINDOW} updates`).toBe(true);
    });

    it.each(['4.2/spineboy-pro.skel', '4.3/spineboy-pro.skel'])(
        'keeps its events until takeEvents is called: %s',
        async (id) => {
            const engine = await playing(id, ['walk']);

            // ten seconds of a walk that nobody asks for its events: every `complete` and every footstep waits
            for (let i = 0; i < 600; i++) engine.update(1 / 60);
            const events = engine.takeEvents();

            expect(events.length).toBeGreaterThan(20);
            expect(events[0]?.type).toBe('start');
            // taken once, and an update without events hands out one shared empty list
            expect(engine.takeEvents()).toEqual([]);
            expect(engine.takeEvents()).toBe(engine.takeEvents());
            expect(Object.isFrozen(engine.takeEvents())).toBe(true);
        },
    );

    it('is measured while the pose changes', async () => {
        const engine = await playing('4.2/spineboy-pro.skel', ['walk']);
        const before = engine.state.version;

        engine.update(1 / 60);
        expect(engine.state.version).not.toBe(before);
    });
});
