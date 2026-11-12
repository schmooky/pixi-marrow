import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { importAtlas } from '../../src/formats/atlas';
import {
    ATLAS_OUTLINES_VERSION,
    buildAtlasOutlines,
    type PagePixels,
    readAtlasOutlines,
    summarizeOutlines,
} from '../../src/geometry/outlines';
import type { AtlasOutlines } from '../../src/model/outlines';

/*
 * A small atlas whose pixels are painted here, so that every number below can be worked out by
 * hand: two pages, a region rotated by 90 degrees, and one region that leaves its page.
 */
const ATLAS_TEXT = [
    'a.png',
    'size: 128, 64',
    'filter: Linear, Linear',
    'disc',
    'bounds: 2, 2, 40, 40',
    'block',
    'bounds: 50, 2, 60, 40',
    'nothing',
    'bounds: 2, 50, 20, 10',
    'turned',
    'bounds: 30, 46, 16, 30',
    'rotate: 90',
    'outside',
    'bounds: 120, 50, 20, 10',
    '',
    'b.png',
    'size: 32, 32',
    'filter: Linear, Linear',
    'pma: true',
    'glow',
    'bounds: 4, 4, 20, 20',
    '',
].join('\n');
const atlas = importAtlas(ATLAS_TEXT);

/** An RGBA page. `alphaAt` gives the alpha, and the color is white where alpha is above 0. */
function pixels(width: number, height: number, alphaAt: (x: number, y: number) => number): PagePixels {
    const data = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const alpha = alphaAt(x, y);

            data.set([alpha && 255, alpha && 255, alpha && 255, alpha], (y * width + x) * 4);
        }
    }

    return { width, height, data };
}

const inBox = (x: number, y: number, left: number, top: number, width: number, height: number): boolean =>
    x >= left && x < left + width && y >= top && y < top + height;

/** Page a: a disc of radius 18 in "disc", a full "block", a triangle in "turned", nothing else. */
const pageA = pixels(128, 64, (x, y) => {
    if (Math.hypot(x + 0.5 - 22, y + 0.5 - 22) < 18) return 200;
    if (inBox(x, y, 50, 2, 60, 40)) return 255;
    if (inBox(x, y, 30, 46, 30, 16) && x - 30 + (y - 46) < 14) return 255;

    return 0;
});
/** Page b: fully transparent, with one pixel that has a color and no alpha. */
const pageB = pixels(32, 32, () => 0);

pageB.data[(10 * 32 + 12) * 4 + 1] = 90;

const built = buildAtlasOutlines(atlas, [pageA, pageB]);
const regionOf = (outlines: AtlasOutlines, name: string) => {
    const region = outlines.regions[atlas.regionNames.indexOf(name)];

    if (region === null || region === undefined) throw new Error(`no outline for ${name}`);

    return region;
};

