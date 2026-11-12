import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { pointsInsideQuad } from '../../src/geometry/occlusion';
import { computeOpaqueRect } from '../../src/geometry/opaque-rect';
import type { PageRect } from '../../src/model/outlines';
import { bruteOpaqueArea, isOpaque, paintAlpha, seeded } from './outline-checks';

const WIDTH = 40;
const HEIGHT = 30;
const WHOLE: PageRect = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
const ANY_SIZE = { minArea: 0 };

/** A page of 40x30 pixels with alpha 255 where `opaque` says so, and 254 elsewhere. */
const page = (opaque: (x: number, y: number) => boolean): Uint8Array =>
    paintAlpha(WIDTH, HEIGHT, (x, y) => (opaque(x, y) ? 255 : 254));

describe('computeOpaqueRect', () => {
    it('finds the opaque block and takes the margin off every side', () => {
        const alpha = page((x, y) => x >= 5 && x < 25 && y >= 10 && y < 22);

        expect(computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, ANY_SIZE)).toEqual({
            x: 6,
            y: 11,
            width: 18,
            height: 10,
        });
        expect(computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, { margin: 0, minArea: 0 })).toEqual({
            x: 5,
            y: 10,
            width: 20,
            height: 12,
        });
        expect(computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, { margin: 2.5, minArea: 0 })).toEqual({
            x: 7.5,
            y: 12.5,
            width: 15,
            height: 7,
        });
    });

    it('counts alpha 255 only', () => {
        const almost = paintAlpha(WIDTH, HEIGHT, () => 254);

        expect(computeOpaqueRect(almost, WIDTH, HEIGHT, WHOLE, ANY_SIZE)).toBeNull();
        expect(
            computeOpaqueRect(
                paintAlpha(WIDTH, HEIGHT, () => 0),
                WIDTH,
                HEIGHT,
                WHOLE,
                ANY_SIZE,
            ),
        ).toBeNull();
    });

    it('stays inside the region, in page pixels', () => {
        const alpha = page(() => true);
        const rect = { x: 7, y: 3, width: 20, height: 15 };

        expect(computeOpaqueRect(alpha, WIDTH, HEIGHT, rect, ANY_SIZE)).toEqual({ x: 8, y: 4, width: 18, height: 13 });
    });

    it('prefers the rectangle that is larger after the margin, not before it', () => {
        // a strip of 36x3 pixels has more area than a block of 9x9, and nothing left after a margin of 1.5
        const alpha = page((x, y) => (y < 3 && x < 36) || (x >= 20 && x < 29 && y >= 10 && y < 19));

        expect(computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, { margin: 0, minArea: 0 })).toEqual({
            x: 0,
            y: 0,
            width: 36,
            height: 3,
        });
        expect(computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, { margin: 1.5, minArea: 0 })).toEqual({
            x: 21.5,
            y: 11.5,
            width: 6,
            height: 6,
        });
    });

    it('gives nothing for a rectangle below the least area', () => {
        const alpha = page((x, y) => x < 34 && y < 34);

        // 32x28 pixels are left of 34x30 after the margin
        expect(computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, { minArea: 32 * 28 })).toEqual({
            x: 1,
            y: 1,
            width: 32,
            height: 28,
        });
        expect(computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, { minArea: 32 * 28 + 1 })).toBeNull();
        // the default is 1024 pixels
        expect(computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE)).toBeNull();
        expect(
            computeOpaqueRect(
                page(() => true),
                WIDTH,
                HEIGHT,
                WHOLE,
            ),
        ).toEqual({ x: 1, y: 1, width: 38, height: 28 });
    });

    it('finds the largest rectangle of random images, as a search of every rectangle does', () => {
        const random = seeded(41);

        for (let round = 0; round < 400; round++) {
            const holes = random() * 0.2;
            const alpha = page(() => random() >= holes);
            const rect = {
                x: Math.floor(random() * 10),
                y: Math.floor(random() * 8),
                width: Math.floor(random() * 30),
                height: Math.floor(random() * 22),
            };

            for (const margin of [0, 0.5, 1, 2]) {
                const found = computeOpaqueRect(alpha, WIDTH, HEIGHT, rect, { margin, minArea: 0 });
                const best = bruteOpaqueArea(alpha, WIDTH, rect, margin);

                expect(found === null ? 0 : found.width * found.height).toBe(best);
                if (found === null) continue;
                expect(isOpaque(alpha, WIDTH, found, margin)).toBe(true);
                expect(found.x - margin).toBeGreaterThanOrEqual(rect.x);
                expect(found.y - margin).toBeGreaterThanOrEqual(rect.y);
                expect(found.x + found.width + margin).toBeLessThanOrEqual(rect.x + rect.width);
                expect(found.y + found.height + margin).toBeLessThanOrEqual(rect.y + rect.height);
            }
        }
    });

    it('throws for a rectangle that leaves the page and for options out of range', () => {
        const alpha = page(() => true);

        expect(() => computeOpaqueRect(alpha, WIDTH, HEIGHT, { x: 30, y: 0, width: 11, height: 5 })).toThrow(
            MarrowError,
        );
        expect(() => computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, { margin: -1 })).toThrow(MarrowError);
        expect(() => computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, { margin: Number.POSITIVE_INFINITY })).toThrow(
            MarrowError,
        );
        expect(() => computeOpaqueRect(alpha, WIDTH, HEIGHT, WHOLE, { minArea: Number.NaN })).toThrow(/least area/);
    });
});

