import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS, type SpineVersion } from '../../src/base/version';
import { importAtlas } from '../../src/formats/atlas';
import { type AtlasRegion, findRegion, readRegion } from '../../src/geometry/atlas-regions';
import { computeRegionOffsets, computeRegionUVs, computeRegionWorldVertices } from '../../src/geometry/region';
import type { RegionAttachmentData } from '../../src/model/attachments';
import { ATLAS_TEXT, DEGREES, regionName } from './synthetic';

/*
 * Numbers worked out by hand. The parity test and the synthetic rig compare the same functions
 * with the official cores bit for bit.
 */

const atlas = importAtlas(ATLAS_TEXT);
const region = (degrees: number, trimmed: boolean): AtlasRegion =>
    readRegion(atlas, findRegion(atlas, regionName(degrees, trimmed)));

/** A region attachment of the size of the whole test image, placed on the bone, unless `changes` says otherwise. */
const attachment = (changes: Partial<RegionAttachmentData> = {}): RegionAttachmentData => ({
    type: 'region',
    name: 'quad',
    path: 'quad',
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    width: 40,
    height: 30,
    color: Float64Array.of(1, 1, 1, 1),
    sequence: null,
    ...changes,
});

function offsets(version: SpineVersion, data: RegionAttachmentData, on: AtlasRegion): number[] {
    const out = new Float64Array(8);

    computeRegionOffsets(version, data, on, out);

    return Array.from(out);
}

describe('computeRegionOffsets', () => {
    it.each(SPINE_VERSIONS)('puts the corners of a whole region around the bone in %s', (version) => {
        // bottom right, bottom left, upper left, upper right in the official naming
        expect(offsets(version, attachment(), region(0, false))).toEqual([-20, -15, -20, 15, 20, 15, 20, -15]);
    });

    it.each(SPINE_VERSIONS)('makes the quad of a trimmed region smaller in %s', (version) => {
        // 36x22 pixels cut from a 44x32 image, 3 from the left and 5 from the bottom
        const whole = attachment({ width: 44, height: 32 });

        expect(offsets(version, whole, region(0, true))).toEqual([-19, -11, -19, 11, 17, 11, 17, -11]);
        // an attachment twice the size of the image scales the trimmed border with it
        expect(offsets(version, attachment({ width: 88, height: 64 }), region(0, true))).toEqual([
            -38, -22, -38, 22, 34, 22, 34, -22,
        ]);
    });

    it.each(SPINE_VERSIONS)('applies the scale and the position of the attachment in %s', (version) => {
        const placed = attachment({ x: 5, y: 7, scaleX: 2, scaleY: -1 });

        expect(offsets(version, placed, region(0, false))).toEqual([-35, 22, -35, -8, 45, -8, 45, 22]);
    });

    it('does not depend on the rotation of the region inside its page', () => {
        const placed = attachment({ x: 3, y: -4, rotation: 25, scaleX: 1.5, width: 44, height: 32 });

        for (const version of SPINE_VERSIONS) {
            for (const trimmed of [false, true]) {
                const upright = offsets(version, placed, region(0, trimmed));

                for (const degrees of DEGREES) {
                    expect(offsets(version, placed, region(degrees, trimmed))).toEqual(upright);
                }
            }
        }
    });

    it('turns the rotation into radians with the full pi in 4.1 and with a pi of 8 digits later', () => {
        const turned = attachment({ x: 1, y: 2, rotation: 180 });
        const v41 = offsets('4.1', turned, region(0, false));
        const v42 = offsets('4.2', turned, region(0, false));
        const v43 = offsets('4.3', turned, region(0, false));

        // the full pi turns the quad by half a turn, up to what 32 bits hold
        expect(v41).toEqual([21, 17, 21, -13, -19, -13, -19, 17]);
        // the shorter pi turns it a little further
        expect(v42).not.toEqual(v41);
        expect(v42[3]).toBeGreaterThan(-13);
        expect(v42[3]).toBeCloseTo(-13, 5);
        // 4.2 and 4.3 do the same math. 4.2 rounds the result to 32 bits.
        expect(v42).toEqual(v43.map(Math.fround));
    });

    it('keeps 32-bit floats for 4.1 and 4.2 and 64-bit numbers for 4.3', () => {
        const turned = attachment({ x: 1.1, y: 2.2, rotation: 33.3, scaleX: 0.7 });
        const is32 = (value: number): boolean => Math.fround(value) === value;

        expect(offsets('4.1', turned, region(0, true)).every(is32)).toBe(true);
        expect(offsets('4.2', turned, region(0, true)).every(is32)).toBe(true);
        expect(offsets('4.3', turned, region(0, true)).some(is32)).toBe(false);
    });

    it('rounds 4.3 offsets when the caller stores them in 32 bits', () => {
        const turned = attachment({ x: 1.1, y: 2.2, rotation: 33.3, scaleX: 0.7 });
        const out = new Float32Array(8);

        computeRegionOffsets('4.3', turned, region(0, true), out);
        expect(Array.from(out)).toEqual(offsets('4.3', turned, region(0, true)).map(Math.fround));
    });

    it('writes one pair every stride numbers from the offset on', () => {
        const out = new Float32Array(14).fill(9);

        computeRegionOffsets('4.2', attachment(), region(0, false), out, 1, 3);
        expect(Array.from(out)).toEqual([9, -20, -15, 9, -20, 15, 9, 20, 15, 9, 20, -15, 9, 9]);
    });
});

