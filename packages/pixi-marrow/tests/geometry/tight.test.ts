import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { SPINE_VERSIONS } from '../../src/base/version';
import { importAtlas } from '../../src/formats/atlas';
import { findRegion, readRegion } from '../../src/geometry/atlas-regions';
import { polygonArea } from '../../src/geometry/convex';
import { computeOutlineVertices } from '../../src/geometry/outline-vertices';
import { computeRegionOffsets, computeRegionUVs } from '../../src/geometry/region';
import { alphaFromRgba, checkPageRect, computeTightOutline, regionPageRect } from '../../src/geometry/tight';
import type { RegionAttachmentData } from '../../src/model/attachments';
import type { PageRect } from '../../src/model/outlines';
import { anyVisible, findCutPixel, isConvex, paintAlpha, seeded, triangleArea } from './outline-checks';
import { ATLAS_TEXT, DEGREES, regionName } from './synthetic';

const atlas = importAtlas(ATLAS_TEXT);
const WIDTH = 64;
const HEIGHT = 48;
const WHOLE: PageRect = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

/** A page of 64x48 pixels with alpha 255 where `visible` says so. */
const page = (visible: (x: number, y: number) => boolean): Uint8Array =>
    paintAlpha(WIDTH, HEIGHT, (x, y) => (visible(x, y) ? 255 : 0));

/** Checks what every outline promises, whatever the image. */
function expectSound(alpha: Uint8Array, rect: PageRect, margin: number, maxVertices: number): void {
    const outline = computeTightOutline(alpha, WIDTH, HEIGHT, rect, { margin, maxVertices });
    const { polygon, triangles } = outline;
    const count = polygon.length / 2;

    if (count === 0) {
        // an empty outline stands for a region without a visible pixel, the neighbors included
        expect(anyVisible(alpha, WIDTH, HEIGHT, rect, margin > 0 ? 1 : 0)).toBe(false);

        return;
    }
    expect(findCutPixel(alpha, WIDTH, HEIGHT, rect, margin, polygon)).toBeNull();
    expect(count).toBeLessThanOrEqual(maxVertices);
    expect(isConvex(polygon)).toBe(true);
    for (let i = 0; i < count; i++) {
        expect(polygon[i * 2]).toBeGreaterThanOrEqual(rect.x);
        expect(polygon[i * 2]).toBeLessThanOrEqual(rect.x + rect.width);
        expect(polygon[i * 2 + 1]).toBeGreaterThanOrEqual(rect.y);
        expect(polygon[i * 2 + 1]).toBeLessThanOrEqual(rect.y + rect.height);
    }
    expect(Array.from(triangles)).toEqual(Array.from({ length: count - 2 }, (_, i) => [0, i + 1, i + 2]).flat());
    expect(triangleArea(polygon, triangles)).toBeCloseTo(polygonArea(polygon, count), 9);
    expect(outline.coverage).toBeCloseTo(polygonArea(polygon, count) / (rect.width * rect.height), 12);
}

/** A page with an ellipse of any alpha and some stray pixels, and a rectangle somewhere on it. */
function randomImage(random: () => number): { alpha: Uint8Array; rect: PageRect } {
    const cx = random() * WIDTH;
    const cy = random() * HEIGHT;
    const radius = 3 + random() * 25;
    const noise = random() * 0.02;
    const alpha = paintAlpha(WIDTH, HEIGHT, (x, y) =>
        Math.hypot(x - cx, (y - cy) * (0.5 + random())) < radius || random() < noise
            ? 1 + Math.floor(random() * 255)
            : 0,
    );
    const rect = {
        x: Math.floor(random() * 20),
        y: Math.floor(random() * 15),
        width: 1 + Math.floor(random() * 44),
        height: 1 + Math.floor(random() * 33),
    };

    return { alpha, rect };
}

