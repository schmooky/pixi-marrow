import { describe, expect, it } from 'vitest';
import { frameAt } from '../../src/bake/clip';
import type { BakeTally } from '../../src/bake/playback';
import { playBaked } from '../../src/bake/playback';
import { bakesOf } from '../../src/bake/store';
import type { PoseEngine, SkeletonModel, TrackEntry, TrackFields } from '../../src/core';
import { BAKE_RIGS, bakeable, DT, displayEngine, eventData, hostOf, modelOf, poseDifference } from './kit';

/*
 * Baked playback against the engine without it, on every animation of every fixture that can
 * be baked, in 4.1, 4.2 and 4.3. Two engines play the same calls: one plays, the other plays
 * baked where it can. The events must be equal after every update, to the bit.
 *
 * At a sample time the pose must be equal at the precision of a clip: the world transforms of
 * the bones, the slot colors, the attachments, the sequence indices, the deforms and the draw
 * order. A sample time is a time a clip has a frame for, to the bit: a sum of steps of 1 / 60
 * from 0, as the baker steps, or the end of the animation. Played from the setup pose by one
 * frame per update, the pose of the engine rounded to 32 bits is the frame.
 *
 * Other steps reach a sample time on another path. The pose of 4.1 and 4.2 depends on the pose
 * before in its last bits, so there it is equal within a millionth. Between samples the baked
 * pose is the frame before, and the test checks that it shows that one.
 */

/** The time an entry is applied at: the official `getAnimationTime`, from the end in reverse. */
function applyTime(entry: TrackEntry, duration: number): number {
    const start = entry.animationStart;
    let time = start;

    if (!entry.loop) time = Math.min(entry.trackTime + start, entry.animationEnd);
    else if (entry.animationEnd - start !== 0) time = (entry.trackTime % (entry.animationEnd - start)) + start;

    return entry.reverse ? duration - time : time;
}

/** The times a clip of this duration has frames at, as the baker reaches them. */
function sampleTimes(duration: number): Set<number> {
    const times = new Set<number>([0, duration]);

    for (let time = DT; time < duration; time += DT) times.add(time);

    return times;
}

interface Run {
    model: SkeletonModel;
    live: PoseEngine;
    baked: PoseEngine;
    tally: BakeTally;
    /** Updates compared at a sample time, and updates checked to show the frame before. */
    samples: number;
    between: number;
}

/** Two engines of a model placed as a display object, the second playing baked. */
async function pair(model: SkeletonModel): Promise<Run> {
    const host = await hostOf(model);
    const baked = displayEngine(host);

    return { model, live: displayEngine(host), baked, tally: playBaked(host, baked, null), samples: 0, between: 0 };
}

/** True when the baked state shows frame `frame` of its clip for every bone the clip moves. */
function showsFrame(run: Run, entry: TrackEntry, time: number): boolean {
    const prepared = bakesOf(run.model).find(run.baked.state.skin, entry.animation, null);

    if (prepared === null) return false;
    const { clip } = prepared;
    const frame = frameAt(clip, time);
    const { world } = run.baked.state;

    return Array.from(clip.bones).every((bone, j) =>
        [0, 1, 2, 3, 4, 5].every((i) => world[bone * 6 + i] === clip.world[(frame * clip.bones.length + j) * 6 + i]),
    );
}

/**
 * One update on both, with the comparisons. `exact` asks for the 32-bit rounding of the live pose
 * at a sample time: the updates step from the setup pose as the baker does.
 */
function step(run: Run, dt: number, what: string, exact: boolean): void {
    const { live, baked, tally } = run;
    const before = tally.baked;

    live.update(dt);
    baked.update(dt);
    expect(baked.takeEvents().map(eventData), what).toEqual(live.takeEvents().map(eventData));
    const entry = live.solo();
    const duration = run.model.animations[entry?.animation ?? -1]?.duration ?? 0;

    if (entry === null) return;
    const time = applyTime(entry, duration);

    if (tally.baked > before) {
        if (!showsFrame(run, entry, time)) expect.fail(`${what}: not the frame of time ${time} (${tally.last})`);
        run.between++;
    }
    if (!sampleTimes(duration).has(time) && !(time >= duration)) return;
    const difference = poseDifference(live.state, baked.state, exact);

    if (difference !== null) expect.fail(`${what}, time ${time}: ${difference} (${tally.last})`);
    run.samples++;
}