describe('computeRegionUVs', () => {
    const uvs = (on: AtlasRegion): number[] => {
        const out = new Float32Array(8);

        computeRegionUVs(on, out);

        return Array.from(out);
    };

    it('maps the corners of an upright region in the order of the offsets', () => {
        // the region is at 2, 2 on a 256x128 page and 40x30 pixels large
        const [u, v, u2, v2] = [2 / 256, 2 / 128, 42 / 256, 32 / 128];

        expect(uvs(region(0, false))).toEqual([u, v2, u, v, u2, v, u2, v2]);
    });

    it('turns the corners of a region rotated by 90 degrees', () => {
        // on the page the region is 30 wide and 40 high
        const [u, v, u2, v2] = [52 / 256, 2 / 128, 82 / 256, 42 / 128];

        expect(uvs(region(90, false))).toEqual([u2, v2, u, v2, u, v, u2, v]);
    });

    it.each([180, 270])(
        'maps a region rotated by %s degrees like an upright one, as the official runtimes do',
        (degrees) => {
            const { u, v, u2, v2 } = region(degrees, false);

            expect(uvs(region(degrees, false))).toEqual([u, v2, u, v, u2, v, u2, v2].map(Math.fround));
        },
    );

    it('stores 32-bit floats', () => {
        const out = new Float64Array(8);
        // coordinates that 32 bits cannot hold
        const [u, v, u2, v2] = [1 / 3, 2 / 3, 1 / 7, 1 / 9];

        computeRegionUVs({ ...region(0, false), u, v, u2, v2 }, out);
        expect(Array.from(out)).toEqual([u, v2, u, v, u2, v, u2, v2].map(Math.fround));
        computeRegionUVs({ ...region(90, false), u, v, u2, v2 }, out);
        expect(Array.from(out)).toEqual([u2, v2, u, v2, u, v, u2, v].map(Math.fround));
    });

    it('writes one pair every stride numbers from the offset on', () => {
        const out = new Float32Array(18).fill(9);
        const simple = { ...region(0, false), u: 0.25, v: 0.5, u2: 0.75, v2: 1 };

        computeRegionUVs(simple, out, 2, 4);
        expect(Array.from(out)).toEqual([9, 9, 0.25, 1, 9, 9, 0.25, 0.5, 9, 9, 0.75, 0.5, 9, 9, 0.75, 1, 9, 9]);
    });
});

describe('computeRegionWorldVertices', () => {
    // two bones: the first is not moved, the second is turned by a quarter and moved to 10, 20
    const world = Float64Array.of(1, 0, 0, 1, 0, 0, 0, -1, 1, 0, 10, 20);
    const quad = Float32Array.of(-20, -15, -20, 15, 20, 15, 20, -15);

    it('places the corners with the world transform of the bone', () => {
        const out = new Float32Array(8);

        computeRegionWorldVertices(quad, 0, world, 0, out);
        expect(Array.from(out)).toEqual([-20, -15, -20, 15, 20, 15, 20, -15]);
        computeRegionWorldVertices(quad, 0, world, 1, out);
        expect(Array.from(out)).toEqual([25, 0, -5, 0, -5, 40, 25, 40]);
    });

    it('reads the offsets of one sequence index from an array that holds several', () => {
        const several = Float64Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8);
        const out = new Float64Array(8);

        computeRegionWorldVertices(several, 8, world, 1, out);
        expect(Array.from(out)).toEqual([8, 21, 6, 23, 4, 25, 2, 27]);
    });

    it('writes one pair every stride numbers from the offset on', () => {
        const out = new Float32Array(13).fill(9);

        computeRegionWorldVertices(quad, 0, world, 1, out, 1, 3);
        expect(Array.from(out)).toEqual([9, 25, 0, 9, -5, 0, 9, -5, 40, 9, 25, 40, 9]);
    });
});
