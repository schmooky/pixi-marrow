import { Matrix, Point } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { LOCAL_STRIDE } from '../../src/pose/state';
import { loadAttachCode } from '../../src/render/attach-code';
import type { CoverSlot } from '../render/cover-rig';
import { settle } from '../render/heap';
import { coverAsset } from './cover-asset';
import { FRAME, fixtureAsset } from './helpers';

/*
 * The handle of a bone: `MarrowSpine.bone`. The rig is made by hand, so the numbers of its
 * bones are known: every slot has a bone of its own below the root.
 */

/** Two bones: `bone-near` at 100, 50 with a scale of 2, and `bone-far` at 300, 0. */
const SLOTS: readonly CoverSlot[] = [
    { name: 'near', shows: 'small', at: [100, 50], scale: 2 },
    { name: 'far', shows: 'small', at: [300, 0] },
];

const FIELDS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const;

/**
 * Whether a function stops allocating, see `settle`. The handle is so little code that the
 * windows of one try can end before the JavaScript engine has compiled it, when the machine is
 * busy with other tests. Until then every number it reads is an object. So this tries again
 * after a pause.
 */
async function settles(run: (i: number) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 40; attempt++) {
        if (settle(run, 30) > 0) return true;
        await new Promise((next) => setTimeout(next, 25));
    }

    return false;
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

