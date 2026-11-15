import { Container, Ticker } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { viewOf } from '../../src/api/view-of';
import { type MarrowAsset, MarrowError, MarrowSpine, type TrackEnd } from '../../src/index';
import { FRAME, fixtureAsset, holdTicker, VERSIONS } from './helpers';

/*
 * The life of a display object, found in an audit: `await hero.play('win').finished` could hang
 * for ever after `destroy()` and on a hidden skeleton of the `pause` mode. `finished` says why
 * it resolved, and a destroyed object refuses every command.
 */

/** The reason a promise resolved with, or `pending` when it has not resolved by now. */
async function reasonOf(promise: Promise<TrackEnd>): Promise<TrackEnd | 'pending'> {
    return Promise.race([promise, Promise.resolve('pending' as const)]);
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

describe.each(VERSIONS)('the life of a display object of a Spine %s skeleton', (version) => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];

    function create(options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine {
        const spine = new MarrowSpine(asset, { autoUpdate: false, ...options });

        made.push(spine);

        return spine;
    }

    function steps(spine: MarrowSpine, count: number): void {
        for (let i = 0; i < count; i++) spine.update(FRAME);
    }

    beforeAll(async () => {
        asset = await fixtureAsset(`${version}/spineboy-pro.skel`);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    describe('Track.finished', () => {
        it('says complete for an animation that played to its end', async () => {
            const spine = create();
            const shoot = spine.play('shoot');

            steps(spine, 45);
            expect(await reasonOf(shoot.finished)).toBe('complete');
        });

        it('says interrupted for an animation that another one replaced, when its mix out ends', async () => {
            const spine = create();
            const walk = spine.play('walk', { loop: true });

            steps(spine, 5);
            const run = spine.play('run', { loop: true, mix: 0.1 });

            steps(spine, 3);
            expect(await reasonOf(walk.finished)).toBe('pending');
            steps(spine, 10);
            expect(await reasonOf(walk.finished)).toBe('interrupted');
            expect(await reasonOf(run.finished)).toBe('pending');
        });

        it('says interrupted for an animation that the queue replaced, and for one that never started', async () => {
            const spine = create();
            const idle = spine.play('idle', { loop: true });
            const next = spine.queue('walk', { loop: true, delay: 0.1, mix: 0 });
            const never = spine.queue('run', { loop: true, delay: 5 });

            steps(spine, 12);
            expect(await reasonOf(idle.finished)).toBe('interrupted');
            spine.play('jump');
            expect(await reasonOf(never.finished)).toBe('interrupted');
            steps(spine, 30);
            expect(await reasonOf(next.finished)).toBe('interrupted');
        });

        it('says complete for an animation that played to its end while it mixed out', async () => {
            const spine = create();
            const shoot = spine.play('shoot');

            steps(spine, 30);
            spine.play('idle', { loop: true, mix: 2 });
            steps(spine, 30);
            expect(await reasonOf(shoot.finished)).toBe('complete');
        });

        it('says stopped for a track that stop cleared, and for one it mixes out', async () => {
            const spine = create();
            const cleared = spine.play('walk', { loop: true });
            const queued = spine.queue('run', { loop: true });
            const mixed = spine.play('aim', { track: 1, loop: true });

            steps(spine, 3);
            spine.stop({ track: 0 });
            expect(await reasonOf(cleared.finished)).toBe('stopped');
            expect(await reasonOf(queued.finished)).toBe('stopped');
            mixed.stop({ mix: 0.1 });
            expect(await reasonOf(mixed.finished)).toBe('pending');
            steps(spine, 10);
            expect(await reasonOf(mixed.finished)).toBe('stopped');
        });

        it('says destroyed for every animation that was playing or queued when the object went', async () => {
            const spine = create();
            const done = spine.play('shoot', { track: 2 });

            steps(spine, 45);
            const playing = spine.play('walk', { loop: true });
            const queued = spine.queue('run', { loop: true });
            const late = spine.play('aim', { track: 1, loop: true });

            steps(spine, 2);
            spine.destroy();
            expect(await reasonOf(playing.finished)).toBe('destroyed');
            expect(await reasonOf(queued.finished)).toBe('destroyed');
            // first read after the end
            expect(await late.finished).toBe('destroyed');
            // the first reason stays
            expect(await done.finished).toBe('complete');
        });

        it('keeps the reason of an animation that was interrupted before the object went', async () => {
            const spine = create();
            const walk = spine.play('walk', { loop: true });

            steps(spine, 2);
            spine.play('run', { loop: true, mix: 1 });
            steps(spine, 2);
            spine.destroy();
            expect(await reasonOf(walk.finished)).toBe('interrupted');
        });
    });

    describe('after destroy()', () => {
        it('throws a MarrowError with the code destroyed for every command, and starts nothing', () => {
            const spine = create();
            const head = spine.bone('head');
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');
            const add = vi.spyOn(Ticker.shared, 'add');

            spine.destroy();
            const commands: (() => unknown)[] = [
                () => spine.play('walk'),
                () => spine.queue('walk'),
                () => spine.stop(),
                () => spine.stop({ mix: 0.2 }),
                () => spine.setMix('walk', 'run', 0.2),
                () => spine.bone('head'),
                () => spine.slot('gun'),
                () => spine.skin,
                () => Reflect.set(spine, 'skin', 'default'),
                () => spine.skins,
                () => Reflect.set(spine, 'skins', []),
                () => spine.setupPose(),
                () => spine.follow('head', new Container()),
                () => spine.attach('gun', new Container()),
                () => Reflect.set(spine, 'autoUpdate', true),
            ];

            for (const command of commands) {
                const error = thrownBy(command);

                expect(error.code).toBe('destroyed');
                expect(error.message).toContain('The display object was destroyed.');
            }
            expect(setAnimation).not.toHaveBeenCalled();
            expect(add).not.toHaveBeenCalled();
            expect(spine.autoUpdate).toBe(false);
            // a handle from before still reads and writes the pose that nothing draws
            expect(() => {
                head.rotation += 1;
            }).not.toThrow();
        });

        it('does nothing in update, destroy, unfollow and detach', () => {
            const spine = create();
            const update = vi.spyOn(spine.engine, 'update');

            spine.destroy();
            expect(() => {
                spine.update(FRAME);
                spine.destroy();
                spine.unfollow(new Container());
                spine.detach(new Container());
                Reflect.set(spine, 'autoUpdate', false);
            }).not.toThrow();
            expect(update).not.toHaveBeenCalled();
        });

        it('refuses a new object of a destroyed asset with the code destroyed', async () => {
            const gone = await fixtureAsset(`${version}/spineboy-pro.skel`);

            gone.destroy();
            expect(thrownBy(() => new MarrowSpine(gone, { autoUpdate: false })).code).toBe('destroyed');
        });
    });

    describe('a hidden skeleton of the pause mode', () => {
        /** A skeleton on a stage that a render reached, hidden or shown. */
        function staged(hidden: boolean): { spine: MarrowSpine; stage: Container } {
            const spine = create({ offscreen: 'pause' });
            const stage = new Container({ isRenderGroup: true });

            stage.addChild(spine);
            spine.position.set(400, 500);
            spine.visible = !hidden;
            rendered(spine);

            return { spine, stage };
        }

        /** Tells a display object that a render reached it, as Pixi does through the child that watches. */
        function rendered(spine: MarrowSpine): void {
            const watch = spine.children.find((child) => child.label === 'marrow-pacing');

            if (watch?.onRender == null) throw new Error('no child watches the renders');
            watch.onRender({ screen: { x: 0, y: 0, width: 800, height: 600 } } as never);
        }

        it('resolves finished and fires its events on time, and poses nothing', async () => {
            const { spine } = staged(true);
            const shown = staged(false).spine;
            const update = vi.spyOn(spine.engine, 'update');
            const heard: string[] = [];
            const expected: string[] = [];

            for (const type of ['start', 'complete', 'end', 'event'] as const) {
                spine.on(type, () => heard.push(type));
                shown.on(type, () => expected.push(type));
            }
            const win = spine.play('portal');
            const same = shown.play('portal');

            for (let i = 0; i < 200; i++) {
                rendered(spine);
                rendered(shown);
                spine.update(FRAME);
                shown.update(FRAME);
                expect(heard).toEqual(expected);
                expect(win.time).toBeCloseTo(same.time, 12);
            }
            expect(await reasonOf(win.finished)).toBe('complete');
            expect(heard).toContain('complete');
            // one animation that plays alone is not posed while nothing draws it
            expect(update).not.toHaveBeenCalled();
        });

        it('keeps several tracks on time too, which the engine poses', async () => {
            const { spine } = staged(true);
            const walk = spine.play('walk');
            const aim = spine.play('aim', { track: 1 });
            const draws = spine.stats.positionUploads;

            steps(spine, 120);
            expect(spine.stats.positionUploads).toBe(draws);
            expect(await reasonOf(walk.finished)).toBe('complete');
            expect(await reasonOf(aim.finished)).toBe('complete');
        });

        it('shows the pose of the time that passed in the render that shows it again', () => {
            const { spine } = staged(true);
            const { spine: shown } = staged(false);
            const world = (hero: MarrowSpine): number[] => [...hero.engine.state.world];

            spine.play('walk', { loop: true });
            shown.play('walk', { loop: true });
            for (let i = 0; i < 40; i++) {
                rendered(spine);
                rendered(shown);
                spine.update(FRAME);
                shown.update(FRAME);
            }
            expect(world(spine)).not.toEqual(world(shown));
            spine.visible = true;
            rendered(spine);
            // posed by the render, at the time the tracks are at
            for (const [i, value] of world(shown).entries()) expect(world(spine)[i]).toBeCloseTo(value, 9);
            expect(spine.stats.vertices).toBeGreaterThan(0);
        });

        it('does nothing at all without an animation', () => {
            const { spine } = staged(true);
            const update = vi.spyOn(spine.engine, 'update');
            const advance = vi.spyOn(spine.engine, 'advance');

            steps(spine, 10);
            expect(update).not.toHaveBeenCalled();
            expect(advance).not.toHaveBeenCalled();
        });
    });
});

describe('an update from the ticker of an object that Pixi does not draw', () => {
    let asset: MarrowAsset;
    let ticker: Ticker;
    let now = 0;
    const made: MarrowSpine[] = [];

    function tick(milliseconds = 1000 / 60): void {
        now += milliseconds;
        ticker.update(now);
    }

    function create(): { spine: MarrowSpine; stage: Container } {
        const spine = new MarrowSpine(asset);
        const stage = new Container({ isRenderGroup: true });

        made.push(spine);
        stage.addChild(spine);

        return { spine, stage };
    }

    /** What Pixi does at the start of a render: it calls the children that listen. */
    function render(spine: MarrowSpine): void {
        for (const child of spine.children)
            child.onRender?.({ screen: { x: 0, y: 0, width: 800, height: 600 } } as never);
    }

    beforeAll(async () => {
        asset = await fixtureAsset('4.2/spineboy-pro.skel');
        ticker = holdTicker();
        now = ticker.lastTime + 1000;
        ticker.update(now);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    it.each([
        ['visible false', (spine: MarrowSpine) => Reflect.set(spine, 'visible', false)],
        ['renderable false', (spine: MarrowSpine) => Reflect.set(spine, 'renderable', false)],
        ['an alpha of 0', (spine: MarrowSpine) => Reflect.set(spine, 'alpha', 0)],
        ['a hidden parent', (spine: MarrowSpine) => Reflect.set(spine.parent ?? spine, 'visible', false)],
        ['no parent', (spine: MarrowSpine) => spine.removeFromParent()],
    ])('poses and draws nothing with %s, and keeps the track, the events and finished on time', async (_, hide) => {
        const { spine } = create();
        const update = vi.spyOn(spine.engine, 'update');
        const completed = vi.fn();
        const shoot = spine.play('shoot');

        spine.on('complete', completed);
        tick();
        expect(update).toHaveBeenCalledTimes(1);
        hide(spine);
        const view = viewOf(spine);

        if (view === undefined) throw new Error('the object has a view');
        const draw = vi.spyOn(view, 'update');

        for (let i = 0; i < 60; i++) tick();
        expect(update).toHaveBeenCalledTimes(1);
        expect(draw).not.toHaveBeenCalled();
        expect(shoot.time).toBeCloseTo(61 / 60, 9);
        expect(completed).toHaveBeenCalledExactlyOnceWith(shoot);
        expect(await shoot.finished).toBe('complete');
    });

    it('poses a shown object in every tick, and one that is shown again in its next tick', () => {
        const { spine } = create();
        const update = vi.spyOn(spine.engine, 'update');

        spine.play('walk', { loop: true });
        for (let i = 0; i < 5; i++) tick();
        expect(update).toHaveBeenCalledTimes(5);
        spine.visible = false;
        for (let i = 0; i < 5; i++) tick();
        expect(update).toHaveBeenCalledTimes(5);
        spine.visible = true;
        tick();
        expect(update).toHaveBeenCalledTimes(6);
    });

    it('poses in the render that shows the object again, when that comes before the next tick', () => {
        const { spine, stage } = create();
        const shown = create().spine;
        const world = (hero: MarrowSpine): number[] => [...hero.engine.state.world];

        spine.play('walk', { loop: true });
        shown.play('walk', { loop: true });
        stage.visible = false;
        for (let i = 0; i < 30; i++) tick();
        expect(world(spine)).not.toEqual(world(shown));
        // still hidden: a render changes nothing
        render(spine);
        expect(world(spine)).not.toEqual(world(shown));
        stage.visible = true;
        render(spine);
        for (const [i, value] of world(shown).entries()) expect(world(spine)[i]).toBeCloseTo(value, 9);
    });

    it('starts the physics again when the object shows, so that they do not run the hidden time', async () => {
        const sack = new MarrowSpine(await fixtureAsset('4.2/sack-pro.skel'));
        const stage = new Container({ isRenderGroup: true });
        const modes: string[] = [];

        made.push(sack);
        stage.addChild(sack);
        sack.play('cape-follow-example', { loop: true });
        tick();
        sack.visible = false;
        for (let i = 0; i < 10; i++) tick();
        sack.visible = true;
        const update = sack.engine.update.bind(sack.engine);

        vi.spyOn(sack.engine, 'update').mockImplementation((seconds) => {
            modes.push(sack.engine.physics);
            update(seconds);
        });
        tick();
        tick();
        expect(modes).toEqual(['reset', 'update']);
        expect(sack.physics).toBe('update');
    });

    it('always poses in an update the game calls itself', () => {
        const spine = new MarrowSpine(asset, { autoUpdate: false });
        const update = vi.spyOn(spine.engine, 'update');

        made.push(spine);
        spine.visible = false;
        spine.play('walk', { loop: true });
        spine.update(FRAME);
        expect(update).toHaveBeenCalledTimes(1);
    });
});
