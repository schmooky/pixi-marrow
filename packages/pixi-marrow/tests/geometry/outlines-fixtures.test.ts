import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS, type SpineVersion } from '../../src/base/version';
import { type AtlasRegion, readRegion } from '../../src/geometry/atlas-regions';
import { polygonArea } from '../../src/geometry/convex';
import { computeOpaqueRect } from '../../src/geometry/opaque-rect';
import { computeOutlineVertices } from '../../src/geometry/outline-vertices';
import { buildAtlasOutlines, readAtlasOutlines, summarizeOutlines } from '../../src/geometry/outlines';
import { computeRegionOffsets, computeRegionUVs } from '../../src/geometry/region';
import { computeTightOutline } from '../../src/geometry/tight';
import type { AtlasModel } from '../../src/model/atlas';
import type { RegionAttachmentData } from '../../src/model/attachments';
import type { PageRect } from '../../src/model/outlines';
import type { PngImage } from '../../src/optimize/png';
import {
    anyVisible,
    bruteOpaqueArea,
    findCutPixel,
    isConvex,
    isOpaque,
    listAtlasFixtures,
    loadAtlasFixture,
    seeded,
    triangleArea,
} from './outline-checks';

/*
 * The proof on real art: every region of every fixture atlas that has its page images. The
 * expectations are worked out here from the decoded pixels, pixel by pixel.
 */

const MARGIN = 1;
const MAX_VERTICES = 8;
/** Regions up to this many pixels get the search of every rectangle. */
const BRUTE_LIMIT = 1600;
const TIMEOUT = 120_000;

/** The alpha of a page as the renderer sees it: on a premultiplied page a color without alpha still shows. */
function alphaOf(image: PngImage, pma: boolean): Uint8Array {
    const alpha = new Uint8Array(image.width * image.height);

    for (let i = 0; i < alpha.length; i++) {
        const [r = 0, g = 0, b = 0, a = 0] = image.data.subarray(i * 4, i * 4 + 4);

        alpha[i] = a === 0 && pma && r + g + b > 0 ? 1 : a;
    }

    return alpha;
}

/** A region with the rectangle its texture coordinates span on the page, and the alpha of that page. */
interface Case {
    index: number;
    name: string;
    degrees: number;
    rect: PageRect;
    alpha: Uint8Array;
    pageWidth: number;
    pageHeight: number;
    /** False for a region whose rectangle leaves the page. */
    onPage: boolean;
}

function casesOf(atlas: AtlasModel, pages: PngImage[]): Case[] {
    const alphas = pages.map((image, i) => alphaOf(image, atlas.pages[i]?.pma ?? false));

    return atlas.regionNames.map((name, index) => {
        const region = readRegion(atlas, index);
        const x = Math.round(region.u * region.pageWidth);
        const y = Math.round(region.v * region.pageHeight);
        const rect = {
            x,
            y,
            width: Math.round(region.u2 * region.pageWidth) - x,
            height: Math.round(region.v2 * region.pageHeight) - y,
        };
        const alpha = alphas[region.page];

        if (alpha === undefined) throw new Error(`no page for ${name}`);

        return {
            index,
            name,
            degrees: region.degrees,
            rect,
            alpha,
            pageWidth: region.pageWidth,
            pageHeight: region.pageHeight,
            onPage: x >= 0 && y >= 0 && x + rect.width <= region.pageWidth && y + rect.height <= region.pageHeight,
        };
    });
}

const seenDegrees = new Set<number>();

/** The value at s, t of a quantity given at the four corners of a quad, in the order of the quad. */
const bilinear = (corners: ArrayLike<number>, at: number, s: number, t: number): number =>
    (1 - s) * (1 - t) * (corners[at] ?? 0) +
    s * (1 - t) * (corners[2 + at] ?? 0) +
    s * t * (corners[4 + at] ?? 0) +
    (1 - s) * t * (corners[6 + at] ?? 0);