describe('buildAtlasOutlines', () => {
    it('gives one item per region, with the name and the rectangle on the page', () => {
        expect(built.version).toBe(ATLAS_OUTLINES_VERSION);
        expect(built.margin).toBe(1);
        expect(built.opaqueMargin).toBe(1);
        expect(built.regions.map((region) => region?.name)).toEqual(atlas.regionNames);
        expect(regionOf(built, 'disc').rect).toEqual({ x: 2, y: 2, width: 40, height: 40 });
        // a region rotated by 90 degrees covers its height times its width on the page
        expect(regionOf(built, 'turned').rect).toEqual({ x: 30, y: 46, width: 30, height: 16 });
    });

    it('draws a disc as an octagon and a triangle as a triangle with its margin', () => {
        const disc = regionOf(built, 'disc');
        const turned = regionOf(built, 'turned');

        expect(disc.polygon).toHaveLength(16);
        expect(disc.triangles).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 7]);
        // more than the disc itself, and less than the octagon around a circle that touches the rectangle
        expect(disc.coverage).toBeGreaterThan((Math.PI * 18 * 18) / 1600);
        expect(disc.coverage).toBeLessThan(0.828);
        // the triangle has legs of 14 pixels. The margin moves its long side out and cuts its two tips.
        expect(turned.polygon).toEqual([30, 46, 45, 46, 45, 48, 32, 61, 30, 61]);
        expect(turned.triangles).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4]);
    });

    it('keeps the quad where the outline saves too little, and draws nothing for an empty region', () => {
        expect(regionOf(built, 'block')).toMatchObject({ polygon: null, triangles: [], coverage: 1 });
        expect(regionOf(built, 'nothing')).toMatchObject({ polygon: [], triangles: [], coverage: 0, opaque: null });
        expect(regionOf(buildAtlasOutlines(atlas, [pageA, pageB], { threshold: 0.5 }), 'disc').polygon).toBeNull();
        expect(regionOf(buildAtlasOutlines(atlas, [pageA, pageB], { threshold: 1 }), 'block').polygon).toHaveLength(8);
    });

    it('finds the opaque rectangle of a region that has one large enough', () => {
        expect(regionOf(built, 'block').opaque).toEqual({ x: 51, y: 3, width: 58, height: 38 });
        // alpha 200 is not opaque, and the triangle is too small
        expect(regionOf(built, 'disc').opaque).toBeNull();
        expect(regionOf(built, 'turned').opaque).toBeNull();
        // of the rectangles in the triangle, 8x7 pixels keep the most after the margin
        expect(regionOf(buildAtlasOutlines(atlas, [pageA, pageB], { minOpaqueArea: 20 }), 'turned').opaque).toEqual({
            x: 31,
            y: 47,
            width: 6,
            height: 5,
        });
    });

    it('passes the options on', () => {
        const options = { margin: 3, maxVertices: 5, threshold: 1, opaqueMargin: 4 };
        const wide = buildAtlasOutlines(atlas, [pageA, pageB], options);

        expect(wide.margin).toBe(3);
        expect(wide.opaqueMargin).toBe(4);
        expect(regionOf(wide, 'disc').polygon?.length).toBeLessThanOrEqual(10);
        expect(regionOf(wide, 'block').opaque).toEqual({ x: 54, y: 6, width: 52, height: 32 });
        expect(regionOf(wide, 'turned').polygon).toEqual([30, 46, 47, 46, 47, 50, 35, 62, 30, 62]);
    });

    it('keeps the quad of a region that leaves its page', () => {
        expect(regionOf(built, 'outside')).toEqual({
            name: 'outside',
            rect: { x: 120, y: 50, width: 20, height: 10 },
            polygon: null,
            triangles: [],
            coverage: 1,
            opaque: null,
        });
    });

    it('keeps a color without alpha on a premultiplied page, where it adds light', () => {
        expect(regionOf(built, 'glow').polygon).toEqual([11, 9, 14, 9, 14, 12, 11, 12]);
        // the same pixels on a page that is not premultiplied show nothing
        const straight = importAtlas(ATLAS_TEXT.replace('pma: true\n', ''));

        expect(regionOf(buildAtlasOutlines(straight, [pageA, pageB]), 'glow').polygon).toEqual([]);
    });

    it('skips a page without pixels: its regions get null', () => {
        const onlyB = buildAtlasOutlines(atlas, [undefined, pageB]);
        const nullA = buildAtlasOutlines(atlas, [null, pageB]);
        const none = buildAtlasOutlines(atlas, []);

        expect(onlyB.regions.map((region) => region?.name ?? null)).toEqual([null, null, null, null, null, 'glow']);
        expect(nullA).toEqual(onlyB);
        expect(none.regions).toEqual([null, null, null, null, null, null]);
        expect(summarizeOutlines(atlas, onlyB).skippedPages).toBe(1);
        expect(summarizeOutlines(atlas, none).skippedPages).toBe(2);
        expect(summarizeOutlines(atlas, built).skippedPages).toBe(0);
    });

    it('throws for pixels that are not the image the atlas describes', () => {
        const small = pixels(64, 64, () => 255);
        const short = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 3) };

        expect(() => buildAtlasOutlines(atlas, [small, pageB])).toThrow(
            'The image of the page "a.png" has 64x64 pixels and the atlas states 128x64.',
        );
        expect(() => buildAtlasOutlines(atlas, [pageA, short])).toThrow(/has 3072 bytes for 32x32 pixels/);
        expect(() => buildAtlasOutlines(atlas, [pageA, pageB], { maxVertices: 2 })).toThrow(MarrowError);
    });

    it('reads the pixels of a canvas as well', () => {
        const clamped = { ...pageA, data: new Uint8ClampedArray(pageA.data) };

        expect(buildAtlasOutlines(atlas, [clamped, pageB])).toEqual(built);
    });
});

describe('summarizeOutlines', () => {
    it('counts the regions and the area that the outlines save', () => {
        const summary = summarizeOutlines(atlas, built);
        const disc = regionOf(built, 'disc').coverage * 1600;
        // disc, block, nothing, turned, outside, glow
        const quads = 1600 + 2400 + 200 + 480 + 200 + 400;
        // the outline of "turned" is a square of 15 pixels without a corner of 13 pixels
        const drawn = disc + 2400 + 0 + (15 * 15 - (13 * 13) / 2) + 200 + 9;

        expect(summary.regions).toBe(6);
        expect(summary.outlined).toBe(3);
        expect(summary.empty).toBe(1);
        expect(summary.opaque).toBe(1);
        expect(summary.quadArea).toBe(quads);
        expect(summary.outlineArea).toBeCloseTo(drawn, 9);
        expect(summary.savedArea).toBeCloseTo(quads - drawn, 9);
        expect(summary.savedShare).toBeCloseTo((quads - drawn) / quads, 12);
    });

    it('gives zeros for an atlas whose pages were all skipped', () => {
        expect(summarizeOutlines(atlas, buildAtlasOutlines(atlas, []))).toEqual({
            regions: 6,
            outlined: 0,
            empty: 0,
            opaque: 0,
            skippedPages: 2,
            quadArea: 0,
            outlineArea: 0,
            savedArea: 0,
            savedShare: 0,
        });
    });
});