describe('the handle of a bone', () => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];

    function create(from: MarrowAsset = asset): MarrowSpine {
        const spine = new MarrowSpine(from, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    beforeAll(async () => {
        asset = await coverAsset(SLOTS, { outlines: 'off' });
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it('is one object per bone, the same at every call, and belongs to its display object', () => {
        const [spine, other] = [create(), create()];
        const near = spine.bone('bone-near');

        expect(spine.bone('bone-near')).toBe(near);
        expect(near.name).toBe('bone-near');
        expect(spine.bone('bone-far')).not.toBe(near);
        expect(spine.bone('root').name).toBe('root');
        // another display object of the same asset has a pose of its own
        expect(other.bone('bone-near')).not.toBe(near);
        near.x = 140;
        expect(other.bone('bone-near').x).toBe(100);
    });

    it('reads the pose next to the parent bone as the editor shows it', () => {
        const near = create().bone('bone-near');

        expect(FIELDS.map((field) => near[field])).toEqual([100, 50, 0, 2, 2]);
    });

    it('reads where the bone is in the display object, where y points down', () => {
        const spine = create();
        const near = spine.bone('bone-near');

        spine.update(FRAME);
        // 50 up in the editor is 50 up on the screen: a smaller y
        expect(near.worldX).toBeCloseTo(100, 4);
        expect(near.worldY).toBeCloseTo(-50, 4);
        expect(near.worldRotation).toBeCloseTo(0, 4);
        // counter-clockwise in the editor is counter-clockwise on the screen: a negative Pixi angle
        near.rotation = 30;
        spine.update(FRAME);
        expect(near.worldRotation).toBeCloseTo(-30, 4);
        expect(near.worldX).toBeCloseTo(100, 4);
        expect(near.worldY).toBeCloseTo(-50, 4);
    });

    it('gives the world transform as a Pixi matrix, into a matrix of the caller or a new one', () => {
        const spine = create();
        const near = spine.bone('bone-near');
        const out = new Matrix();

        spine.update(FRAME);
        expect(near.worldMatrix(out)).toBe(out);
        expect(near.worldMatrix()).not.toBe(near.worldMatrix());
        expect([out.tx, out.ty]).toEqual([near.worldX, near.worldY]);
        // a point next to the bone, in the coordinates of the editor: 10 to the right, then 10 up, at a scale of 2
        const right = out.apply(new Point(10, 0));
        const up = out.apply(new Point(0, 10));

        expect(right.x).toBeCloseTo(120, 4);
        expect(right.y).toBeCloseTo(-50, 4);
        expect(up.x).toBeCloseTo(100, 4);
        expect(up.y).toBeCloseTo(-70, 4);
        // the matrix of a child of the display object that sits on the bone
        near.rotation = 90;
        spine.update(FRAME);
        const turned = near.worldMatrix(out).apply(new Point(10, 0));

        expect(turned.x).toBeCloseTo(100, 4);
        expect(turned.y).toBeCloseTo(-70, 4);
    });

    it('writes into the pose and marks it: the world values change with the next update', () => {
        const spine = create();
        const { state } = spine.engine;
        const far = spine.bone('bone-far');
        const index = asset.model.bones.names.indexOf('bone-far');

        spine.update(FRAME);
        for (const [at, field] of FIELDS.entries()) {
            const { version } = state;

            far[field] = 7 + at;
            expect(far[field]).toBe(7 + at);
            expect(state.local[index * LOCAL_STRIDE + at]).toBe(7 + at);
            expect(state.version).not.toBe(version);
        }
        // nothing moved yet
        expect([far.worldX, far.worldY]).toEqual([300, 0]);
        spine.update(FRAME);
        expect(far.worldX).toBeCloseTo(7, 4);
        expect(far.worldY).toBeCloseTo(-8, 4);
        expect(far.worldRotation).toBeCloseTo(-9, 4);
    });

    it('refuses a number that is not finite, with a fix, and leaves the pose alone', () => {
        const spine = create();
        const { state } = spine.engine;
        const far = spine.bone('bone-far');

        spine.update(FRAME);
        const { version } = state;

        for (const field of FIELDS) {
            for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
                const error = thrownBy(() => {
                    far[field] = value;
                });

                expect(error.message).toContain(`bone("bone-far")`);
                expect(error.message).toContain(field);
                expect(error.fix).toBe('Pass a finite number.');
            }
        }
        expect(FIELDS.map((field) => far[field])).toEqual([300, 0, 0, 1, 1]);
        expect(state.version).toBe(version);
    });

    it('refuses a name the skeleton does not have, with the names it has', () => {
        expect(thrownBy(() => create().bone('bone-nea' as never))).toMatchObject({
            code: 'unknown-name',
            closest: 'bone-near',
            validNames: ['root', 'bone-near', 'bone-far'],
        });
    });

    it('allocates nothing when it is read and written, once it exists', async () => {
        const spine = create();
        const near = spine.bone('bone-near');
        const out = new Matrix();
        // a typed array: a number that a function keeps outside of itself is an object of its own
        const read = new Float64Array(4);

        spine.update(FRAME);
        const quiet = await settles((i) => {
            const handle = spine.bone('bone-near');

            handle.rotation = i % 360;
            handle.x = 100 + (i % 7);
            read[0] = handle.worldX;
            read[1] = handle.worldY;
            read[2] = handle.worldRotation;
            read[3] = handle.worldMatrix(out).tx;
        });

        expect(quiet).toBe(true);
        expect(near.x).toBeGreaterThanOrEqual(100);
        expect([...read].every(Number.isFinite)).toBe(true);
    });
});

describe('a bone that only a skin lists', () => {
    it('is not active until that skin is, and a container on a slot of that bone is hidden until then', async () => {
        const asset = await fixtureAsset('4.2/hero-pro.skel');
        const spine = new MarrowSpine(asset, { autoUpdate: false });
        const sword = spine.bone('weapon-sword');
        const label = new MarrowSpine(asset, { autoUpdate: false });

        await loadAttachCode();
        spine.attach('weapon-sword', label);
        spine.update(FRAME);
        expect(sword.active).toBe(false);
        expect(spine.bone('root').active).toBe(true);
        expect(label.visible).toBe(false);
        spine.skin = 'weapon/sword';
        spine.update(FRAME);
        expect(sword.active).toBe(true);
        expect(label.visible).toBe(true);
        expect([label.position.x, label.position.y]).toEqual([sword.worldX, sword.worldY]);
        spine.skin = null;
        spine.update(FRAME);
        expect(sword.active).toBe(false);
        expect(label.visible).toBe(false);
        spine.destroy();
        expect(label.destroyed).toBe(false);
        label.destroy();
    });
});
