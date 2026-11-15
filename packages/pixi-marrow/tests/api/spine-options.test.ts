import { Container, Ticker } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TrackHandle } from '../../src/api/track';
import { EventList, TrackBook } from '../../src/api/track-book';
import { checkKeys, oneOf } from '../../src/api/values';
import { type MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { animationIndex, bareEngine, FRAME, fixtureAsset, holdTicker } from './helpers';

/*
 * What an audit found unchecked: options of the constructor, setters, the seconds of an update
 * and the container of `follow`. Also the ticker option, the label and the brand.
 */

function thrownBy(run: () => unknown): MarrowError {
    try {
        run();
    } catch (error) {
        if (error instanceof MarrowError) return error;
        throw error;
    }
    throw new Error('nothing was thrown');
}

/** Waits for the code that warns, which loads on demand, and for the warning after it. */
async function warned(): Promise<void> {
    await import('../../src/api/no-effect');
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the options of a display object', () => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];

    /** A display object from options as untyped code can pass them. */
    function create(options: object = {}): MarrowSpine {
        const spine: MarrowSpine = Reflect.construct(MarrowSpine, [asset, { autoUpdate: false, ...options }]);

        made.push(spine);

        return spine;
    }

    beforeAll(async () => {
        asset = await fixtureAsset('4.2/spineboy-pro.skel');
        holdTicker();
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    it('throw for a key that is no option, with the closest one, before anything is made', () => {
        const add = vi.spyOn(Ticker.shared, 'add');
        const createEngine = vi.spyOn(asset, 'createEngine');
        const error = thrownBy(() => create({ autoUpdat: false, autoUpdate: true }));

        expect(error.code).toBe('invalid-option');
        expect(error.message).toContain('"autoUpdat" is not an option of MarrowSpine.');
        expect(error.closest).toBe('autoUpdate');
        expect(error.validNames).toContain('renderMode');
        expect(thrownBy(() => create({ ocklusion: 'off' })).closest).toBe('occlusion');
        expect(add).not.toHaveBeenCalled();
        expect(createEngine).not.toHaveBeenCalled();
    });

    it('take the options of a load with them, as MarrowSpine.load and MarrowSpine.from pass them', () => {
        expect(() =>
            create({ skeleton: 'hero.skel', atlas: 'hero.atlas', textures: {}, outlines: 'off' }),
        ).not.toThrow();
    });

    it.each([
        ['scale', 0.5, 'Set the scale of the display object: hero.scale.set(0.5).'],
        ['darkTint', true, 'Leave it out: a slot with a dark color draws with it.'],
        ['boundsProvider', {}, 'Leave it out: getBounds() measures what the skeleton draws.'],
    ])('say what to use here for the option %s of another runtime', (option, value, fix) => {
        const error = thrownBy(() => create({ [option]: value }));

        expect(error.code).toBe('invalid-option');
        expect(error.message).toContain(`"${option}" is not an option of MarrowSpine.`);
        expect(error.fix).toBe(fix);
        expect(error.closest).toBeUndefined();
    });

    it('throw for a value that occlusion, autoUpdate or a perf object do not take', () => {
        const occlusion = thrownBy(() => create({ occlusion: 'on' }));

        expect(occlusion).toMatchObject({ code: 'invalid-option', validNames: ['auto', 'off'] });
        expect(occlusion.message).toContain('"on" is not a value of occlusion.');
        expect(thrownBy(() => create({ autoUpdate: 'no' })).message).toContain('autoUpdate got "no".');
        const perf = thrownBy(() => create({ perf: { presett: 'fast' } }));

        expect(perf).toMatchObject({ code: 'invalid-option', closest: 'preset' });
        expect(perf.message).toContain('"presett" is not an option of perf.');
        expect(thrownBy(() => create({ lod: 'on' })).code).toBe('invalid-option');
    });

    it('name a closest value only where there is one', () => {
        expect(thrownBy(() => create({ renderMode: 'batch' })).closest).toBe('batched');
        expect(thrownBy(() => oneOf('a value of nothing', 'any', [])).closest).toBeUndefined();
        expect(thrownBy(() => checkKeys({ any: 1 }, 'nothing', [])).closest).toBeUndefined();
        // a key of Object.prototype is no hint of another runtime
        expect(thrownBy(() => checkKeys({ constructor: 1 }, 'play', ['loop'], { scale: 'Set it.' })).closest).toBe(
            'loop',
        );
    });

    it('give the object a label for a dump of the scene tree, and a brand', () => {
        expect(create().label).toBe('MarrowSpine');
        expect(create({ label: 'hero' }).label).toBe('hero');
        expect(create().isMarrowSpine).toBe(true);
    });

    describe('warn once per asset and cause when an option has no effect', () => {
        it.each([
            [
                { instancing: 'auto' },
                /instancing: 'auto' has no effect, because it acts on the mesh mode with skinning: 'gpu'/,
            ],
            [
                { skinning: 'gpu', renderMode: 'batched' },
                /skinning: 'gpu' has no effect, because renderMode is batched, and the batched mode places every vertex/,
            ],
            [
                { skinning: 'gpu' },
                /skinning: 'gpu' has no effect, because renderMode auto batches a skeleton of this size/,
            ],
            [
                { skinning: 'gpu', instancing: 'on', renderMode: 'batched' },
                /skinning: 'gpu' and instancing: 'on' have no effect, because renderMode is batched/,
            ],
        ])('%o', async (options, text) => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            asset = await fixtureAsset('4.2/spineboy-pro.skel');
            create(options);
            create(options);
            await warned();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0]?.[0])).toMatch(text);
        });

        it('says nothing where the options act, and where a preset or the default set them', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            asset = await fixtureAsset('4.2/spineboy-pro.skel');
            create();
            create({ perf: 'fast', instancing: 'off', skinning: 'cpu' });
            create({ skinning: 'gpu', instancing: 'auto', renderMode: 'mesh' });
            await warned();
            expect(warn).not.toHaveBeenCalled();
        });
    });

    describe('the setters and arguments', () => {
        it('throw for a time scale, a default mix and a mix that are no finite number', () => {
            const spine = create();

            for (const wrong of [Number.NaN, Number.POSITIVE_INFINITY, '2', undefined]) {
                expect(thrownBy(() => Reflect.set(spine, 'timeScale', wrong)).code).toBe('invalid-option');
                expect(thrownBy(() => Reflect.set(spine, 'defaultMix', wrong)).code).toBe('invalid-option');
                expect(thrownBy(() => Reflect.apply(spine.setMix, spine, ['walk', 'run', wrong])).code).toBe(
                    'invalid-option',
                );
            }
            expect(thrownBy(() => Reflect.set(spine, 'timeScale', Number.NaN)).message).toContain('timeScale got NaN.');
            expect(spine.timeScale).toBe(1);
            expect(spine.defaultMix).toBe(0);
            spine.timeScale = 2;
            spine.defaultMix = 0.25;
            expect([spine.engine.timeScale, spine.engine.defaultMix]).toEqual([2, 0.25]);
        });

        it('say that play and queue need a name, and what a slot can show', () => {
            const spine = create();
            const noName = thrownBy(() => Reflect.apply(spine.play, spine, []));
            const attachment = thrownBy(() => {
                spine.slot('gun').attachment = 'gunn';
            });

            expect(noName.code).toBe('invalid-option');
            expect(noName.message).toContain('The animation name is undefined. Pass the name as a string.');
            expect(thrownBy(() => Reflect.apply(spine.queue, spine, [null])).code).toBe('invalid-option');
            expect(attachment.code).toBe('unknown-name');
            expect(attachment.message).toContain(
                'The slot "gun" has no attachment "gunn". The closest name is "gun". Pass one of the attachment names:',
            );
        });

        it('warn once for a container that follows a bone and is no child a moment later', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const spine = create();
            const child = new Container();
            const late = new Container();
            const stray = new Container();

            spine.addChild(child);
            spine.follow('head', child);
            spine.follow('hip', late);
            spine.addChild(late);
            await warned();
            expect(warn).not.toHaveBeenCalled();
            spine.follow('gun', stray);
            spine.unfollow(stray);
            spine.follow('gun', stray);
            await warned();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0]?.[0])).toMatch(
                /follow\('gun', container\) got a container that is not a child of the display object/,
            );
        });
    });

    describe('the ticker option', () => {
        it('updates the object from the ticker of the app, with its speed, and leaves the shared one alone', () => {
            const ticker = new Ticker();
            const shared = vi.spyOn(Ticker.shared, 'add');

            ticker.autoStart = false;
            ticker.stop();
            const spine = create({ autoUpdate: true, ticker });
            const stage = new Container({ isRenderGroup: true });
            const walk = spine.play('walk', { loop: true });

            stage.addChild(spine);
            expect(spine.ticker).toBe(ticker);
            expect(shared).not.toHaveBeenCalled();
            expect(ticker.count).toBe(1);
            ticker.update(ticker.lastTime + 1000);
            const before = walk.time;

            ticker.speed = 0.5;
            ticker.update(ticker.lastTime + 20);
            expect(walk.time - before).toBeCloseTo(0.01, 9);
            spine.autoUpdate = false;
            expect(ticker.count).toBe(0);
            ticker.destroy();
        });

        it('is the shared ticker without the option', () => {
            expect(create().ticker).toBe(Ticker.shared);
        });
    });
});