/**
 * Puts a region attachment of any size and rotation on a region. Then compares what
 * computeOutlineVertices gives for random places on the page with the corners of the quad,
 * mixed by how far each place lies along the two sides.
 */
function expectQuadMapping(
    version: SpineVersion,
    region: AtlasRegion,
    rect: PageRect,
    name: string,
    random: () => number,
): void {
    const attachment: RegionAttachmentData = {
        type: 'region',
        name,
        path: name,
        x: random() * 40 - 20,
        y: random() * 40 - 20,
        scaleX: 0.5 + random(),
        scaleY: 0.5 + random(),
        rotation: random() * 360,
        width: region.originalWidth,
        height: region.originalHeight,
        color: Float64Array.of(1, 1, 1, 1),
        sequence: null,
    };
    const quadOffsets = version === '4.3' ? new Float64Array(8) : new Float32Array(8);
    const quadUVs = new Float32Array(8);
    const places = Array.from({ length: 16 }, () => random());
    const points = new Float64Array(places.length);
    const offsets = new Float64Array(places.length);
    const uvs = new Float64Array(places.length);

    computeRegionOffsets(version, attachment, region, quadOffsets);
    computeRegionUVs(region, quadUVs);
    for (let i = 0; i < places.length; i += 2) {
        const x = bilinear(quadUVs, 0, places[i] ?? 0, places[i + 1] ?? 0) * region.pageWidth;
        const y = bilinear(quadUVs, 1, places[i] ?? 0, places[i + 1] ?? 0) * region.pageHeight;

        points[i] = x;
        points[i + 1] = y;
        // the quad spans the rectangle of the region on the page
        expect(x >= rect.x - 1e-3 && x <= rect.x + rect.width + 1e-3, name).toBe(true);
        expect(y >= rect.y - 1e-3 && y <= rect.y + rect.height + 1e-3, name).toBe(true);
    }
    computeOutlineVertices(points, region.pageWidth, region.pageHeight, quadOffsets, quadUVs, offsets, uvs);
    for (let i = 0; i < places.length; i += 2) {
        const s = places[i] ?? 0;
        const t = places[i + 1] ?? 0;

        expect(offsets[i], name).toBeCloseTo(bilinear(quadOffsets, 0, s, t), 3);
        expect(offsets[i + 1], name).toBeCloseTo(bilinear(quadOffsets, 1, s, t), 3);
        expect(uvs[i], name).toBeCloseTo(bilinear(quadUVs, 0, s, t), 9);
        expect(uvs[i + 1], name).toBeCloseTo(bilinear(quadUVs, 1, s, t), 9);
    }
}

