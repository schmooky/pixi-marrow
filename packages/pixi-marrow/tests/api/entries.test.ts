import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoseEvent, TrackEntry } from '../../src/core';
import { type MarrowAsset, type MarrowEvent, MarrowSpine, type Track } from '../../src/index';
import { animationIndex, FRAME, fixtureAsset, VERSIONS } from './helpers';

const TRACK_EVENTS = ['start', 'interrupt', 'end', 'dispose', 'complete'] as const;

/** Calls `heard` for every event of a display object, with the type of the event and its track. */
function listen(spine: MarrowSpine, heard: (type: string, track: Track) => void): void {
    for (const type of TRACK_EVENTS) spine.on(type, (track: Track) => heard(type, track));
    spine.on('event', (_event: MarrowEvent, track: Track) => heard('event', track));
}

/** True when a promise has resolved by now. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
    const pending = Symbol('pending');

    return (await Promise.race([promise, Promise.resolve(pending)])) !== pending;
}

describe.each(VERSIONS)('MarrowSpine tracks by entry of a Spine %s skeleton', (version) => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];

    function create(): MarrowSpine {
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    /**
     * Watches a display object from both ends. `seen` is what its listeners get, with the track
     * of each event. `reported` is what its engine reported, with the entry of each event.
     */
    function watch(spine: MarrowSpine): {
        name(track: Track, label: string): Track;
        seen(): string[];
        reported(): string[];
    } {
        const setAnimation = vi.spyOn(spine.engine, 'setAnimation');
        const takeEvents = vi.spyOn(spine.engine, 'takeEvents');
        const labels = new Map<Track, string>();
        const entries = new Map<TrackEntry, string>();
        const seen: string[] = [];

        listen(spine, (type, track) => seen.push(`${type} ${labels.get(track) ?? 'unknown'}`));

        return {
            // call it right after the play that made the track: the engine made its entry last
            name(track, label) {
                const made = setAnimation.mock.results.at(-1);

                labels.set(track, label);
                if (made?.type === 'return') entries.set(made.value, label);

                return track;
            },
            seen: () => seen,
            reported: () =>
                takeEvents.mock.results
                    .flatMap((result): PoseEvent[] => (result.type === 'return' ? result.value : []))
                    .filter((event) => entries.has(event.entry))
                    .map((event) => `${event.type} ${entries.get(event.entry)}`),
        };
    }

    beforeAll(async () => {
        asset = await fixtureAsset(`${version}/spineboy-pro.skel`);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    describe('two live entries of one animation on one track', () => {
        it('each get their own complete, end and dispose', async () => {
            const spine = create();
            const { name, seen, reported } = watch(spine);

            spine.defaultMix = 0.5;
            const first = name(spine.play('shoot'), 'first');
            spine.update(0.6);
            const second = name(spine.play('shoot'), 'second');
            // the first one passes its end while it mixes out
            spine.update(0.1);
            expect(seen().slice(-1)).toEqual(['complete first']);
            expect(await settled(first.finished)).toBe(true);
            expect(await settled(second.finished)).toBe(false);
            spine.update(0.6);
            spine.update(0.1);

            expect(seen()).toEqual([
                'start first',
                'interrupt first',
                'start second',
                'complete first',
                'complete second',
                'end first',
                'dispose first',
            ]);
            expect(seen()).toEqual(reported());
            expect(await settled(second.finished)).toBe(true);
        });

        it('each get their own event keys', () => {
            const spine = create();
            const { name, seen, reported } = watch(spine);
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');

            spine.defaultMix = 0.5;
            name(spine.play('walk', { loop: true }), 'first');
            // an entry fires no events while it mixes out, unless its threshold says so
            spine.engine.configure(setAnimation.mock.results[0]?.value, { eventThreshold: 1 });
            spine.update(0.4);
            name(spine.play('walk', { loop: true }), 'second');
            // the first one passes the footstep at 0.5 s, the second one the footstep at 0 s
            spine.update(0.2);

            expect(seen()).toEqual([
                'start first',
                'event first',
                'interrupt first',
                'start second',
                'event first',
                'event second',
            ]);
            expect(seen()).toEqual(reported());
        });

        it('each get their own complete of a loop', () => {
            const spine = create();
            const { name, seen, reported } = watch(spine);

            spine.defaultMix = 0.5;
            name(spine.play('aim', { loop: true }), 'first');
            spine.update(0.2);
            name(spine.play('aim', { loop: true }), 'second');
            // an animation without a duration completes a loop in every update
            spine.update(0.1);
            spine.update(0.1);

            expect(seen()).toEqual([
                'start first',
                'complete first',
                'interrupt first',
                'start second',
                'complete first',
                'complete second',
                'complete first',
                'complete second',
            ]);
            expect(seen()).toEqual(reported());
        });

        it('end in the order the engine ends them: the older one first when its mix is over first', async () => {
            const spine = create();
            const { name, seen, reported } = watch(spine);

            const first = name(spine.play('run', { loop: true }), 'first');
            for (let i = 0; i < 3; i++) spine.update(FRAME);
            // no mix: the first entry ends as soon as the second one was applied
            const second = name(spine.play('run', { loop: true, mix: 0 }), 'second');
            spine.update(FRAME);
            const third = name(spine.play('run', { loop: true, mix: 0.3 }), 'third');
            const ends = (): string[] => seen().filter((label) => label.startsWith('end'));

            spine.update(FRAME);
            expect(ends()).toEqual(['end first']);
            expect(await settled(first.finished)).toBe(true);
            expect(await settled(second.finished)).toBe(false);
            for (let i = 0; i < 20; i++) spine.update(FRAME);

            expect(ends()).toEqual(['end first', 'end second']);
            expect(seen()).toEqual(reported());
            expect(await settled(second.finished)).toBe(true);
            expect(await settled(third.finished)).toBe(false);
        });

        it('end in the order the engine ends them: the newer one first when all mixes are over', () => {
            const spine = create();
            const { name, seen, reported } = watch(spine);

            spine.defaultMix = 0.3;
            name(spine.play('run', { loop: true }), 'first');
            for (let i = 0; i < 6; i++) spine.update(FRAME);
            name(spine.play('run', { loop: true }), 'second');
            for (let i = 0; i < 6; i++) spine.update(FRAME);
            name(spine.play('run', { loop: true }), 'third');
            const ends = (): string[] => seen().filter((label) => label.startsWith('end'));

            // the older entries are held while the newer ones mix in: none ends before the last mix does
            for (let i = 0; i < 17; i++) spine.update(FRAME);
            expect(ends()).toEqual([]);
            for (let i = 0; i < 3; i++) spine.update(FRAME);

            expect(ends()).toEqual(['end second', 'end first']);
            expect(seen()).toEqual(reported());
        });

        it('end newest first when a command clears the track', () => {
            const spine = create();
            const { name, seen, reported } = watch(spine);

            spine.defaultMix = 0.3;
            name(spine.play('run', { loop: true }), 'first');
            for (let i = 0; i < 3; i++) spine.update(FRAME);
            name(spine.play('run', { loop: true }), 'second');
            for (let i = 0; i < 3; i++) spine.update(FRAME);
            spine.stop();
            spine.update(FRAME);

            expect(seen().slice(-4)).toEqual(['end second', 'dispose second', 'end first', 'dispose first']);
            expect(seen()).toEqual(reported());
        });
    });

    describe('an entry object the engine uses again', () => {
        /** The entry object each call of the engine's setAnimation returned. */
        function entriesOf(spine: MarrowSpine): () => unknown[] {
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');

            return () => setAnimation.mock.results.map((result) => result.value);
        }

        it('gets a new track between two updates, and the old track keeps what it had', async () => {
            const spine = create();
            const entries = entriesOf(spine);
            const heard: [string, Track][] = [];

            listen(spine, (type, track) => heard.push([type, track]));
            const walk = spine.play('walk', { loop: true, speed: 2 });
            spine.update(0.25);
            spine.stop();
            const run = spine.play('run', { loop: true });

            // a 4.3 engine takes the entry of the stopped animation out of its pool
            if (version === '4.3') expect(entries()[1]).toBe(entries()[0]);
            else expect(entries()[1]).not.toBe(entries()[0]);
            run.speed = 3;
            walk.speed = 5;
            walk.alpha = 0;
            walk.stop();
            // the run passes its footstep at 0.233 s
            spine.update(0.1);

            expect(
                heard.map(([type, track]) => `${type} ${track === walk ? 'walk' : track === run ? 'run' : '?'}`),
            ).toEqual(['start walk', 'event walk', 'event walk', 'end walk', 'dispose walk', 'start run', 'event run']);
            expect([walk.animation, walk.loop, walk.speed, walk.alpha, walk.time]).toEqual(['walk', true, 2, 1, 0.5]);
            expect([run.animation, run.loop, run.speed, run.alpha]).toEqual(['run', true, 3, 1]);
            expect(run.time).toBeCloseTo(0.3, 10);
            expect(await settled(walk.finished)).toBe(true);
            expect(await settled(run.finished)).toBe(false);
        });

        it('gets a new track each time it comes back, over many updates', () => {
            const spine = create();
            const entries = entriesOf(spine);
            const started: Track[] = [];
            const disposed: Track[] = [];
            const tracks: Track[] = [];

            spine.on('start', (track: Track) => started.push(track));
            spine.on('dispose', (track: Track) => disposed.push(track));
            for (let i = 0; i < 5; i++) {
                tracks.push(spine.play(i % 2 === 0 ? 'walk' : 'run'));
                spine.update(FRAME);
                spine.stop();
                spine.update(FRAME);
            }

            if (version === '4.3') expect(new Set(entries()).size).toBe(1);
            expect(started.map((track) => tracks.indexOf(track))).toEqual([0, 1, 2, 3, 4]);
            expect(disposed.map((track) => tracks.indexOf(track))).toEqual([0, 1, 2, 3, 4]);
            expect(tracks.map((track) => track.animation)).toEqual(['walk', 'run', 'walk', 'run', 'walk']);
        });

        it('keeps its old track apart when the engine was stopped directly before the next play', async () => {
            const spine = create();
            const entries = entriesOf(spine);
            const { name, seen } = watch(spine);
            const first = name(spine.play('walk', { loop: true, speed: 2 }), 'first');

            spine.update(0.25);
            // behind the back of the display object: its events are not taken yet when play runs
            spine.engine.clearTrack(0);
            const second = name(spine.play('run'), 'second');

            if (version === '4.3') expect(entries()[1]).toBe(entries()[0]);
            second.speed = 3;
            first.speed = 5;
            spine.update(FRAME);

            expect(seen()).toEqual([
                'start first',
                'event first',
                'event first',
                'end first',
                'dispose first',
                'start second',
            ]);
            expect([first.animation, first.loop, first.speed, first.time]).toEqual(['walk', true, 2, 0.5]);
            expect([second.animation, second.loop, second.speed]).toEqual(['run', false, 3]);
            expect(second.time).toBeCloseTo(FRAME * 3, 10);
            expect(await settled(first.finished)).toBe(true);
            expect(await settled(second.finished)).toBe(false);
        });

        it('leaves its old track alone when the engine starts the next entry in the same batch of events', async () => {
            const spine = create();
            const { name, seen } = watch(spine);
            const walk = name(spine.play('walk', { loop: true }), 'walk');

            spine.update(FRAME);
            // behind the back of the display object: end, dispose and the start of the next entry in one batch
            spine.engine.clearTrack(0);
            const direct = spine.engine.setAnimation(0, animationIndex(asset.model, 'run'), false);

            for (let i = 0; i < 45; i++) spine.update(FRAME);
            walk.stop();
            for (let i = 0; i < 5; i++) spine.update(FRAME);

            // the entry made on the engine directly has no track: its start, event and complete are not emitted
            expect(seen()).toEqual(['start walk', 'event walk', 'end walk', 'dispose walk']);
            expect(await settled(walk.finished)).toBe(true);
            expect(direct.trackTime).toBeCloseTo(FRAME * 50, 10);
            // the next play on the track gets its own events again
            name(spine.play('idle'), 'idle');
            spine.update(FRAME);
            expect(seen().slice(4)).toEqual(['start idle']);
        });
    });
});