describe.each(['4.2/sack-pro.skel', '4.3/sack-pro.skel'])(
    'the seconds of an update of %s, a skeleton with physics',
    (id) => {
        it('throw at once when they are no finite number, and nothing is posed', async () => {
            const spine = new MarrowSpine(await fixtureAsset(id), { autoUpdate: false });
            const update = vi.spyOn(spine.engine, 'update');

            spine.play('cape-follow-example', { loop: true });
            spine.update(FRAME);
            for (const wrong of [Number.POSITIVE_INFINITY, Number.NaN, 'long', undefined]) {
                const error = thrownBy(() => Reflect.apply(spine.update, spine, [wrong]));

                expect(error.code).toBe('invalid-option');
                expect(error.message).toContain('update seconds got');
            }
            expect(update).toHaveBeenCalledTimes(1);
            spine.destroy();
        });

        it('advance the animation by an hour and start the physics again, which runs none of that hour', async () => {
            const asset = await fixtureAsset(id);
            const spine = new MarrowSpine(asset, { autoUpdate: false });
            const modes: string[] = [];
            const update = spine.engine.update.bind(spine.engine);
            const loop = spine.play('cape-follow-example', { loop: true });
            // an engine without the display object runs every step of the hour
            const bare = bareEngine(asset);

            bare.setAnimation(0, animationIndex(asset.model, 'cape-follow-example'), true);
            bare.update(FRAME);
            spine.update(FRAME);
            vi.spyOn(spine.engine, 'update').mockImplementation((seconds) => {
                modes.push(spine.engine.physics);
                update(seconds);
            });
            const start = performance.now();

            spine.update(3600);
            spine.update(FRAME);
            const guarded = performance.now() - start;

            bare.update(3600);
            const unguarded = performance.now() - start - guarded;

            expect(guarded).toBeLessThan(unguarded / 4);
            expect(modes).toEqual(['reset', 'update']);
            expect(loop.time).toBeCloseTo(3600 + 2 * FRAME, 6);
            expect(spine.physics).toBe('update');
            expect([...spine.engine.state.world].every(Number.isFinite)).toBe(true);
            // ten seconds are no long update: the physics run them
            spine.update(10);
            expect(modes).toEqual(['reset', 'update', 'update']);
            spine.destroy();
        });

        it('leave the physics off that the game turned off', async () => {
            const spine = new MarrowSpine(await fixtureAsset(id), { autoUpdate: false });

            spine.physics = 'none';
            spine.update(3600);
            expect(spine.physics).toBe('none');
            expect(spine.engine.physics).toBe('none');
            spine.destroy();
        });
    },
);

