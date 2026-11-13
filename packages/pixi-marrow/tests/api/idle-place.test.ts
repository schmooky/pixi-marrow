import { Bounds, Container, Matrix } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createPlacement, imageToSpace, pixelBox, placeOf, spaceToImage, wholeMove } from '../../src/api/idle-place';

/*
 * Where the idle cache puts an image: the placement of a display object on the pixels of its
 * target, and the grid an image is drawn on.
 */

/** A chain of three containers with every kind of transform, the inner one last. */
function chain(): [Container, Container, Container] {
    const root = new Container();
    const middle = new Container();
    const inner = new Container();

    root.addChild(middle);
    middle.addChild(inner);
    root.position.set(10, 20);
    middle.position.set(-3.5, 7.25);
    middle.rotation = 0.3;
    middle.skew.set(0.05, -0.02);
    middle.pivot.set(4, 2);
    inner.scale.set(0.5, -0.75);
    inner.position.set(100, 50);

    return [root, middle, inner];
}

describe('the placement of a display object', () => {
    it('multiplies the local transforms up to the root and the resolution of the target', () => {
        const [root, middle, inner] = chain();
        const place = createPlacement();

        root.updateLocalTransform();
        placeOf(inner, 2, place);
        const expected = new Matrix().scale(1, 1);

        // the inner transform first, then the middle, then the root, then the resolution
        expected.append(root.localTransform).append(middle.localTransform).append(inner.localTransform);
        expected.prepend(new Matrix(2, 0, 0, 2, 0, 0));
        for (const [i, key] of (['a', 'b', 'c', 'd', 'tx', 'ty'] as const).entries()) {
            expect(place[i]).toBeCloseTo(expected[key], 9);
        }
    });

    it('takes the local transform of the root as it stands, where Pixi has put the transform of a render', () => {
        const [root, , inner] = chain();
        const place = createPlacement();

        root.updateLocalTransform();
        root.localTransform.set(1, 0, 0, 1, 500, 600);
        root.position.set(1, 1);
        placeOf(inner, 1, place);
        // the position is not taken into the matrix of the render, which stays as it was
        expect(root.localTransform.tx).toBe(500);
        placeOf(root, 1, place);
        expect([...place]).toEqual([1, 0, 0, 1, 500, 600]);
    });

    it('counts a move by whole pixels as the same placement, and nothing else', () => {
        const then = Float64Array.from([0.5, 0.1, -0.1, 0.5, 100.25, 7.5]);
        const moved = (change: (place: Float64Array) => void): boolean => {
            const now = Float64Array.from(then);

            change(now);

            return wholeMove(now, then);
        };

        expect(moved(() => {})).toBe(true);
        expect(
            moved((now) => {
                now[4] = Number(now[4]) + 3;
                now[5] = Number(now[5]) - 12;
            }),
        ).toBe(true);
        expect(
            moved((now) => {
                now[4] = Number(now[4]) + 0.5;
            }),
        ).toBe(false);
        expect(
            moved((now) => {
                now[5] = Number(now[5]) + 0.001;
            }),
        ).toBe(false);
        expect(
            moved((now) => {
                now[0] = Number(now[0]) * 1.001;
            }),
        ).toBe(false);
        expect(
            moved((now) => {
                now[2] = 0;
            }),
        ).toBe(false);
    });
});

describe('the pixel grid of an image', () => {
    it('covers the corners of the bounds on whole pixels, with a margin', () => {
        const bounds = new Bounds(-10, -20, 30, 40);
        const turned = Float64Array.from([Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5), 100.3, 50.6]);
        const box = pixelBox(bounds, turned, 1);
        const corners = [
            [-10, -20],
            [30, -20],
            [30, 40],
            [-10, 40],
        ].map(([x = 0, y = 0]) => [
            Number(turned[0]) * x + Number(turned[2]) * y + Number(turned[4]),
            Number(turned[1]) * x + Number(turned[3]) * y + Number(turned[5]),
        ]);

        for (const [x = 0, y = 0] of corners) {
            expect(x).toBeGreaterThanOrEqual(box.x + 1);
            expect(y).toBeGreaterThanOrEqual(box.y + 1);
            expect(x).toBeLessThanOrEqual(box.x + box.width - 1);
            expect(y).toBeLessThanOrEqual(box.y + box.height - 1);
        }
        for (const value of Object.values(box)) expect(Number.isInteger(value)).toBe(true);
        expect(pixelBox(new Bounds(), turned, 1)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it('maps the image back onto the place it was drawn at', () => {
        const place = Float64Array.from([0.4, 0.2, -0.3, 0.6, 210.7, -33.2]);
        const toImage = new Matrix(...spaceToImage(place, 200, -40));
        const toSpace = new Matrix(...imageToSpace(place, 200, -40));

        for (const point of [
            { x: 0, y: 0 },
            { x: 17, y: 3 },
            { x: -5, y: 80 },
        ]) {
            const back = toImage.apply(toSpace.apply(point));

            expect(back.x).toBeCloseTo(point.x, 9);
            expect(back.y).toBeCloseTo(point.y, 9);
        }
        expect(() => imageToSpace(new Float64Array(6), 0, 0)).toThrow(/scale 0/);
    });
});