describe('alphaFromRgba', () => {
    it('takes every fourth byte', () => {
        const rgba = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 0, 9, 9, 9, 255);

        expect(Array.from(alphaFromRgba(rgba, false))).toEqual([4, 0, 255]);
        expect(Array.from(alphaFromRgba(new Uint8ClampedArray(rgba), false))).toEqual([4, 0, 255]);
    });

    it('keeps a color without alpha visible on a premultiplied page, where it adds light', () => {
        const rgba = Uint8Array.of(0, 0, 0, 0, 0, 9, 0, 0, 200, 200, 200, 200, 3, 0, 0, 255);

        expect(Array.from(alphaFromRgba(rgba, true))).toEqual([0, 1, 200, 255]);
        expect(Array.from(alphaFromRgba(rgba, false))).toEqual([0, 0, 200, 255]);
    });
});

describe('regionPageRect', () => {
    it('swaps the sides for a rotation of 90 degrees and for no other', () => {
        for (const degrees of DEGREES) {
            const region = readRegion(atlas, findRegion(atlas, regionName(degrees, false)));
            const rect = regionPageRect(region);

            expect(rect).toEqual({
                x: region.x,
                y: 2,
                width: degrees === 90 ? 30 : 40,
                height: degrees === 90 ? 40 : 30,
            });
            // the rectangle is what the texture coordinates span
            expect(rect.x + rect.width).toBe(region.u2 * region.pageWidth);
            expect(rect.y + rect.height).toBe(region.v2 * region.pageHeight);
        }
    });
});