/** The steps that play an animation once and a while past its end. */
const stepsFor = (duration: number): number => Math.min(240, Math.ceil(duration * 60) + 8);

/** Plays one animation from the setup pose, one frame per update. Returns the updates baked and the samples compared. */
async function fromSetup(model: SkeletonModel, index: number, loop: boolean): Promise<[number, number]> {
    const { name, duration } = model.animations[index] ?? { name: '', duration: 0 };
    const run = await pair(model);
    const steps = loop ? Math.min(240, Math.ceil(duration * 60 * 2.3) + 2) : stepsFor(duration);

    run.live.setAnimation(0, index, loop);
    run.baked.setAnimation(0, index, loop);
    for (let i = 0; i < steps; i++) {
        // the first pass reaches every sample on the path the baker took
        step(run, DT, `${name}${loop ? ' looped' : ''}, update ${i + 1}`, !loop || (i + 1) / 60 < duration);
    }

    return [run.tally.baked, run.samples];
}

/** Plays one animation looped with the fields of an entry, on top of a time scale of 1.5. Returns the updates baked. */
async function withFields(model: SkeletonModel, index: number, fields: TrackFields): Promise<number> {
    const { name, duration } = model.animations[index] ?? { name: '', duration: 0 };
    const run = await pair(model);

    for (const engine of [run.live, run.baked]) {
        engine.timeScale = 1.5;
        engine.configure(engine.setAnimation(0, index, true), fields);
    }
    for (let i = 0; i < stepsFor(duration) * 2; i++)
        step(run, DT, `${name} ${JSON.stringify(fields)}, update ${i + 1}`, false);

    return run.between;
}

/** Plays one animation once, and the next one queued after it with a mix. Returns the updates baked. */
async function queued(model: SkeletonModel, index: number): Promise<number> {
    const { name, duration } = model.animations[index] ?? { name: '', duration: 0 };
    const run = await pair(model);
    const next = (index + 1) % model.animations.length;

    for (const engine of [run.live, run.baked]) {
        engine.setMix(index, next, 0.1);
        engine.setAnimation(0, index, false);
        engine.addAnimation(0, next, true, 0);
    }
    for (let i = 0; i < stepsFor(duration) + 30; i++) step(run, DT, `${name} then queued, update ${i + 1}`, false);

    return run.between;
}

describe.each(BAKE_RIGS)('$id', (fixture) => {
    it('plays every animation baked as the engine plays it', { timeout: 60_000 }, async () => {
        const model = await modelOf(fixture.id);

        // a rig whose default skin turns on physics or a slider plays without baking: see the fallback tests
        if (!bakeable(model)) return;
        let baked = 0;
        let samples = 0;

        for (let index = 0; index < model.animations.length; index++) {
            // once past the end, then looped
            for (const loop of [false, true]) {
                const [played, compared] = await fromSetup(model, index, loop);

                baked += played;
                samples += compared;
            }
        }
        expect(baked).toBeGreaterThan(0);
        expect(samples).toBeGreaterThan(model.animations.length);
    });

    it('fires the same events with a time scale, in reverse and with a start and an end', {
        timeout: 60_000,
    }, async () => {
        const model = await modelOf(fixture.id);

        if (!bakeable(model)) return;
        let between = 0;

        for (const [index, { duration }] of model.animations.entries()) {
            const frames = Math.round(duration * 60);

            for (const fields of [
                { timeScale: 2 },
                { reverse: true },
                { animationStart: Math.floor(frames / 4) / 60, animationEnd: Math.ceil((frames * 3) / 4) / 60 },
                { timeScale: 0.5, reverse: true, animationStart: Math.floor(frames / 3) / 60 },
            ]) {
                between += await withFields(model, index, fields);
            }
            // the entry after this one mixes in, then plays alone
            between += await queued(model, index);
        }
        expect(between).toBeGreaterThan(0);
    });
});
