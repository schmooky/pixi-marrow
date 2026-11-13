import { Point } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { Bone } from '../../src/api/bone';
import { Slot } from '../../src/api/slot';
import { createPoseEngine, importSkeleton, WORLD_STRIDE } from '../../src/core';
import { MarrowSpine } from '../../src/index';
import { listPoseRigs } from '../parity/pose-synthetic';
import { FRAME, fixtureAsset, VERSIONS } from './helpers';

/*
 * The slot handle against the pose a write reaches, which a 4.3 slider can change, the values a
 * game writes back unchanged in every frame, and the point conversion of a bone to the last bit
 * of the official formula of each version.
 */

async function sliderSlotsEngine() {
    const source = listPoseRigs().find((rig) => rig.id === '4.3/made-slider-slots.json');

    if (source === undefined) throw new Error('no rig made-slider-slots');
    const model = await importSkeleton(source.read().skeleton);

    return { model, engine: await createPoseEngine(model) };
}

describe('a slot that a 4.3 slider poses', () => {
    it('keeps the alpha of its pose when its tint is written, not the alpha the slider drew', async () => {
        const { model, engine } = await sliderSlotsEngine();
        // a slot and a moment where the slider draws another alpha than the pose of the slot holds
        let index = -1;

        for (let animation = 0; animation < model.animations.length && index < 0; animation++) {
            engine.setAnimation(0, animation, true);
            for (let frame = 0; frame < 40 && index < 0; frame++) {
                engine.update(FRAME * 3);
                for (let slot = 0; slot < model.slots.count && index < 0; slot++) {
                    if (engine.slotPose.colors[slot * 4 + 3] !== engine.state.colors[slot * 4 + 3]) index = slot;
                }
            }
        }
        expect(index, 'a slot whose drawn alpha differs from its pose').toBeGreaterThanOrEqual(0);
        engine.clearTracks();
        const at = index * 4 + 3;
        const slot = new Slot(engine, index, model.slots.names[index] ?? '');
        const posed = Number(engine.slotPose.colors[at]);

        for (let frame = 0; frame < 5; frame++) {
            slot.tint = 0xff0000;
            engine.update(FRAME);
        }
        expect(Number(engine.slotPose.colors[at])).toBe(posed);
        expect(slot.alpha).toBe(posed);
        expect(slot.tint).toBe(0xff0000);
    });
});

describe('writes of the value a slot has', () => {
    it('change neither the pose nor its version, so the skeleton rests', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/coin-pro.skel'), { autoUpdate: false });
        const side = spine.slot('coin-side');
        const shine = spine.slot('coin-front-shine');

        spine.update(FRAME);
        const { state } = spine.engine;
        const version = state.version;

        // what a game writes back in every frame: the values it read
        const [tint, alpha, attachment, dark, noDark] = [
            side.tint,
            side.alpha,
            side.attachment,
            shine.darkTint,
            side.darkTint,
        ];

        side.tint = tint;
        side.alpha = alpha;
        side.attachment = attachment;
        shine.darkTint = dark;
        // a slot without a dark color reads null and takes null back
        expect(noDark).toBeNull();
        side.darkTint = noDark;
        expect(state.version).toBe(version);
        spine.destroy();
    });

    it('take an empty name as none, as the official setAttachment does, and refuse null for a dark color that exists', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/coin-pro.skel'), { autoUpdate: false });
        const side = spine.slot('coin-side');

        side.attachment = '';
        expect(side.attachment).toBeNull();
        side.attachment = 'coin-side-straight';
        side.attachment = undefined as unknown as null;
        expect(side.attachment).toBeNull();
        expect(() => {
            spine.slot('coin-front-shine').darkTint = null;
        }).toThrow(/darkTint/);
        spine.destroy();
    });
});

describe.each(VERSIONS)('the point conversion of a bone of Spine %s', (version) => {
    it('gives the official numbers to the last bit', async () => {
        const asset = await fixtureAsset(`${version}/spineboy-pro.skel`);
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        spine.play('walk', { loop: true });
        spine.update(0.37);
        const { state } = spine.engine;
        const names = asset.model.bones.names;
        const points = [new Point(31.7, -12.3), new Point(-0.001, 250.5), new Point(1e4, 3)];

        names.forEach((name, index) => {
            const bone = new Bone(state, index, name);
            const w = state.world.subarray(index * WORLD_STRIDE, index * WORLD_STRIDE + 6);
            const [a = 0, b = 0, c = 0, d = 0, wx = 0, wy = 0] = w;

            for (const point of points) {
                const x = point.x - wx;
                const y = point.y - wy;
                const det = a * d - b * c;
                const inverse = 1 / det;
                // the official formula of each version
                const expected =
                    version === '4.3'
                        ? [(x * d - y * b) / det, (y * a - x * c) / det]
                        : [x * d * inverse - y * b * inverse, y * a * inverse - x * c * inverse];
                const local = bone.worldToLocal(point);

                expect([local.x, local.y]).toEqual(expected);
                const world = bone.localToWorld(point);

                expect([world.x, world.y]).toEqual([point.x * a + point.y * b + wx, point.x * c + point.y * d + wy]);
            }
        });
        spine.destroy();
    });
});
