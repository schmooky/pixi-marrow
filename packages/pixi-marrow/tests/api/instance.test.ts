import { Container, Texture } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { describeSkeleton } from '../../src/core';
import { type MarrowAsset, MarrowError, type MarrowNames, MarrowSpine } from '../../src/index';
import { generateNames } from '../../src/optimize/typegen';
import { SkeletonView } from '../../src/render/skeleton-view';
import { animationIndex, bareEngine, FRAME, fixtureAsset, poseOf, VERSIONS } from './helpers';

/** What a call is expected to throw. */
function thrownBy(call: () => unknown): MarrowError {
    try {
        call();
    } catch (error) {
        if (error instanceof MarrowError) return error;
        throw error;
    }
    throw new Error('the call did not throw');
}

describe.each(VERSIONS)('MarrowSpine of a Spine %s skeleton', (version) => {
    let asset: MarrowAsset;
    let goblins: MarrowAsset;
    const made: MarrowSpine[] = [];

    function create(from: MarrowAsset = asset): MarrowSpine {
        const spine = new MarrowSpine(from, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    beforeAll(async () => {
        asset = await fixtureAsset(`${version}/spineboy-pro.skel`);
        goblins = await fixtureAsset(`${version}/goblins-pro.skel`);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    describe('skin', () => {
        it('is null until one is set', () => {
            expect(create(goblins).skin).toBeNull();
        });

        it('makes a skin active and resets the slots, like the engine calls do', () => {
            const spine = create(goblins);
            const bare = bareEngine(goblins);
            const setupPoseSlots = vi.spyOn(spine.engine, 'setupPoseSlots');

            spine.play('walk', { loop: true });
            bare.setAnimation(0, 0, true);
            spine.update(0.3);
            bare.update(0.3);
            spine.skin = 'goblingirl';
            bare.setSkin(2);
            bare.setupPoseSlots();
            spine.update(0.3);
            bare.update(0.3);

            expect(spine.skin).toBe('goblingirl');
            expect(spine.engine.state.skin).toBe(2);
            expect(setupPoseSlots).toHaveBeenCalledOnce();
            expect(poseOf(spine.engine)).toEqual(poseOf(bare));
        });

        it('takes null for no skin', () => {
            const spine = create(goblins);

            spine.skin = 'goblin';
            spine.skin = null;

            expect(spine.skin).toBeNull();
            expect(spine.engine.state.skin).toBe(-1);
        });

        it('throws for a skin the skeleton lacks, with the valid names and the closest one', () => {
            const spine = create(goblins);
            const setSkin = vi.spyOn(spine.engine, 'setSkin');
            const error = thrownBy(() => {
                spine.skin = 'gobiln';
            });

            expect(error.code).toBe('unknown-name');
            expect(error.validNames).toEqual(['default', 'goblin', 'goblingirl']);
            expect(error.closest).toBe('goblin');
            expect(error.message).toContain('The skeleton has no skin "gobiln". The closest name is "goblin".');
            expect(setSkin).not.toHaveBeenCalled();
            expect(spine.skin).toBeNull();
        });
    });

    describe('names', () => {
        it('throws for an animation the skeleton lacks, with the valid names and the closest one', () => {
            const spine = create();
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');
            const error = thrownBy(() => spine.play('wlak'));

            expect(error.code).toBe('unknown-name');
            expect(error.validNames).toEqual(asset.info.animations.map((animation) => animation.name));
            expect(error.closest).toBe('walk');
            expect(error.message).toContain('The skeleton has no animation "wlak". The closest name is "walk".');
            expect(setAnimation).not.toHaveBeenCalled();
        });

        it('throws a MarrowError for a name that is no string, as untyped code can pass', () => {
            const spine = create();
            const names: unknown[] = [undefined, 7];
            const errors = names.map((name) => thrownBy(() => Reflect.apply(spine.play, spine, [name])));

            expect(errors.map((error) => error.code)).toEqual(['unknown-name', 'unknown-name']);
            expect(errors[0]?.message).toContain('The skeleton has no animation "undefined".');
        });

        it('throws for an option of the wrong type before anything plays', () => {
            const spine = create();
            const started = vi.fn();
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');
            const speed: unknown = 'fast';

            spine.on('start', started);
            const error = thrownBy(() => Reflect.apply(spine.play, spine, ['walk', { speed }]));
            spine.update(FRAME);

            expect(error.code).toBe('invalid-data');
            expect(error.message).toContain('The option "speed" was set to "fast".');
            expect(error.fix).toBe('Pass a finite number.');
            expect(setAnimation).not.toHaveBeenCalled();
            expect(started).not.toHaveBeenCalled();
        });

        it('plays the animation and keeps its track when the engine refuses a field of the option entry', () => {
            const spine = create();
            const started = vi.fn();

            spine.on('start', started);
            const error = thrownBy(() => spine.play('walk', { speed: 2, entry: { trackEnd: 'never' } }));
            spine.update(FRAME);

            expect(error.code).toBe('invalid-data');
            expect(started).toHaveBeenCalledOnce();
            expect(started.mock.calls[0]?.[0]).toMatchObject({ animation: 'walk', speed: 2 });
        });

        it('checks the names of queue and setMix the same way', () => {
            const spine = create();

            expect(thrownBy(() => spine.queue('Run-To-Idel')).closest).toBe('run-to-idle');
            expect(thrownBy(() => spine.setMix('walk', 'runn', 0.2)).closest).toBe('run');
            expect(thrownBy(() => spine.setMix('idel', 'run', 0.2)).closest).toBe('idle');
        });

        it('accepts the type that typegen writes', () => {
            const source = generateNames(describeSkeleton(asset.model), { typeName: 'BoyNames' });
            // the same shape as the generated type, cut down to what this test plays
            type BoyNames = {
                animations: 'walk' | 'run';
                skins: 'default';
                bones: 'root';
                slots: 'gun';
                events: 'footstep';
            };
            const typed: MarrowSpine<BoyNames> = new MarrowSpine<BoyNames>(asset, { autoUpdate: false });
            const names: MarrowNames = {
                animations: 'walk',
                skins: 'default',
                bones: 'root',
                slots: 'gun',
                events: 'footstep',
            };

            made.push(typed);
            // @ts-expect-error a name that is not in the type does not compile
            expect(() => typed.play('wlak')).toThrow(MarrowError);
            expect(typed.play('walk').animation).toBe('walk');
            expect(source).toContain('export type BoyNames = {');
            for (const key of Object.keys(names)) expect(source).toContain(`    ${key}: `);
        });
    });

    describe('mixing and speed', () => {
        it('reads and sets the time scale and the default mix of the engine', () => {
            const spine = create();

            spine.timeScale = 0.5;
            spine.defaultMix = 0.2;

            expect([spine.engine.timeScale, spine.engine.defaultMix]).toEqual([0.5, 0.2]);
            expect([spine.timeScale, spine.defaultMix]).toEqual([0.5, 0.2]);
        });

        it('sets a mix between two animations by name', () => {
            const spine = create();
            const setMix = vi.spyOn(spine.engine, 'setMix');
            const setAnimation = vi.spyOn(spine.engine, 'setAnimation');

            spine.setMix('walk', 'run', 0.35);
            spine.play('walk');
            spine.update(FRAME);
            spine.play('run');

            expect(setMix).toHaveBeenCalledExactlyOnceWith(
                animationIndex(asset.model, 'walk'),
                animationIndex(asset.model, 'run'),
                0.35,
            );
            expect(setAnimation.mock.results[1]?.value).toMatchObject({ mixDuration: 0.35 });
        });
    });

    describe('update', () => {
        it('poses with the y axis pointing down, as Pixi draws and as the official Pixi runtime poses', () => {
            const spine = create();
            const upright = asset.createEngine();

            upright.update(0);

            expect([spine.engine.state.scaleX, spine.engine.state.scaleY]).toEqual([1, -1]);
            // the second bone, the hip: its worldY (index 11) is mirrored
            expect(upright.state.world[11]).toBeGreaterThan(0);
            expect(Number(spine.engine.state.world[11]) + Number(upright.state.world[11])).toBe(0);
            expect(spine.engine.state.world[10]).toBe(upright.state.world[10]);
        });

        it('shows the setup pose from the start', () => {
            const update = vi.spyOn(SkeletonView.prototype, 'update');
            const spine = create();
            const bare = bareEngine(asset);

            bare.update(0);

            expect(update).toHaveBeenCalledExactlyOnceWith(spine.engine.state);
            expect(poseOf(spine.engine)).toEqual(poseOf(bare));
        });

        it('advances the engine, then updates the view, then emits the events', () => {
            const spine = create();
            const engineUpdate = vi.spyOn(spine.engine, 'update');
            const viewUpdate = vi.spyOn(SkeletonView.prototype, 'update');
            const started = vi.fn();
            const order = (mock: { mock: { invocationCallOrder: number[] } }): number[] =>
                mock.mock.invocationCallOrder;

            spine.on('start', started);
            spine.play('walk');
            expect(started).not.toHaveBeenCalled();
            spine.update(FRAME);

            expect(engineUpdate).toHaveBeenCalledExactlyOnceWith(FRAME);
            expect(viewUpdate).toHaveBeenCalledExactlyOnceWith(spine.engine.state);
            expect(started).toHaveBeenCalledOnce();
            expect([...order(engineUpdate), ...order(viewUpdate), ...order(started)]).toEqual(
                [...order(engineUpdate), ...order(viewUpdate), ...order(started)].sort((a, b) => a - b),
            );
        });
    });

    describe('what it holds', () => {
        it('is a Pixi container that holds the view', () => {
            const spine = create();
            const parent = new Container();

            parent.addChild(spine);

            expect(spine).toBeInstanceOf(Container);
            expect(spine.parent).toBe(parent);
            expect(spine.children).toHaveLength(1);
        });

        it('exposes the asset, the info, the stats of the view and the engine', () => {
            const spine = create();

            expect(spine.asset).toBe(asset);
            expect(spine.info).toBe(asset.info);
            expect(spine.info).toEqual(describeSkeleton(asset.model));
            expect(spine.engine.state.model).toBe(asset.model);
            expect(typeof spine.stats.drawCalls).toBe('number');
        });

        it('shares one asset between instances that pose on their own', () => {
            const first = create();
            const second = create();

            first.play('walk', { loop: true });
            second.play('run', { loop: true });
            first.update(0.3);
            second.update(0.1);

            expect(first.asset).toBe(second.asset);
            expect(first.engine).not.toBe(second.engine);
            expect(first.engine.state.model).toBe(second.engine.state.model);
            expect(first.engine.state.local).not.toBe(second.engine.state.local);
            expect(poseOf(first.engine).local).not.toEqual(poseOf(second.engine).local);
        });
    });

    describe('destroy', () => {
        it('destroys the view and the container, and leaves the shared asset', () => {
            const viewDestroy = vi.spyOn(SkeletonView.prototype, 'destroy');
            const textureDestroy = vi.spyOn(Texture.WHITE, 'destroy');
            const spine = new MarrowSpine(asset, { autoUpdate: false });
            const other = create();
            const parent = new Container();

            parent.addChild(spine);
            spine.destroy({ children: true, texture: true });

            expect(viewDestroy).toHaveBeenCalledOnce();
            expect(spine.destroyed).toBe(true);
            expect(parent.children).toHaveLength(0);
            expect(textureDestroy).not.toHaveBeenCalled();
            expect(asset.destroyed).toBe(false);
            expect(() => other.play('walk')).not.toThrow();
        });

        it('does nothing the second time, and update does nothing after it', () => {
            const viewDestroy = vi.spyOn(SkeletonView.prototype, 'destroy');
            const spine = new MarrowSpine(asset, { autoUpdate: false });
            const update = vi.spyOn(spine.engine, 'update');

            spine.play('walk');
            spine.destroy();
            spine.destroy();
            spine.update(FRAME);

            expect(viewDestroy).toHaveBeenCalledOnce();
            expect(update).not.toHaveBeenCalled();
        });
    });
});