describe('computeTightOutline', () => {
    it('gives an empty outline for a region without a visible pixel', () => {
        const outline = computeTightOutline(
            page(() => false),
            WIDTH,
            HEIGHT,
            WHOLE,
        );

        expect(outline).toEqual({
            polygon: new Float64Array(0),
            triangles: new Uint16Array(0),
            coverage: 0,
            worthIt: true,
        });
        expect(
            computeTightOutline(
                page(() => true),
                WIDTH,
                HEIGHT,
                { x: 5, y: 5, width: 0, height: 9 },
            ).polygon,
        ).toHaveLength(0);
        expect(
            computeTightOutline(
                page(() => true),
                WIDTH,
                HEIGHT,
                { x: 5, y: 5, width: 9, height: 0 },
            ).polygon,
        ).toHaveLength(0);
    });

    it('puts a square with the margin around one pixel', () => {
        const alpha = page((x, y) => x === 20 && y === 10);

        expect(Array.from(computeTightOutline(alpha, WIDTH, HEIGHT, WHOLE).polygon)).toEqual([
            19, 9, 22, 9, 22, 12, 19, 12,
        ]);
        expect(Array.from(computeTightOutline(alpha, WIDTH, HEIGHT, WHOLE, { margin: 0 }).polygon)).toEqual([
            20, 10, 21, 10, 21, 11, 20, 11,
        ]);
        expect(Array.from(computeTightOutline(alpha, WIDTH, HEIGHT, WHOLE, { margin: 2.5 }).polygon)).toEqual([
            17.5, 7.5, 23.5, 7.5, 23.5, 13.5, 17.5, 13.5,
        ]);
    });

    it('counts a pixel with any alpha above 0 as visible', () => {
        const alpha = paintAlpha(WIDTH, HEIGHT, (x, y) => (x === 30 && y === 30 ? 1 : 0));

        expect(Array.from(computeTightOutline(alpha, WIDTH, HEIGHT, WHOLE).polygon)).toEqual([
            29, 29, 32, 29, 32, 32, 29, 32,
        ]);
    });

    it('never leaves the rectangle of the region', () => {
        const alpha = page((x, y) => x === 10 && y === 10);
        const rect = { x: 10, y: 10, width: 6, height: 4 };

        expect(Array.from(computeTightOutline(alpha, WIDTH, HEIGHT, rect).polygon)).toEqual([
            10, 10, 12, 10, 12, 12, 10, 12,
        ]);
    });

    it('says that a full region is not worth an outline', () => {
        const outline = computeTightOutline(
            page(() => true),
            WIDTH,
            HEIGHT,
            { x: 4, y: 4, width: 20, height: 10 },
        );

        expect(Array.from(outline.polygon)).toEqual([4, 4, 24, 4, 24, 14, 4, 14]);
        expect(outline.coverage).toBe(1);
        expect(outline.worthIt).toBe(false);
    });

    it('compares the coverage with the threshold', () => {
        // a triangle that fills half of the rectangle, and a little more with the margin
        const alpha = page((x, y) => x < 40 && y < 40 && x + y < 40);
        const rect = { x: 0, y: 0, width: 40, height: 40 };
        const outline = computeTightOutline(alpha, WIDTH, HEIGHT, rect);

        expect(Array.from(outline.polygon)).toEqual([0, 0, 40, 0, 40, 3, 3, 40, 0, 40]);
        expect(outline.coverage).toBeCloseTo(1 - (37 * 37) / 2 / 1600, 12);
        expect(outline.worthIt).toBe(true);
        expect(computeTightOutline(alpha, WIDTH, HEIGHT, rect, { threshold: 0.5 }).worthIt).toBe(false);
        expect(computeTightOutline(alpha, WIDTH, HEIGHT, rect, { threshold: 1 }).worthIt).toBe(true);
    });

    it('keeps a visible pixel next to the rectangle, which filtering mixes into the edge', () => {
        const rect = { x: 20, y: 20, width: 10, height: 10 };
        const leftOf = page((x, y) => x === 19 && y === 24);
        const above = page((x, y) => x === 25 && y === 19);
        const atCorner = page((x, y) => x === 30 && y === 30);
        const twoAway = page((x, y) => x === 18 && y === 24);

        expect(Array.from(computeTightOutline(leftOf, WIDTH, HEIGHT, rect).polygon)).toEqual([
            20, 23, 21, 23, 21, 26, 20, 26,
        ]);
        expect(Array.from(computeTightOutline(above, WIDTH, HEIGHT, rect).polygon)).toEqual([
            24, 20, 27, 20, 27, 21, 24, 21,
        ]);
        expect(Array.from(computeTightOutline(atCorner, WIDTH, HEIGHT, rect).polygon)).toEqual([
            29, 29, 30, 29, 30, 30, 29, 30,
        ]);
        expect(computeTightOutline(twoAway, WIDTH, HEIGHT, rect).polygon).toHaveLength(0);
        // without a margin the caller rules filtering out, and the neighbor does not count
        expect(computeTightOutline(leftOf, WIDTH, HEIGHT, rect, { margin: 0 }).polygon).toHaveLength(0);
    });

    it('looks at the other edge of a page that repeats', () => {
        const alpha = page((x, y) => (x === WIDTH - 1 && y === 5) || (x === 7 && y === HEIGHT - 1));
        const rect = { x: 0, y: 0, width: 12, height: 12 };

        expect(computeTightOutline(alpha, WIDTH, HEIGHT, rect).polygon).toHaveLength(0);
        expect(Array.from(computeTightOutline(alpha, WIDTH, HEIGHT, rect, { repeatX: true }).polygon)).toEqual([
            0, 4, 1, 4, 1, 7, 0, 7,
        ]);
        expect(Array.from(computeTightOutline(alpha, WIDTH, HEIGHT, rect, { repeatY: true }).polygon)).toEqual([
            6, 0, 9, 0, 9, 1, 6, 1,
        ]);
        expect(
            Array.from(computeTightOutline(alpha, WIDTH, HEIGHT, rect, { repeatX: true, repeatY: true }).polygon),
        ).toEqual([0, 4, 6, 0, 9, 0, 9, 1, 1, 7, 0, 7]);
    });

    it('holds every visible pixel of random images, for every margin and vertex limit', () => {
        const random = seeded(3);

        for (let round = 0; round < 120; round++) {
            const { alpha, rect } = randomImage(random);

            for (const margin of [0, 0.5, 1, 3]) {
                for (const maxVertices of [4, 6, 8, 16]) {
                    expectSound(alpha, rect, margin, maxVertices);
                }
            }
        }
    });

    it('needs no special case for a region that is rotated inside its page', () => {
        const random = seeded(5);
        const [pageA] = atlas.pages;

        if (pageA === undefined) throw new Error('the test atlas has no page');
        // the same blobs everywhere: each region cuts its own part out of them
        const alpha = paintAlpha(pageA.width, pageA.height, (x, y) =>
            Math.sin(x / 7) + Math.cos(y / 5) > 0.4 || random() < 0.01 ? 255 : 0,
        );

        for (const degrees of DEGREES) {
            for (const trimmed of [false, true]) {
                const rect = regionPageRect(readRegion(atlas, findRegion(atlas, regionName(degrees, trimmed))));
                const outline = computeTightOutline(alpha, pageA.width, pageA.height, rect);

                expect(outline.polygon.length).toBeGreaterThanOrEqual(6);
                expect(findCutPixel(alpha, pageA.width, pageA.height, rect, 1, outline.polygon)).toBeNull();
                for (let i = 0; i < outline.polygon.length; i += 2) {
                    expect(outline.polygon[i]).toBeGreaterThanOrEqual(rect.x);
                    expect(outline.polygon[i]).toBeLessThanOrEqual(rect.x + rect.width);
                    expect(outline.polygon[i + 1]).toBeGreaterThanOrEqual(rect.y);
                    expect(outline.polygon[i + 1]).toBeLessThanOrEqual(rect.y + rect.height);
                }
            }
        }
    });

    it('throws for a rectangle that leaves the page and for options out of range', () => {
        const alpha = page(() => true);
        const options = [
            { margin: -1 },
            { margin: Number.NaN },
            { threshold: 1.5 },
            { threshold: -0.1 },
            { maxVertices: 3 },
        ];

        for (const rect of [
            { x: -1, y: 0, width: 4, height: 4 },
            { x: 62, y: 0, width: 4, height: 4 },
            { x: 0, y: 46, width: 4, height: 4 },
            { x: 0, y: 0, width: 4.5, height: 4 },
            { x: 0, y: 0, width: -4, height: 4 },
        ]) {
            expect(() => computeTightOutline(alpha, WIDTH, HEIGHT, rect)).toThrow(MarrowError);
        }
        for (const bad of options)
            expect(() => computeTightOutline(alpha, WIDTH, HEIGHT, WHOLE, bad)).toThrow(MarrowError);
        expect(() => computeTightOutline(alpha, WIDTH, HEIGHT + 1, WHOLE)).toThrow(/alpha values/);
        expect(() => checkPageRect(alpha, WIDTH, HEIGHT, { x: 60, y: 0, width: 5, height: 1 })).toThrow(
            /leaves its page/,
        );
        expect(() => checkPageRect(alpha, WIDTH, HEIGHT, WHOLE)).not.toThrow();
    });
});