describe('events that nobody listens for', () => {
    it('are not kept in an update, and still resolve finished', async () => {
        const asset = await fixtureAsset('4.2/spineboy-pro.skel');
        const spine = new MarrowSpine(asset, { autoUpdate: false });
        const { engine } = spine;
        const shoot = animationIndex(asset.model, 'shoot');
        const book = new TrackBook();
        const list = new EventList();
        const heard = new Set<string>();
        const sink = {
            destroyed: false,
            emit: () => true,
            listenerCount: (event: string) => (heard.has(event) ? 1 : 0),
        };
        const play = (): TrackHandle => {
            const handle = new TrackHandle(spine, engine.setAnimation(0, shoot, false), 'shoot', 1);

            book.add(handle);

            return handle;
        };
        const first = play();

        engine.update(2);
        book.absorb(engine.takeEvents(), list, undefined, sink);
        expect(list.types).toEqual([]);
        expect(await first.finished).toBe('complete');
        heard.add('complete');
        play();
        // the events of a command wait for the next update, where a listener may be there by then
        book.absorb(engine.takeEvents(), list);
        expect(list.types).toContain('start');
        list.clear();
        engine.update(2);
        book.absorb(engine.takeEvents(), list, undefined, sink);
        expect(list.types).toEqual(['complete']);
        spine.destroy();
    });
});
