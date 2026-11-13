import { describe, expect, it } from 'vitest';
import {
    createPoseEngine,
    importSkeleton,
    MarrowError,
    type PoseEngine,
    type SkeletonModel,
    type TrackEntry,
} from '../../src/core';
import { loadPoseRig } from '../parity/pose-official';
import { attachmentLabels, engineSubject, runScript, type Subject } from '../parity/pose-run';
import { SCRIPT_FAMILIES } from '../parity/pose-scripts';
import type { PoseDriver } from '../parity/pose-shared';
import { listPoseRigs } from '../parity/pose-synthetic';
import { close32, DT, modelOf } from './kit';

/*
 * `advance` does to the tracks, the events and the skeleton time what `update` does, and
 * leaves the pose alone. Every script of the pose parity suite runs on two engines of a rig:
 * one updates, the other advances whenever one entry plays alone on track 0. The events, the
 * entries the calls return, the solo entry after every update and the skeleton time must be
 * equal to the bit. That covers loops, time scales, reverse, the start and end of an entry,
 * queues, mixes in and out of an entry that plays alone, and every call between two updates.
 */

/** One skeleton per rig and version, the fixtures and the rigs made for the suite. */
const sources = listPoseRigs().filter(
    (source, i, all) => all.findIndex((other) => other.version === source.version && other.rig === source.rig) === i,
);

const entryOf = (entry: TrackEntry | null) =>
    entry === null
        ? null
        : {
              animation: entry.animation,
              loop: entry.loop,
              trackTime: entry.trackTime,
              timeScale: entry.timeScale,
              reverse: entry.reverse,
              animationStart: entry.animationStart,
              animationEnd: entry.animationEnd,
          };

/** A side of the comparison that reads the tracks and the time only: the pose of the advancing side lags. */
function timesOnly(subject: Subject, engine: PoseEngine): Subject {
    return { ...subject, read: () => ({ time: engine.state.time, solo: entryOf(engine.solo()) }), stamps: () => '' };
}

/** The engine whose updates advance while an entry plays alone. Counts the updates it advanced. */
function advancing(engine: PoseEngine, counter: { advanced: number }): PoseDriver {
    return new Proxy(engine, {
        get(target, key) {
            if (key === 'update') {
                return (dt: number) => {
                    if (target.solo() === null) target.update(dt);
                    else {
                        target.advance(dt);
                        counter.advanced++;
                    }
                };
            }
            const value: unknown = Reflect.get(target, key);

            return typeof value === 'function' ? value.bind(target) : value;
        },
        set: (target, key, value) => Reflect.set(target, key, value),
    });
}

describe.each(sources)('$id', (source) => {
    it('advances the tracks and the events as an update does, in every family', { timeout: 60_000 }, async () => {
        const files = source.read();
        const info = loadPoseRig(source.version, files).info;
        const model: SkeletonModel = await importSkeleton(files.skeleton);
        const labels = attachmentLabels(model);
        const counter = { advanced: 0 };

        for (const family of SCRIPT_FAMILIES) {
            for (const script of family.scripts(info, `${source.version}/${source.rig}`)) {
                const plain = await createPoseEngine(model);
                const lagging = await createPoseEngine(model);
                const expected = timesOnly(engineSubject(plain, labels.ofObject), plain);
                const actual = timesOnly(engineSubject(lagging, labels.ofObject), lagging);
                const failure = runScript(script, { ...actual, driver: advancing(lagging, counter) }, expected);

                if (failure !== null) expect.fail(`${source.id}, ${failure}`);
            }
        }
        expect(counter.advanced).toBeGreaterThan(50);
    });
});

describe('the engine calls of baked playback', () => {
    const rig = modelOf;

    it.each(['4.1/spineboy-pro.skel', '4.2/spineboy-pro.skel', '4.3/spineboy-pro.skel'])(
        '%s: solo names the entry that plays alone, and nothing else',
        async (id) => {
            const model = await rig(id);
            const engine = await createPoseEngine(model);

            expect(engine.solo()).toBeNull();
            const run = engine.setAnimation(0, 0, true);

            expect(engine.solo()).toBe(run);
            engine.update(DT);
            engine.setAnimation(1, 1, true);

            expect(engine.solo()).toBeNull();
            engine.clearTrack(1);
            expect(engine.solo()).toBe(run);
            engine.configure(run, { alpha: 0.5 });
            expect(engine.solo()).toBeNull();
            engine.configure(run, { alpha: 1, trackEnd: 3 });
            expect(engine.solo()).toBeNull();
            engine.configure(run, { trackEnd: Number.MAX_VALUE });
            engine.addAnimation(0, 2, true, 0);
            expect(engine.solo()).toBeNull();
            engine.setAnimation(0, 2, true);
            // it mixes from the entry before it
            expect(engine.solo()).toBeNull();
            engine.update(DT);
            engine.update(DT);
            expect(engine.solo()?.animation).toBe(2);
            expect(() => engine.setEmptyAnimation(0, 0.2)).not.toThrow();
            expect(engine.solo()).toBeNull();
            expect(() => engine.advance(DT)).toThrow(MarrowError);
        },
    );

    it.each(['4.2/spineboy-pro.skel', '4.3/spineboy-pro.skel', '4.2/tank-pro.skel', '4.3/raptor-pro.skel'])(
        '%s: a cleared track keeps the pose of the time the tracks were at',
        async (id) => {
            const model = await rig(id);
            const plain = await createPoseEngine(model);
            const lagging = await createPoseEngine(model);

            for (const engine of [plain, lagging]) engine.setAnimation(0, 0, true);
            plain.update(DT);
            lagging.update(DT);
            for (let i = 0; i < 20; i++) {
                plain.update(DT);
                lagging.advance(DT);
            }
            plain.clearTrack(0);
            lagging.clearTrack(0);
            expect(
                Array.from(lagging.state.local).every((value, i) => close32(Number(plain.state.local[i]), value)),
            ).toBe(true);
            plain.update(DT);
            lagging.update(DT);
            expect(
                Array.from(lagging.state.world).every((value, i) => close32(Number(plain.state.world[i]), value)),
            ).toBe(true);
        },
    );

    it.each(['4.2/spineboy-pro.skel', '4.3/spineboy-pro.skel'])(
        '%s: holdsSetup looks at what an animation does not key',
        async (id) => {
            const model = await rig(id);
            const engine = await createPoseEngine(model);
            const walk = model.animations.findIndex(({ name }) => name === 'walk');
            const keyed = model.animations[walk]?.timelines.find(({ kind }) => kind === 'rotate')?.target ?? -1;
            const unkeyed = model.bones.names.indexOf('root');

            expect(engine.holdsSetup(walk)).toBe(true);
            // a value it keys is not looked at
            const { local } = engine.state;

            local[keyed * 7 + 2] = Number(local[keyed * 7 + 2]) + 10;
            expect(engine.holdsSetup(walk)).toBe(true);
            local[unkeyed * 7 + 2] = Number(local[unkeyed * 7 + 2]) + 10;
            expect(engine.holdsSetup(walk)).toBe(false);
            // nor a bone the mask leaves out
            const mask = new Uint8Array(model.bones.count).fill(1);

            mask[unkeyed] = 0;
            expect(engine.holdsSetup(walk, mask)).toBe(true);
            engine.setupPose();
            expect(engine.holdsSetup(walk)).toBe(true);
            // the values of a constraint count too
            engine.setAnimation(
                0,
                model.animations.findIndex(({ name }) => name === 'aim'),
                false,
            );
            engine.update(1);
            expect(engine.holdsSetup(walk)).toBe(false);
        },
    );
});
