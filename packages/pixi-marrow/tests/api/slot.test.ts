import { Point } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { type MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { FRAME, fixtureAsset } from './helpers';

/*
 * The handle of a slot, several skins at once, the setup pose and the point conversion of a bone
 * on the display object. That each of them poses like the official runtime is the parity suite's
 * job, see the family "slots and skins". These tests are about the names, the values and the
 * errors of the display object.
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

/** The own name of the attachment a slot shows, which can differ from the name its skin stores it under. */
function shownName(spine: MarrowSpine, slot: string): string | undefined {
    const index = spine.asset.model.slots.names.indexOf(slot);

    return spine.engine.state.attachments[index]?.name;
}

describe.each(['4.2', '4.3'])('a display object of Spine %s', (version) => {
    let mix: MarrowAsset;
    let coin: MarrowAsset;

    beforeAll(async () => {
        mix = await fixtureAsset(`${version}/mix-and-match-pro.skel`);
        coin = await fixtureAsset(`${version}/coin-pro.skel`);
    });

    describe('with several skins', () => {
        it('shows the attachment of the later skin where two skins store one name', () => {
            const spine = new MarrowSpine(mix, { autoUpdate: false });

            spine.skins = ['skin-base', 'full-skins/boy'];
            expect(spine.skins).toEqual(['skin-base', 'full-skins/boy']);
            // several skins are not one skin
            expect(spine.skin).toBeNull();
            expect(shownName(spine, 'arm-back')).toBe('boy/arm-front');
            spine.skins = ['full-skins/boy', 'skin-base'];
            expect(shownName(spine, 'arm-back')).toBe('girl-spring-dress/arm-front');
            // the name a skin stores it under, which the setter takes back
            expect(spine.slot('arm-back').attachment).toBe('arm-back');
            spine.destroy();
        });

        it('turns one skin, no skin and the skin setter into the same thing', () => {
            const spine = new MarrowSpine(mix, { autoUpdate: false });

            spine.skins = ['full-skins/girl'];
            expect(spine.skin).toBe('full-skins/girl');
            spine.skin = 'skin-base';
            expect(spine.skins).toEqual(['skin-base']);
            spine.skins = [];
            expect(spine.skin).toBeNull();
            expect(spine.skins).toEqual([]);
            spine.skin = null;
            expect(spine.skins).toEqual([]);
            spine.destroy();
        });

        it('shares the combined skin of a list between the instances of an asset', () => {
            const one = new MarrowSpine(mix, { autoUpdate: false });
            const two = new MarrowSpine(mix, { autoUpdate: false });

            one.skins = ['skin-base', 'hair/pink', 'eyes/violet'];
            two.skins = ['skin-base', 'hair/pink', 'eyes/violet'];
            expect(two.engine.state.skin).toBe(one.engine.state.skin);
            two.skins = ['skin-base', 'eyes/violet', 'hair/pink'];
            expect(two.engine.state.skin).not.toBe(one.engine.state.skin);
            one.destroy();
            two.destroy();
        });

        it('throws for a skin it does not have, and for a list that is not one', () => {
            const spine = new MarrowSpine(mix, { autoUpdate: false });
            const error = thrownBy(() => {
                spine.skins = ['skin-base', 'hair/pinkk'];
            });

            expect(error.code).toBe('unknown-name');
            expect(error.closest).toBe('hair/pink');
            expect(
                thrownBy(() => {
                    spine.skins = 'skin-base' as unknown as string[];
                }).message,
            ).toMatch(/list of skin names/);
            spine.destroy();
        });
    });

    describe('with a slot handle', () => {
        it('hands out one handle per slot, with the name of its bone', () => {
            const spine = new MarrowSpine(mix, { autoUpdate: false });
            const handle = spine.slot('arm-back');

            expect(spine.slot('arm-back')).toBe(handle);
            expect(handle.name).toBe('arm-back');
            expect(spine.asset.model.bones.names).toContain(handle.bone);
            expect(thrownBy(() => spine.slot('arm-bak')).closest).toBe('arm-back');
            spine.destroy();
        });

        it('shows an attachment by the name the skins store it under, or none', () => {
            const spine = new MarrowSpine(mix, { autoUpdate: false });
            const eye = spine.slot('eye-front-iris');

            spine.skins = ['skin-base', 'eyes/violet', 'eyelids/girly'];
            const before = eye.attachment;

            expect(before).not.toBeNull();
            eye.attachment = null;
            expect(eye.attachment).toBeNull();
            eye.attachment = before;
            expect(eye.attachment).toBe(before);
            const error = thrownBy(() => {
                eye.attachment = 'no-such-eye';
            });

            expect(error.code).toBe('unknown-name');
            expect(error.validNames).toContain(before);
            // a new skin list puts the slots into their setup pose
            eye.attachment = null;
            spine.skins = ['skin-base', 'eyes/violet'];
            expect(eye.attachment).not.toBeNull();
            spine.destroy();
        });

        it('reads and writes the color as a tint and an alpha, clamped as the official color is', () => {
            const spine = new MarrowSpine(coin, { autoUpdate: false });
            const side = spine.slot('coin-side');

            side.tint = 0xff8040;
            expect(side.tint).toBe(0xff8040);
            expect(side.alpha).toBe(1);
            side.alpha = 0.25;
            expect(side.alpha).toBe(0.25);
            expect(side.tint).toBe(0xff8040);
            side.alpha = 3;
            expect(side.alpha).toBe(1);
            expect(thrownBy(() => (side.alpha = Number.NaN)).message).toMatch(/alpha/);
            spine.destroy();
        });

        it('has a dark color only where the slot has tint black', () => {
            const spine = new MarrowSpine(coin, { autoUpdate: false });
            const shine = spine.slot('coin-front-shine');

            expect(spine.slot('coin-side').darkTint).toBeNull();
            expect(
                thrownBy(() => {
                    spine.slot('coin-side').darkTint = 0x102030;
                }).message,
            ).toMatch(/no dark color/);
            shine.darkTint = 0x102030;
            expect(shine.darkTint).toBe(0x102030);
            spine.destroy();
        });

        it('keeps a written color on a slot no animation keys while it plays', () => {
            const spine = new MarrowSpine(mix, { autoUpdate: false });

            spine.skins = ['full-skins/girl'];
            spine.play('walk', { loop: true });
            spine.update(FRAME);
            spine.slot('base-head').tint = 0x00ff00;
            for (let frame = 0; frame < 5; frame++) spine.update(FRAME);
            expect(spine.slot('base-head').tint).toBe(0x00ff00);
            spine.destroy();
        });
    });

    describe('with the setup pose', () => {
        it('resets the bones, the slots or both', () => {
            const spine = new MarrowSpine(coin, { autoUpdate: false });
            const bone = spine.bone(spine.slot('coin-side').bone);
            const side = spine.slot('coin-side');
            const setupX = bone.x;
            const setupTint = side.tint;

            bone.x = setupX + 40;
            side.tint = 0x123456;
            spine.setupPose('slots');
            expect(side.tint).toBe(setupTint);
            expect(bone.x).toBe(setupX + 40);
            side.tint = 0x123456;
            spine.setupPose('bones');
            expect(bone.x).toBe(setupX);
            expect(side.tint).toBe(0x123456);
            bone.x = setupX + 10;
            spine.setupPose();
            expect([bone.x, side.tint]).toEqual([setupX, setupTint]);
            expect(thrownBy(() => spine.setupPose('everything' as 'all')).message).toMatch(/no part "everything"/);
            spine.destroy();
        });
    });

    describe('with the point conversion of a bone', () => {
        it('takes points from the bone to the display object and back, as the world matrix does', () => {
            const spine = new MarrowSpine(mix, { autoUpdate: false });
            const head = spine.bone('head');

            spine.skins = ['full-skins/girl'];
            spine.play('walk', { loop: true });
            spine.update(0.3);
            const local = new Point(25, -40);
            const world = head.localToWorld(local);
            const expected = head.worldMatrix().apply(local);

            expect(world.x).toBeCloseTo(expected.x, 9);
            expect(world.y).toBeCloseTo(expected.y, 9);
            expect(head.localToWorld({ x: 0, y: 0 })).toMatchObject({ x: head.worldX, y: head.worldY });
            const back = head.worldToLocal(world, new Point());

            expect(back.x).toBeCloseTo(25, 9);
            expect(back.y).toBeCloseTo(-40, 9);
            spine.destroy();
        });
    });
});