/** A region attachment of the size of the untrimmed test image, turned and moved so that nothing is axis-aligned. */
const attachment: RegionAttachmentData = {
    type: 'region',
    name: 'quad',
    path: 'quad',
    x: 3,
    y: -4,
    scaleX: 1.5,
    scaleY: 0.75,
    rotation: 25,
    width: 44,
    height: 32,
    color: Float64Array.of(1, 1, 1, 1),
    sequence: null,
};

/** The value at s, t of a quantity given at the four corners of a quad, in the order of the quad. */
const bilinear = (corners: ArrayLike<number>, at: number, s: number, t: number): number =>
    (1 - s) * (1 - t) * (corners[at] ?? 0) +
    s * (1 - t) * (corners[2 + at] ?? 0) +
    s * t * (corners[4 + at] ?? 0) +
    (1 - s) * t * (corners[6 + at] ?? 0);

describe('computeOutlineVertices', () => {
    it.each(SPINE_VERSIONS)('matches the quad at its corners and between them, for every rotation in %s', (version) => {
        const random = seeded(17);

        for (const degrees of DEGREES) {
            for (const trimmed of [false, true]) {
                const region = readRegion(atlas, findRegion(atlas, regionName(degrees, trimmed)));
                const quadOffsets = version === '4.3' ? new Float64Array(8) : new Float32Array(8);
                const quadUVs = new Float32Array(8);

                computeRegionOffsets(version, attachment, region, quadOffsets);
                computeRegionUVs(region, quadUVs);
                // s, t pairs: the four corners in the order of the quad, then random places
                const places = [0, 0, 1, 0, 1, 1, 0, 1, ...Array.from({ length: 80 }, () => random() * 1.2 - 0.1)];
                const points = places.map((_, i) =>
                    i % 2 === 0
                        ? bilinear(quadUVs, 0, places[i] ?? 0, places[i + 1] ?? 0) * region.pageWidth
                        : bilinear(quadUVs, 1, places[i - 1] ?? 0, places[i] ?? 0) * region.pageHeight,
                );
                const offsets = new Float64Array(points.length);
                const uvs = new Float64Array(points.length);

                computeOutlineVertices(points, region.pageWidth, region.pageHeight, quadOffsets, quadUVs, offsets, uvs);
                // the map is made from corners 0, 1 and 3: corner 2 is the test of it
                expect(offsets[4]).toBeCloseTo(quadOffsets[4] ?? 0, 4);
                expect(offsets[5]).toBeCloseTo(quadOffsets[5] ?? 0, 4);
                for (let i = 0; i < points.length; i += 2) {
                    const s = places[i] ?? 0;
                    const t = places[i + 1] ?? 0;

                    expect(offsets[i]).toBeCloseTo(bilinear(quadOffsets, 0, s, t), 4);
                    expect(offsets[i + 1]).toBeCloseTo(bilinear(quadOffsets, 1, s, t), 4);
                    expect(uvs[i]).toBeCloseTo(bilinear(quadUVs, 0, s, t), 9);
                    expect(uvs[i + 1]).toBeCloseTo(bilinear(quadUVs, 1, s, t), 9);
                }
            }
        }
    });

    it('places the corners of the page rectangle on the corners of the quad', () => {
        for (const degrees of DEGREES) {
            const region = readRegion(atlas, findRegion(atlas, regionName(degrees, true)));
            const rect = regionPageRect(region);
            const quadOffsets = new Float64Array(8);
            const quadUVs = new Float32Array(8);
            const corners = [rect.x, rect.y, rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height];
            const offsets = new Float64Array(8);
            const uvs = new Float32Array(8);

            computeRegionOffsets('4.3', attachment, region, quadOffsets);
            computeRegionUVs(region, quadUVs);
            computeOutlineVertices(
                [...corners, rect.x, rect.y + rect.height],
                256,
                128,
                quadOffsets,
                quadUVs,
                offsets,
                uvs,
            );
            // every corner of the rectangle is a corner of the quad, with its texture coordinates
            for (let i = 0; i < 4; i++) {
                const corner = [0, 1, 2, 3].find(
                    (k) => uvs[i * 2] === quadUVs[k * 2] && uvs[i * 2 + 1] === quadUVs[k * 2 + 1],
                );

                expect(corner).toBeDefined();
                expect(offsets[i * 2]).toBeCloseTo(quadOffsets[(corner ?? 0) * 2] ?? 0, 9);
                expect(offsets[i * 2 + 1]).toBeCloseTo(quadOffsets[(corner ?? 0) * 2 + 1] ?? 0, 9);
            }
        }
    });

    it('writes at the given places and allocates no result', () => {
        const region = readRegion(atlas, findRegion(atlas, regionName(0, false)));
        const quadOffsets = new Float32Array(8);
        const quadUVs = new Float32Array(8);
        const offsets = new Float32Array(8).fill(-1);
        const statics = new Float32Array(12).fill(-1);

        computeRegionOffsets('4.2', attachment, region, quadOffsets);
        computeRegionUVs(region, quadUVs);
        computeOutlineVertices(
            Float64Array.of(2, 2, 42, 32),
            256,
            128,
            quadOffsets,
            quadUVs,
            offsets,
            statics,
            2,
            3,
            4,
        );
        expect(Array.from(offsets.subarray(0, 2))).toEqual([-1, -1]);
        expect(Array.from(offsets.subarray(6))).toEqual([-1, -1]);
        // the top left corner of the region is corner 1 of the quad, the bottom right one corner 3
        expect(Array.from(offsets.subarray(2, 6))).toEqual([
            quadOffsets[2],
            quadOffsets[3],
            quadOffsets[6],
            quadOffsets[7],
        ]);
        expect(Array.from(statics)).toEqual([-1, -1, -1, 2 / 256, 2 / 128, -1, -1, 42 / 256, 32 / 128, -1, -1, -1]);
    });

    it('throws for a quad without area, and does nothing without points', () => {
        const flat = new Float32Array(8);
        const out = new Float32Array(2);

        expect(() => computeOutlineVertices([1, 1], 64, 64, flat, flat, out, out)).toThrow(MarrowError);
        expect(() => computeOutlineVertices([], 64, 64, flat, flat, out, out)).not.toThrow();
    });
});
