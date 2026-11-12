import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PhysicsMode, PoseEngine } from '../../src/core';
import { type MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { bareEngine, FRAME, fixtureAsset } from './helpers';

/*
 * The physics calls of the display object, as the pose engine sees them. What the physics does
 * to a pose is the business of the parity suite.
 */

/** Records the physics mode of every update of an engine. */
function recordModes(engine: PoseEngine): PhysicsMode[] {
    const modes: PhysicsMode[] = [];
    const update = engine.update.bind(engine);

    vi.spyOn(engine, 'update').mockImplementation((seconds) => {
        modes.push(engine.physics);
        update(seconds);
    });

    return modes;
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

describe.each([
    ['4.2/sack-pro.skel', 'physics'],
    ['4.3/owl-pro.skel', 'physics'],
    ['4.1/owl-pro.skel', 'no physics'],
])('the physics control of %s, a skeleton with %s', (id, kind) => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];

    function create(): MarrowSpine {
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    beforeAll(async () => {
        asset = await fixtureAsset(id);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    it('is the rig the test means', () => {
        expect(asset.info.features.includes('physics')).toBe(kind === 'physics');
    });

    describe('physics', () => {
        it('is update until it is set, and forwards to the engine', () => {
            const spine = create();

            expect(spine.physics).toBe('update');
            expect(spine.engine.physics).toBe('update');
            for (const mode of ['none', 'pose', 'reset', 'update'] as const) {
                spine.physics = mode;
                expect(spine.physics).toBe(mode);
                expect(spine.engine.physics).toBe(mode);
            }
        });

        it('stays for every update until it is set again', () => {
            const spine = create();
            const modes = recordModes(spine.engine);

            spine.physics = 'pose';
            spine.update(FRAME);
            spine.update(FRAME);
            spine.physics = 'none';
            spine.update(FRAME);

            expect(modes).toEqual(['pose', 'pose', 'none']);
        });

        it('throws for a value that is no mode, with the modes and the closest one', () => {
            const spine = create();
            const error = thrownBy(() => Reflect.set(spine, 'physics', 'updat'));

            expect(error.code).toBe('invalid-data');
            expect(error.message).toContain('"updat" is not a physics mode.');
            expect(error.validNames).toEqual(['none', 'reset', 'update', 'pose']);
            expect(error.closest).toBe('update');
            expect(error.fix).toBe('Set one of: none, reset, update, pose.');
            expect(spine.physics).toBe('update');
            expect(thrownBy(() => Reflect.set(spine, 'physics', undefined)).code).toBe('invalid-data');
        });
    });

    describe('the first update', () => {
        it('runs in mode update, as in the official Pixi runtime, which never resets on its own', () => {
            const modes: PhysicsMode[] = [];
            const axes: { scaleY: number; yDown: boolean }[] = [];
            const createEngine = asset.createEngine;

            vi.spyOn(asset, 'createEngine').mockImplementation(() => {
                const engine = createEngine();
                const update = engine.update.bind(engine);

                engine.update = (seconds) => {
                    modes.push(engine.physics);
                    axes.push({ scaleY: engine.state.scaleY, yDown: engine.state.yDown });
                    update(seconds);
                };

                return engine;
            });
            const spine = create();

            // the update of the constructor shows the setup pose and leaves the physics out
            expect(modes).toEqual(['none']);
            expect(spine.physics).toBe('update');
            spine.update(FRAME);
            expect(modes).toEqual(['none', 'update']);
            // the y axis points down from the first update on
            expect(axes).toEqual(Array(2).fill({ scaleY: -1, yDown: true }));
        });
    });

    describe('the y axis', () => {
        it('points down in a new display object: the pose is flipped and physics is told so', () => {
            const spine = create();
            const bare = asset.createEngine();

            expect(spine.engine.state.scaleY).toBe(-1);
            expect(spine.engine.state.yDown).toBe(true);
            // an engine on its own keeps the y axis of Spine
            expect(bare.state.scaleY).toBe(1);
            expect(bare.state.yDown).toBe(false);
            expect(bareEngine(asset).state).toMatchObject({ scaleY: -1, yDown: true });
        });
    });

    describe('resetPhysics', () => {
        it('runs the next update in mode reset, then the mode before it returns', () => {
            const spine = create();
            const modes = recordModes(spine.engine);

            spine.update(FRAME);
            spine.resetPhysics();
            expect(spine.physics).toBe('update');
            spine.update(FRAME);
            expect(spine.engine.physics).toBe('update');
            spine.update(FRAME);

            expect(modes).toEqual(['update', 'reset', 'update']);
        });

        it('resets once when it is called twice before an update', () => {
            const spine = create();
            const modes = recordModes(spine.engine);

            spine.physics = 'pose';
            spine.resetPhysics();
            spine.resetPhysics();
            spine.update(FRAME);
            spine.update(FRAME);

            expect(modes).toEqual(['reset', 'pose']);
            expect(spine.physics).toBe('pose');
        });

        it('returns to a mode that was set while the reset waited for its update', () => {
            const spine = create();
            const modes = recordModes(spine.engine);

            spine.resetPhysics();
            spine.physics = 'none';
            expect(spine.physics).toBe('none');
            spine.update(FRAME);
            spine.update(FRAME);

            expect(modes).toEqual(['reset', 'none']);
        });

        it('resets in every update when the mode itself is reset', () => {
            const spine = create();
            const modes = recordModes(spine.engine);

            spine.physics = 'reset';
            spine.resetPhysics();
            spine.update(FRAME);
            spine.update(FRAME);

            expect(modes).toEqual(['reset', 'reset']);
        });

        it('ends after an update that a probe measures', () => {
            const spine = create();
            const modes = recordModes(spine.engine);

            spine.updateProbe = { record: () => undefined };
            spine.resetPhysics();
            spine.update(FRAME);
            spine.update(FRAME);

            expect(modes).toEqual(['reset', 'update']);
        });
    });

    describe('physicsTranslate and physicsRotate', () => {
        it('reach the engine with their arguments', () => {
            const spine = create();
            const translate = vi.spyOn(spine.engine, 'physicsTranslate');
            const rotate = vi.spyOn(spine.engine, 'physicsRotate');

            spine.physicsTranslate(12, -3.5);
            spine.physicsRotate(40, 20, 15);

            expect(translate).toHaveBeenCalledExactlyOnceWith(12, -3.5);
            expect(rotate).toHaveBeenCalledExactlyOnceWith(40, 20, 15);
        });

        it('throw for an argument that is no finite number, and the engine is not called', () => {
            const spine = create();
            const translate = vi.spyOn(spine.engine, 'physicsTranslate');
            const rotate = vi.spyOn(spine.engine, 'physicsRotate');
            const errors = [
                thrownBy(() => spine.physicsTranslate(Number.NaN, 0)),
                thrownBy(() => Reflect.apply(spine.physicsTranslate, spine, [0, '4'])),
                thrownBy(() => spine.physicsRotate(0, 0, Number.POSITIVE_INFINITY)),
                thrownBy(() => Reflect.apply(spine.physicsRotate, spine, [undefined, 0, 1])),
                thrownBy(() => spine.physicsRotate(0, Number.NaN, 1)),
            ];

            expect(errors.map((error) => error.code)).toEqual(Array(5).fill('invalid-data'));
            expect(errors.map((error) => error.message.split('] ')[1])).toEqual([
                'physicsTranslate got NaN for x. Pass a finite number.',
                'physicsTranslate got 4 for y. Pass a finite number.',
                'physicsRotate got Infinity for degrees. Pass a finite number.',
                'physicsRotate got undefined for x. Pass a finite number.',
                'physicsRotate got NaN for y. Pass a finite number.',
            ]);
            expect(translate).not.toHaveBeenCalled();
            expect(rotate).not.toHaveBeenCalled();
        });

        it('are not called when the Pixi position or rotation of the object changes', () => {
            const spine = create();
            const translate = vi.spyOn(spine.engine, 'physicsTranslate');
            const rotate = vi.spyOn(spine.engine, 'physicsRotate');

            spine.update(FRAME);
            spine.position.set(300, 120);
            spine.rotation = 1;
            spine.scale.set(2);
            spine.update(FRAME);
            spine.update(FRAME);

            expect(translate).not.toHaveBeenCalled();
            expect(rotate).not.toHaveBeenCalled();
        });
    });
});
