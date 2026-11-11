import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoseEngine, TrackEntry } from '../../src/core';
import { type MarrowAsset, MarrowSpine } from '../../src/index';
import { animationIndex, bareEngine, FRAME, fixtureAsset, poseOf, VERSIONS } from './helpers';

/** The fields of an entry that play and queue options can reach. */
function fieldsOf(entry: TrackEntry | undefined): Record<string, unknown> {
    if (entry === undefined) throw new Error('the engine made no entry');
    const { trackIndex, animation, loop, delay, trackEnd, timeScale, alpha, mixDuration, reverse } = entry;

    return { trackIndex, animation, loop, delay, trackEnd, timeScale, alpha, mixDuration, reverse };
}

/** The entry the nth call of an engine method returned. */
function entryOf(spy: { mock: { results: { type: string; value: unknown }[] } }, call = 0): TrackEntry {
    const result = spy.mock.results[call];

    if (result === undefined || result.type !== 'return') throw new Error(`call ${call} returned nothing`);

    return result.value as TrackEntry;
}

function steps(spine: MarrowSpine, engine: PoseEngine, count: number): void {
    for (let i = 0; i < count; i++) {
        spine.update(FRAME);
        engine.update(FRAME);
    }
}

describe.each(VERSIONS)('MarrowSpine playback of a Spine %s skeleton', (version) => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];
    const index = (name: string): number => animationIndex(asset.model, name);

    function create(): MarrowSpine {
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    beforeAll(async () => {
        asset = await fixtureAsset(`${version}/spineboy-pro.skel`);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    describe('play', () => {
        it('plays on track 0, once, when no options are given', () => {
            const spine = create();
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');
            const configure = vi.spyOn(spine.engine, 'configure');
            const track = spine.play('walk');

            expect(setAnimation).toHaveBeenCalledExactlyOnceWith(0, index('walk'), false);
            expect(configure).not.toHaveBeenCalled();
            expect(track.animation).toBe('walk');
            expect(track.track).toBe(0);
            expect(track.loop).toBe(false);
            expect(track.speed).toBe(1);
            expect(track.alpha).toBe(1);
            expect(track.time).toBe(0);
        });

        it('leaves the entry as the engine makes it', () => {
            const spine = create();
            const bare = bareEngine(asset);
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');

            spine.play('run');

            expect(fieldsOf(entryOf(setAnimation))).toEqual(fieldsOf(bare.setAnimation(0, index('run'), false)));
        });

        it('hands every option to the track entry', () => {
            const spine = create();
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');

            spine.play('idle');
            spine.play('run', { track: 2, loop: true, mix: 0.25, speed: 0.5, alpha: 0.4, reverse: true });

            expect(fieldsOf(entryOf(setAnimation, 1))).toMatchObject({
                trackIndex: 2,
                animation: index('run'),
                loop: true,
                mixDuration: 0.25,
                timeScale: 0.5,
                alpha: 0.4,
                reverse: true,
            });
        });

        it('counts the seconds an animation has played', () => {
            const spine = create();
            const track = spine.play('walk', { speed: 2 });

            spine.update(0.25);
            spine.update(0.25);

            expect(track.time).toBeCloseTo(1, 10);
        });

        it('plays on several tracks at once, like the engine', () => {
            const spine = create();
            const bare = bareEngine(asset);

            spine.play('walk', { loop: true });
            spine.play('shoot', { track: 1 });
            spine.play('aim', { track: 3, alpha: 0.5 });
            bare.setAnimation(0, index('walk'), true);
            bare.setAnimation(1, index('shoot'), false);
            bare.configure(bare.setAnimation(3, index('aim'), false), { alpha: 0.5 });
            steps(spine, bare, 30);

            expect(poseOf(spine.engine)).toEqual(poseOf(bare));
        });
    });

    describe('queue', () => {
        it('plays at once on an empty track', () => {
            const spine = create();
            const addAnimation = vi.spyOn(spine.engine, 'addAnimation');
            const started = vi.fn();

            spine.on('start', started);
            const track = spine.queue('walk', { track: 1 });
            spine.update(FRAME);

            expect(addAnimation).toHaveBeenCalledExactlyOnceWith(1, index('walk'), false, 0);
            expect(started).toHaveBeenCalledExactlyOnceWith(track);
            expect(track.time).toBeCloseTo(FRAME, 10);
        });

        it('waits for the animation before it, timed as the engine times it', () => {
            const spine = create();
            const bare = bareEngine(asset);
            const addAnimation = vi.spyOn(spine.engine, 'addAnimation');

            spine.defaultMix = 0.2;
            bare.defaultMix = 0.2;
            spine.play('walk');
            const track = spine.queue('run', { loop: true });
            bare.setAnimation(0, index('walk'), false);
            const expected = bare.addAnimation(0, index('run'), true, 0);

            expect(fieldsOf(entryOf(addAnimation))).toEqual(fieldsOf(expected));
            expect(expected.delay).toBeGreaterThan(0);
            spine.update(0.5);
            expect(track.time).toBe(0);
        });

        it('hands every option to the track entry', () => {
            const spine = create();
            const addAnimation = vi.spyOn(spine.engine, 'addAnimation');

            spine.play('walk', { track: 1 });
            spine.queue('run', { track: 1, loop: true, delay: 0.4, speed: 2, alpha: 0.5, reverse: true });

            expect(addAnimation).toHaveBeenCalledExactlyOnceWith(1, index('run'), true, 0.4);
            expect(fieldsOf(entryOf(addAnimation))).toMatchObject({
                trackIndex: 1,
                loop: true,
                delay: 0.4,
                timeScale: 2,
                alpha: 0.5,
                reverse: true,
            });
        });

        it.each([
            { name: 'walk', frames: 7, delay: 0 },
            { name: 'walk', frames: 7, delay: -0.1 },
            { name: 'walk', frames: 7, delay: 0.3 },
            // shorter than the mix: 4.2 and 4.3 clamp the delay at 0, 4.1 does not
            { name: 'idle-turn', frames: 7, delay: 0 },
            // played past its end
            { name: 'idle-turn', frames: 30, delay: -0.05 },
            // no duration
            { name: 'aim', frames: 7, delay: 0 },
        ])('times a mix after $frames frames of $name with delay $delay like a mix set on the engine', (script) => {
            const { name, frames, delay } = script;
            const spine = create();
            const bare = bareEngine(asset);
            const addAnimation = vi.spyOn(spine.engine, 'addAnimation');

            spine.play(name, { loop: name === 'walk' });
            bare.setAnimation(0, index(name), name === 'walk');
            steps(spine, bare, frames);
            spine.queue('run', { mix: 0.4, delay });
            spine.queue('idle', { mix: 0.3, delay });
            bare.setMix(index(name), index('run'), 0.4);
            bare.setMix(index('run'), index('idle'), 0.3);
            const run = bare.addAnimation(0, index('run'), false, delay);
            const idle = bare.addAnimation(0, index('idle'), false, delay);

            expect(fieldsOf(entryOf(addAnimation, 0))).toEqual(fieldsOf(run));
            expect(fieldsOf(entryOf(addAnimation, 1))).toEqual(fieldsOf(idle));
            steps(spine, bare, 120);
            expect(poseOf(spine.engine)).toEqual(poseOf(bare));
        });
    });

    describe('stop', () => {
        it('clears every track at once and keeps the pose', () => {
            const spine = create();
            const bare = bareEngine(asset);
            const clearTracks = vi.spyOn(spine.engine, 'clearTracks');

            spine.play('walk', { loop: true });
            spine.play('shoot', { track: 1 });
            bare.setAnimation(0, index('walk'), true);
            bare.setAnimation(1, index('shoot'), false);
            steps(spine, bare, 12);
            const before = poseOf(spine.engine);

            spine.stop();
            bare.clearTracks();
            steps(spine, bare, 5);

            expect(clearTracks).toHaveBeenCalledOnce();
            expect(poseOf(spine.engine)).toEqual(poseOf(bare));
            expect(poseOf(spine.engine).local).toEqual(before.local);
        });

        it('clears one track and leaves the others playing', () => {
            const spine = create();
            const clearTrack = vi.spyOn(spine.engine, 'clearTrack');
            const walk = spine.play('walk', { loop: true });
            const shoot = spine.play('shoot', { track: 1, loop: true });

            spine.update(0.1);
            spine.stop({ track: 1 });
            spine.update(0.1);

            expect(clearTrack).toHaveBeenCalledExactlyOnceWith(1);
            expect(walk.time).toBeCloseTo(0.2, 10);
            expect(shoot.time).toBeCloseTo(0.1, 10);
        });

        it('clears at once when the mix is 0', () => {
            const spine = create();
            const clearTrack = vi.spyOn(spine.engine, 'clearTrack');
            const setEmptyAnimation = vi.spyOn(spine.engine, 'setEmptyAnimation');

            spine.play('walk');
            spine.stop({ track: 0, mix: 0 });

            expect(clearTrack).toHaveBeenCalledExactlyOnceWith(0);
            expect(setEmptyAnimation).not.toHaveBeenCalled();
        });

        it('mixes every track that plays out to the setup pose', () => {
            const spine = create();
            const bare = bareEngine(asset);
            const setEmptyAnimation = vi.spyOn(spine.engine, 'setEmptyAnimation');
            const setup = poseOf(bareEngine(asset)).local;

            spine.play('walk', { loop: true });
            spine.play('shoot', { track: 2, loop: true });
            bare.setAnimation(0, index('walk'), true);
            bare.setAnimation(2, index('shoot'), true);
            steps(spine, bare, 12);
            spine.stop({ mix: 0.2 });
            bare.setEmptyAnimation(0, 0.2);
            bare.setEmptyAnimation(2, 0.2);
            steps(spine, bare, 6);

            // track 1 holds nothing, so it gets no empty animation
            expect(setEmptyAnimation.mock.calls).toEqual([
                [0, 0.2],
                [2, 0.2],
            ]);
            expect(poseOf(spine.engine)).toEqual(poseOf(bare));
            expect(poseOf(spine.engine).local).not.toEqual(setup);
            steps(spine, bare, 12);
            expect(poseOf(spine.engine)).toEqual(poseOf(bare));
            expect(poseOf(spine.engine).local).toEqual(setup);
        });

        it('mixes one track out', () => {
            const spine = create();
            const setEmptyAnimation = vi.spyOn(spine.engine, 'setEmptyAnimation');

            spine.play('walk', { loop: true });
            spine.play('shoot', { track: 1, loop: true });
            spine.update(0.1);
            spine.stop({ track: 1, mix: 0.3 });

            expect(setEmptyAnimation).toHaveBeenCalledExactlyOnceWith(1, 0.3);
        });
    });

    describe('Track', () => {
        it('sets loop, speed and alpha on its entry', () => {
            const spine = create();
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');
            const track = spine.play('walk');

            track.loop = true;
            track.speed = 2;
            track.alpha = 0.25;

            expect(fieldsOf(entryOf(setAnimation))).toMatchObject({ loop: true, timeScale: 2, alpha: 0.25 });
            expect([track.loop, track.speed, track.alpha]).toEqual([true, 2, 0.25]);
        });

        it('keeps its last values once it was disposed, and setting them does nothing', () => {
            const spine = create();
            const track = spine.play('walk', { loop: true, speed: 2, alpha: 0.5 });

            spine.update(0.25);
            spine.stop();
            const configure = vi.spyOn(spine.engine, 'configure');
            const other = spine.play('run');

            track.loop = false;
            track.speed = 9;
            track.alpha = 0;
            spine.update(0.25);

            expect(configure).not.toHaveBeenCalled();
            expect([track.animation, track.track, track.loop, track.speed, track.alpha]).toEqual([
                'walk',
                0,
                true,
                2,
                0.5,
            ]);
            expect(track.time).toBeCloseTo(0.5, 10);
            expect([other.loop, other.speed, other.alpha]).toEqual([false, 1, 1]);
        });

        it('stops the track it is on', () => {
            const spine = create();
            const clearTrack = vi.spyOn(spine.engine, 'clearTrack');
            const setEmptyAnimation = vi.spyOn(spine.engine, 'setEmptyAnimation');
            const walk = spine.play('walk', { loop: true });
            const shoot = spine.play('shoot', { track: 1, loop: true });

            shoot.stop();
            walk.stop({ mix: 0.2 });

            expect(clearTrack).toHaveBeenCalledExactlyOnceWith(1);
            expect(setEmptyAnimation).toHaveBeenCalledExactlyOnceWith(0, 0.2);
        });

        it('does not stop a later animation once it was disposed', () => {
            const spine = create();
            const first = spine.play('walk');

            spine.stop();
            const second = spine.play('run', { loop: true });
            const clearTrack = vi.spyOn(spine.engine, 'clearTrack');

            first.stop();
            spine.update(0.1);

            expect(clearTrack).not.toHaveBeenCalled();
            expect(second.time).toBeCloseTo(0.1, 10);
        });
    });

    it('leaves the engine in the state the same calls leave a bare engine in', () => {
        const spine = create();
        const bare = bareEngine(asset);

        spine.defaultMix = 0.15;
        spine.setMix('walk', 'run', 0.3);
        spine.timeScale = 1.25;
        bare.defaultMix = 0.15;
        bare.setMix(index('walk'), index('run'), 0.3);
        bare.timeScale = 1.25;
        spine.play('walk', { loop: true });
        bare.setAnimation(0, index('walk'), true);
        steps(spine, bare, 20);
        expect(poseOf(spine.engine)).toEqual(poseOf(bare));

        spine.play('run', { loop: true, speed: 0.75 });
        spine.queue('jump', { delay: 0.5 });
        spine.play('shoot', { track: 1, alpha: 0.6, mix: 0.1 });
        bare.configure(bare.setAnimation(0, index('run'), true), { timeScale: 0.75 });
        bare.addAnimation(0, index('jump'), false, 0.5);
        bare.configure(bare.setAnimation(1, index('shoot'), false), { alpha: 0.6, mixDuration: 0.1 });
        steps(spine, bare, 75);
        expect(poseOf(spine.engine)).toEqual(poseOf(bare));

        spine.stop({ track: 1, mix: 0.25 });
        bare.setEmptyAnimation(1, 0.25);
        steps(spine, bare, 40);
        expect(poseOf(spine.engine)).toEqual(poseOf(bare));
        expect(spine.engine.state.time).toBe(bare.state.time);
    });
});
