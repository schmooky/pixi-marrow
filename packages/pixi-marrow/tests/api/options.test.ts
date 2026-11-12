import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoseEngine, TrackEntry, TrackFields } from '../../src/core';
import { type MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { animationIndex, bareEngine, FRAME, fixtureAsset, poseOf, VERSIONS } from './helpers';

/** The entry the nth call of an engine method returned. */
function entryOf(spy: { mock: { results: { type: string; value: unknown }[] } }, call = 0): TrackEntry {
    const result = spy.mock.results[call];

    if (result === undefined || result.type !== 'return') throw new Error(`call ${call} returned nothing`);

    return result.value as TrackEntry;
}

function thrownBy(run: () => unknown): MarrowError {
    try {
        run();
    } catch (error) {
        if (error instanceof MarrowError) return error;
        throw error;
    }
    throw new Error('nothing was thrown');
}

/** Calls a method with arguments TypeScript would refuse, as untyped code can. */
function callLoosely(spine: MarrowSpine, method: 'play' | 'queue', options: Record<string, unknown>): MarrowError {
    return thrownBy(() => Reflect.apply(spine[method], spine, ['walk', options]));
}

describe.each(VERSIONS)('the track options of a Spine %s skeleton', (version) => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];
    const index = (name: string): number => animationIndex(asset.model, name);
    /** How the Spine version takes an animation that adds. */
    const adds = (additive: boolean): TrackFields =>
        version === '4.3' ? { additive } : { mixBlend: additive ? 'add' : 'replace' };

    function create(): MarrowSpine {
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    /** The fields every configure call of an engine got, in order. */
    function configured(engine: PoseEngine): TrackFields[] {
        const calls: TrackFields[] = [];
        const configure = engine.configure.bind(engine);

        vi.spyOn(engine, 'configure').mockImplementation((entry, fields) => {
            calls.push({ ...fields });
            configure(entry, fields);
        });

        return calls;
    }

    beforeAll(async () => {
        asset = await fixtureAsset(`${version}/spineboy-pro.skel`);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    describe('additive', () => {
        it('sets the field the Spine version has for it, on play and on queue', () => {
            const spine = create();
            const calls = configured(spine.engine);
            const aim = spine.play('aim', { track: 1, additive: true });
            const plain = spine.play('shoot', { track: 2, additive: false });
            const queued = spine.queue('idle', { track: 1, additive: true });

            expect(calls).toEqual([adds(true), adds(false), adds(true)]);
            expect([aim.additive, plain.additive, queued.additive]).toEqual([true, false, true]);
        });

        it('is false on a track that was played without it', () => {
            const spine = create();
            const calls = configured(spine.engine);

            expect(spine.play('walk').additive).toBe(false);
            expect(calls).toEqual([]);
        });

        it('poses the skeleton as the engine does with the same field', () => {
            const spine = create();
            const bare = bareEngine(asset);

            spine.play('walk', { loop: true });
            spine.play('aim', { track: 1, additive: true, alpha: 0.5 });
            bare.setAnimation(0, index('walk'), true);
            bare.configure(bare.setAnimation(1, index('aim'), false), { alpha: 0.5, ...adds(true) });
            for (let i = 0; i < 20; i++) {
                spine.update(FRAME);
                bare.update(FRAME);
            }

            expect(poseOf(spine.engine)).toEqual(poseOf(bare));
        });

        it('differs from the same animation without it', () => {
            const added = create();
            const replaced = create();

            for (const [spine, additive] of [
                [added, true],
                [replaced, false],
            ] as const) {
                spine.play('walk', { loop: true });
                spine.play('aim', { track: 1, additive });
                for (let i = 0; i < 20; i++) spine.update(FRAME);
            }

            expect(poseOf(added.engine).local).not.toEqual(poseOf(replaced.engine).local);
        });

        it('follows a field that configure sets by its official name', () => {
            const spine = create();
            const track = spine.play('aim', { track: 1 });

            track.configure(adds(true));
            expect(track.additive).toBe(true);
            track.configure(adds(false));
            expect(track.additive).toBe(false);
        });
    });

    describe('start and end', () => {
        it('set the official animationStart and animationEnd', () => {
            const spine = create();
            const calls = configured(spine.engine);

            spine.play('walk', { start: 0.25, end: 0.5 });
            spine.queue('run', { start: 0.125 });

            expect(calls).toEqual([{ animationStart: 0.25, animationEnd: 0.5 }, { animationStart: 0.125 }]);
        });

        it('complete the animation after the seconds between them', async () => {
            const spine = create();
            const completed = vi.fn();
            const track = spine.play('walk', { start: 0.25, end: 0.5 });

            spine.on('complete', completed);
            spine.update(0.125);
            spine.update(0.0625);
            expect(completed).not.toHaveBeenCalled();
            spine.update(0.125);

            expect(completed).toHaveBeenCalledExactlyOnceWith(track);
            await expect(track.finished).resolves.toBeUndefined();
        });

        it('time an animation that is queued with a mix after the part that plays', () => {
            const spine = create();
            const addAnimation = vi.spyOn(spine.engine, 'addAnimation');

            spine.play('walk', { start: 0.25, end: 0.75 });
            spine.queue('run', { mix: 0.125 });

            // half a second plays, less the mix
            expect(entryOf(addAnimation).delay).toBe(0.375);
        });

        it('time a queued animation after a part that configure set later', () => {
            const spine = create();
            const addAnimation = vi.spyOn(spine.engine, 'addAnimation');
            const walk = spine.play('walk');

            walk.configure({ animationStart: 0.5, animationEnd: 0.75 });
            spine.queue('run', { mix: 0.125 });

            expect(entryOf(addAnimation).delay).toBe(0.125);
        });
    });

    describe('shortestRotation and eventThreshold', () => {
        it('set the official fields of those names', () => {
            const spine = create();
            const calls = configured(spine.engine);
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');

            spine.play('walk', { shortestRotation: true, eventThreshold: 0.5 });

            expect(calls).toEqual([{ shortestRotation: true, eventThreshold: 0.5 }]);
            expect(entryOf(setAnimation).shortestRotation).toBe(true);
        });

        it('fire the events of an animation that mixes out while the mix is below the threshold', () => {
            const quiet = create();
            const loud = create();
            const heard = { quiet: 0, loud: 0 };

            quiet.on('event', () => heard.quiet++);
            loud.on('event', () => heard.loud++);
            // walk fires footsteps. It mixes out for longer than it lasts
            quiet.play('walk', { loop: true });
            loud.play('walk', { loop: true, eventThreshold: 1 });
            for (const spine of [quiet, loud]) {
                spine.update(FRAME);
                spine.play('idle', { mix: 2 });
            }
            heard.quiet = 0;
            heard.loud = 0;
            for (let i = 0; i < 90; i++) {
                quiet.update(FRAME);
                loud.update(FRAME);
            }

            expect(heard.quiet).toBe(0);
            expect(heard.loud).toBeGreaterThan(0);
        });
    });

    describe('entry', () => {
        it('sets any other official field, after the named options', () => {
            const spine = create();
            const calls = configured(spine.engine);
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');

            spine.play('walk', { alpha: 0.5, speed: 2, entry: { trackEnd: 3, alpha: 0.25 } });

            expect(calls).toEqual([
                { timeScale: 2, alpha: 0.5 },
                { trackEnd: 3, alpha: 0.25 },
            ]);
            expect(entryOf(setAnimation)).toMatchObject({ trackEnd: 3, alpha: 0.25, timeScale: 2 });
        });

        it('takes the fields that only this Spine version has', () => {
            const spine = create();
            const field = version === '4.3' ? 'keepHold' : 'holdPrevious';

            expect(() => spine.play('walk', { entry: { [field]: true } })).not.toThrow();
        });

        it('throws for a field the Spine version lacks, and the animation plays', () => {
            const spine = create();
            const started = vi.fn();
            const field = version === '4.3' ? 'holdPrevious' : 'keepHold';

            spine.on('start', started);
            const error = thrownBy(() => spine.play('walk', { speed: 2, entry: { [field]: true } }));

            spine.update(FRAME);

            expect(error.code).toBe('unsupported-feature');
            expect(error.message).toContain(`no field "${field}"`);
            expect(error.validNames).toContain('trackEnd');
            expect(started).toHaveBeenCalledOnce();
            expect(started.mock.calls[0]?.[0]).toMatchObject({ animation: 'walk', speed: 2 });
        });

        it('throws for the add blend of the other versions, with the field to set', () => {
            const spine = create();
            const other: TrackFields = version === '4.3' ? { mixBlend: 'add' } : { additive: true };
            const error = thrownBy(() => spine.play('aim', { track: 1, entry: other }));

            expect(error.code).toBe('unsupported-feature');
            expect(error.validNames).toContain(version === '4.3' ? 'additive' : 'mixBlend');
        });
    });

    describe('Track.configure', () => {
        it('sets fields of the entry by their official names', () => {
            const spine = create();
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');
            const track = spine.play('walk');

            track.configure({ timeScale: 3, trackEnd: 4, loop: true });

            expect(entryOf(setAnimation)).toMatchObject({ timeScale: 3, trackEnd: 4, loop: true });
            expect(track.speed).toBe(3);
            expect(track.loop).toBe(true);
        });

        it('throws for a value of the wrong type and leaves what the handle remembers', () => {
            const spine = create();
            const track = spine.play('aim', { track: 1, additive: true });
            const error = thrownBy(() => track.configure({ animationEnd: 'late' }));

            expect(error.code).toBe('invalid-data');
            expect(error.message).toContain('"animationEnd"');
            expect(track.additive).toBe(true);
        });

        it('does nothing once the animation was disposed', () => {
            const spine = create();
            const configure = vi.spyOn(spine.engine, 'configure');
            const track = spine.play('walk');

            spine.stop();
            track.configure({ timeScale: 3 });

            expect(configure).not.toHaveBeenCalled();
            expect(track.speed).toBe(1);
        });
    });

    describe('wrong options', () => {
        it('throw for a key that is no option, with the closest one', () => {
            const spine = create();
            const error = callLoosely(spine, 'play', { looping: true });

            expect(error.code).toBe('unknown-name');
            expect(error.message).toContain('"looping" is not an option of play.');
            expect(error.closest).toBe('loop');
            expect(error.validNames).toEqual([
                'track',
                'loop',
                'mix',
                'speed',
                'alpha',
                'start',
                'end',
                'eventThreshold',
                'reverse',
                'shortestRotation',
                'additive',
                'entry',
            ]);
            expect(error.fix).toContain('shortestRotation');
        });

        it('take delay on queue and not on play', () => {
            const spine = create();

            spine.play('idle');
            expect(() => spine.queue('walk', { delay: 0.5 })).not.toThrow();
            expect(callLoosely(spine, 'play', { delay: 0.5 }).message).toContain('"delay" is not an option of play.');
            expect(callLoosely(spine, 'queue', { dealy: 1 }).closest).toBe('delay');
        });

        it.each([
            ['track', -1, 'a whole number from 0'],
            ['track', 1.5, 'a whole number from 0'],
            ['track', '1', 'a whole number from 0'],
            ['loop', 'yes', 'true or false'],
            ['mix', Number.NaN, 'a finite number'],
            ['speed', null, 'a finite number'],
            ['alpha', '1', 'a finite number'],
            ['start', Number.NaN, 'a finite number'],
            ['end', Number.POSITIVE_INFINITY, 'a finite number'],
            ['eventThreshold', '1', 'a finite number'],
            ['reverse', 1, 'true or false'],
            ['shortestRotation', 0, 'true or false'],
            ['additive', 'add', 'true or false'],
            ['entry', null, 'an object with fields of the official TrackEntry'],
            ['entry', 5, 'an object with fields of the official TrackEntry'],
        ])('throw for %s set to %s, before anything plays', (option, value, expected) => {
            const spine = create();
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');
            const addAnimation = vi.spyOn(spine.engine, 'addAnimation');
            const errors = [
                callLoosely(spine, 'play', { [option]: value }),
                callLoosely(spine, 'queue', { [option]: value }),
            ];

            for (const error of errors) {
                expect(error.code).toBe('invalid-data');
                expect(error.message).toContain(`The option "${option}" was set to`);
                expect(error.fix).toBe(`Pass ${expected}.`);
            }
            expect(setAnimation).not.toHaveBeenCalled();
            expect(addAnimation).not.toHaveBeenCalled();
        });

        it('throw for a delay that is no finite number', () => {
            const spine = create();
            const error = callLoosely(spine, 'queue', { delay: Number.NaN });

            expect(error.message).toContain('The option "delay" was set to NaN.');
            expect(error.fix).toBe('Pass a finite number.');
        });
    });
});