describe('readAtlasOutlines', () => {
    const parsed = (): AtlasOutlines => JSON.parse(JSON.stringify(built));
    /** The error for a file that was changed by `damage`. */
    function refusal(damage: (file: AtlasOutlines) => unknown): MarrowError {
        const file = parsed();
        const result = damage(file);

        try {
            readAtlasOutlines(result === undefined ? file : result, atlas);
        } catch (error) {
            if (error instanceof MarrowError) return error;
        }
        throw new Error('the file was not refused');
    }

    it('accepts what the builder made, after a round through JSON', () => {
        expect(parsed()).toEqual(built);
        expect(readAtlasOutlines(parsed(), atlas)).toEqual(built);
        expect(
            readAtlasOutlines(JSON.parse(JSON.stringify(buildAtlasOutlines(atlas, [undefined, pageB]))), atlas)
                .regions[0],
        ).toBeNull();
    });

    it('returns a new object and drops what the format does not have', () => {
        const file = { ...parsed(), note: 'made by hand' };
        const read = readAtlasOutlines(file, atlas);

        expect(read).not.toBe(file);
        expect(read).toEqual(built);
    });

    it('refuses another format version, and names the command that writes the file', () => {
        const error = refusal((file) => ({ ...file, version: 2 }));

        expect(error.code).toBe('invalid-data');
        expect(error.message).toContain('it has the format version 2 and this release reads version 1');
        expect(error.fix).toBe('Write the file again for this atlas: pixi-marrow outlines <atlas>.');
        expect(refusal((file) => ({ ...file, version: undefined })).message).toContain('format version undefined');
    });

    it('refuses the file of another atlas: other regions, names or rectangles', () => {
        const other = importAtlas(ATLAS_TEXT.replace('bounds: 2, 2, 40, 40', 'bounds: 3, 2, 40, 40'));
        const renamed = importAtlas(ATLAS_TEXT.replace('disc', 'disk'));
        const shorter = importAtlas(ATLAS_TEXT.replace('nothing\nbounds: 2, 50, 20, 10\n', ''));

        expect(() => readAtlasOutlines(parsed(), other)).toThrow(
            'region 0 "disc" is at 3, 2 with 40x40 pixels in the atlas and at 2, 2 with 40x40 pixels in the file',
        );
        expect(() => readAtlasOutlines(parsed(), renamed)).toThrow(
            'region 0 is "disk" in the atlas and "disc" in the file',
        );
        expect(() => readAtlasOutlines(parsed(), shorter)).toThrow('the atlas has 5 regions and the file has 6');
        expect(refusal((file) => ({ ...file, regions: undefined })).message).toContain('the file has none');
        // a region that was turned by the packer has another rectangle on the page
        expect(() => readAtlasOutlines(parsed(), importAtlas(ATLAS_TEXT.replace('rotate: 90\n', '')))).toThrow(
            /region 3 "turned" is at 30, 46 with 16x30 pixels in the atlas/,
        );
    });

    it('refuses data that is not what the format holds', () => {
        /** The file with other values in one region. */
        const change = (file: AtlasOutlines, index: number, values: Record<string, unknown>): unknown => ({
            ...file,
            regions: file.regions.map((region, i) => (i === index ? { ...region, ...values } : region)),
        });
        const cases: [(file: AtlasOutlines) => unknown, string][] = [
            [() => null, 'it is not an object'],
            [() => [], 'it is not an object'],
            [(file) => ({ ...file, margin: -1 }), 'the margin is -1'],
            [(file) => ({ ...file, opaqueMargin: '1' }), 'the opaque margin is "1"'],
            [(file) => change(file, 0, { polygon: [2, 2, 40, 2, 40] }), 'the polygon of region 0 "disc"'],
            [(file) => change(file, 0, { polygon: [2, 2, 43, 2, 40, 30] }), 'points inside the region'],
            [(file) => change(file, 0, { polygon: 'round' }), 'is not a list of numbers'],
            [(file) => change(file, 0, { triangles: [0, 1, 8] }), 'the triangles of region 0 "disc"'],
            [(file) => change(file, 1, { triangles: [0, 1, 2] }), 'do not cover its polygon of 0 vertices'],
            [(file) => change(file, 0, { coverage: 1.5 }), 'the coverage of region 0 "disc" is 1.5'],
            [(file) => change(file, 1, { opaque: { x: 51, y: 3, width: 60, height: 38 } }), 'leaves the region'],
            [(file) => change(file, 1, { opaque: { x: 51, y: 3, width: 58 } }), 'the height of the opaque rectangle'],
            [(file) => change(file, 1, { opaque: 5 }), 'is not a rectangle'],
            [(file) => change(file, 1, { rect: null }), 'the rectangle of region 1 "block" is not a rectangle'],
            [(file) => ({ ...file, regions: file.regions.map(() => 7) }), 'region 0 "disc" is not an object'],
        ];

        for (const [damage, message] of cases) {
            const error = refusal(damage);

            expect(error.message).toContain(message);
            expect(error.message).toContain('The outlines file does not fit the atlas');
            expect(error.fix).toContain('pixi-marrow outlines');
        }
    });
});