describe.each(listAtlasFixtures())('the outlines of $id', (fixture) => {
    it(
        'hold every visible pixel with its margin, inside the region, in at most 8 vertices',
        async () => {
            const { atlas, pages } = await loadAtlasFixture(fixture);
            const built = buildAtlasOutlines(atlas, pages);

            expect(built.regions).toHaveLength(atlas.regionNames.length);
            for (const { index, name, rect, alpha, pageWidth, pageHeight, onPage } of casesOf(atlas, pages)) {
                const stored = built.regions[index];

                expect(stored?.name, name).toBe(name);
                expect(stored?.rect, name).toEqual(rect);
                if (!onPage) {
                    expect(stored?.polygon, name).toBeNull();
                    continue;
                }
                const outline = computeTightOutline(alpha, pageWidth, pageHeight, rect);
                const { polygon, triangles } = outline;
                const count = polygon.length / 2;

                // what the file holds is this outline, or null where it does not pay off
                expect(stored?.polygon, name).toEqual(outline.worthIt ? Array.from(polygon) : null);
                expect(stored?.coverage, name).toBe(outline.coverage);
                expect(outline.worthIt, name).toBe(outline.coverage <= 0.9);
                if (count === 0) {
                    expect(anyVisible(alpha, pageWidth, pageHeight, rect, 1), name).toBe(false);
                    continue;
                }
                expect(findCutPixel(alpha, pageWidth, pageHeight, rect, MARGIN, polygon), name).toBeNull();
                expect(count, name).toBeLessThanOrEqual(MAX_VERTICES);
                expect(isConvex(polygon), name).toBe(true);
                for (let i = 0; i < count; i++) {
                    const x = polygon[i * 2] ?? Number.NaN;
                    const y = polygon[i * 2 + 1] ?? Number.NaN;

                    expect(
                        x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
                        name,
                    ).toBe(true);
                }
                // a fan of triangles that turn the same way and have the area of the polygon covers it once
                expect(Array.from(triangles), name).toEqual(
                    Array.from({ length: count - 2 }, (_, i) => [0, i + 1, i + 2]).flat(),
                );
                expect(triangleArea(polygon, triangles), name).toBeCloseTo(polygonArea(polygon, count), 6);
                expect(outline.coverage, name).toBeCloseTo(
                    polygonArea(polygon, count) / (rect.width * rect.height),
                    12,
                );
            }
        },
        TIMEOUT,
    );

    it(
        'have opaque rectangles of alpha 255 only, and the largest ones',
        async () => {
            const { atlas, pages } = await loadAtlasFixture(fixture);
            const built = buildAtlasOutlines(atlas, pages);

            for (const { index, name, rect, alpha, pageWidth, pageHeight, onPage } of casesOf(atlas, pages)) {
                if (!onPage) continue;
                const found = computeOpaqueRect(alpha, pageWidth, pageHeight, rect, { minArea: 0 });
                const area = found === null ? 0 : found.width * found.height;

                if (found !== null) {
                    expect(isOpaque(alpha, pageWidth, found, MARGIN), name).toBe(true);
                    expect(
                        found.x - MARGIN >= rect.x && found.x + found.width + MARGIN <= rect.x + rect.width,
                        name,
                    ).toBe(true);
                    expect(
                        found.y - MARGIN >= rect.y && found.y + found.height + MARGIN <= rect.y + rect.height,
                        name,
                    ).toBe(true);
                }
                if (rect.width * rect.height <= BRUTE_LIMIT) {
                    expect(area, name).toBe(bruteOpaqueArea(alpha, pageWidth, rect, MARGIN));
                }
                // the file holds the same rectangle when it has the least area
                expect(built.regions[index]?.opaque, name).toEqual(area >= 1024 ? found : null);
            }
        },
        TIMEOUT,
    );

    it(
        'map to the offsets and texture coordinates of the quad, for every rotation',
        async () => {
            const { atlas, pages } = await loadAtlasFixture(fixture);
            const version = SPINE_VERSIONS.find((candidate) => fixture.id.startsWith(candidate)) ?? '4.2';
            const random = seeded(atlas.regionNames.length);

            for (const { index, name, degrees, rect } of casesOf(atlas, pages)) {
                seenDegrees.add(degrees);
                expectQuadMapping(version, readRegion(atlas, index), rect, name, random);
            }
        },
        TIMEOUT,
    );

    it(
        'survive JSON, pass the reader and save area',
        async () => {
            const { atlas, pages } = await loadAtlasFixture(fixture);
            const built = buildAtlasOutlines(atlas, pages);
            const summary = summarizeOutlines(atlas, built);

            expect(JSON.parse(JSON.stringify(built))).toEqual(built);
            expect(readAtlasOutlines(JSON.parse(JSON.stringify(built)), atlas)).toEqual(built);
            expect(summary.regions).toBe(atlas.regionNames.length);
            expect(summary.skippedPages).toBe(0);
            expect(summary.outlined).toBeGreaterThan(0);
            expect(summary.savedArea).toBeGreaterThan(0);
            expect(summary.outlineArea).toBeLessThan(summary.quadArea);
        },
        TIMEOUT,
    );
});

describe('the fixture atlases', () => {
    it('have regions of every rotation', () => {
        expect([...seenDegrees].sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    });
});