describe('pointsInsideQuad', () => {
    /** A rectangle of 10x6 around the origin, turned by an angle and moved. In either winding. */
    function quad(angle: number, x: number, y: number, flip: boolean): Float64Array {
        const corners = [-5, -3, 5, -3, 5, 3, -5, 3];
        const order = flip ? [3, 2, 1, 0] : [0, 1, 2, 3];
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        return Float64Array.from(
            order.flatMap((corner) => {
                const cx = corners[corner * 2] ?? 0;
                const cy = corners[corner * 2 + 1] ?? 0;

                return [x + cx * cos - cy * sin, y + cx * sin + cy * cos];
            }),
        );
    }

    /** Points in the frame of the rectangle, moved with it. */
    function placed(points: number[], angle: number, x: number, y: number): Float64Array {
        return Float64Array.from(
            points.map((_, i) => {
                const px = points[i - (i % 2)] ?? 0;
                const py = points[i - (i % 2) + 1] ?? 0;

                return i % 2 === 0
                    ? x + px * Math.cos(angle) - py * Math.sin(angle)
                    : y + px * Math.sin(angle) + py * Math.cos(angle);
            }),
        );
    }

    it('says yes when every point is inside, in any orientation and winding', () => {
        for (const angle of [0, 0.3, 1.2, Math.PI / 2, 2.5, -2]) {
            for (const flip of [false, true]) {
                const corners = quad(angle, 100, -40, flip);
                const inside = placed([0, 0, 4.9, 2.9, -4.9, -2.9, 4.9, -2.9, -1, 2], angle, 100, -40);
                const oneOut = placed([0, 0, 4.9, 2.9, 5.1, 0], angle, 100, -40);

                expect(pointsInsideQuad(corners, 0, inside, 0, 5)).toBe(true);
                expect(pointsInsideQuad(corners, 0, oneOut, 0, 3)).toBe(false);
                expect(pointsInsideQuad(corners, 0, oneOut, 0, 2)).toBe(true);
                for (const [px, py] of [
                    [0, 3.1],
                    [0, -3.1],
                    [-5.1, 0],
                    [5.1, 3.1],
                ]) {
                    expect(pointsInsideQuad(corners, 0, placed([px ?? 0, py ?? 0], angle, 100, -40), 0, 1)).toBe(false);
                }
            }
        }
    });

    it('counts a point on an edge or on a corner as inside', () => {
        const corners = Float32Array.of(0, 0, 8, 0, 8, 4, 0, 4);

        expect(pointsInsideQuad(corners, 0, Float32Array.of(0, 0, 8, 4, 4, 0, 0, 2), 0, 4)).toBe(true);
        expect(pointsInsideQuad(corners, 0, Float32Array.of(8.001, 4), 0, 1)).toBe(false);
    });

    it('handles a quad that is not a rectangle', () => {
        const corners = Float64Array.of(0, 0, 10, 1, 7, 9, -2, 5);

        expect(pointsInsideQuad(corners, 0, Float64Array.of(4, 4, 8, 2, 0, 1), 0, 3)).toBe(true);
        expect(pointsInsideQuad(corners, 0, Float64Array.of(4, 4, 9.5, 5), 0, 2)).toBe(false);
    });

    it('reads the quad and the points where it is told to', () => {
        const corners = Float32Array.of(99, 99, 0, 0, 8, 0, 8, 4, 0, 4);
        // x, y and one more number per point, after two numbers that are not points
        const points = Float32Array.of(50, 50, 1, 1, 50, 7, 3, 50, 20, 20, 50);

        expect(pointsInsideQuad(corners, 2, points, 2, 2, 3)).toBe(true);
        expect(pointsInsideQuad(corners, 2, points, 2, 3, 3)).toBe(false);
        expect(pointsInsideQuad(corners, 2, points, 0, 1, 3)).toBe(false);
    });

    it('says no for a quad without area, for no points and for numbers that are not finite', () => {
        const corners = Float64Array.of(0, 0, 8, 0, 8, 4, 0, 4);
        const line = Float64Array.of(0, 0, 4, 0, 8, 0, 4, 0);

        expect(pointsInsideQuad(line, 0, Float64Array.of(4, 0), 0, 1)).toBe(false);
        expect(pointsInsideQuad(corners, 0, Float64Array.of(4, 2), 0, 0)).toBe(false);
        expect(pointsInsideQuad(corners, 0, Float64Array.of(Number.NaN, 2), 0, 1)).toBe(false);
        expect(pointsInsideQuad(corners, 0, Float64Array.of(4, Number.POSITIVE_INFINITY), 0, 1)).toBe(false);
        expect(pointsInsideQuad(Float64Array.of(0, 0, Number.NaN, 0, 8, 4, 0, 4), 0, Float64Array.of(4, 2), 0, 1)).toBe(
            false,
        );
    });

    it('throws when it is asked to read past the end of an array', () => {
        const corners = Float64Array.of(0, 0, 8, 0, 8, 4, 0, 4);

        expect(() => pointsInsideQuad(corners, 0, Float64Array.of(4, 2), 0, 2)).toThrow(MarrowError);
        expect(() => pointsInsideQuad(corners, 2, Float64Array.of(4, 2), 0, 1)).toThrow(MarrowError);
    });
});
