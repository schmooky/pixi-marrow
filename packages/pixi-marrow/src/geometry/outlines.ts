import { MarrowError } from '../base/errors';
import { ATLAS_REGION_STRIDE, type AtlasModel } from '../model/atlas';
import type { AtlasOutlines, PageRect, RegionOutline } from '../model/outlines';
import { readRegion } from './atlas-regions';
import { polygonArea } from './convex';
import { computeOpaqueRect } from './opaque-rect';
import { alphaFromRgba, computeTightOutline, regionPageRect } from './tight';

/*
 * The outlines of a whole atlas: built from the pixels of its pages, or read back from the file
 * the `pixi-marrow outlines` command wrote. No Pixi and no Node here, so the command line tool
 * and the runtime in the browser share it.
 */

/** The format version {@link buildAtlasOutlines} writes and {@link readAtlasOutlines} accepts. */
export const ATLAS_OUTLINES_VERSION = 1;

/** The pixels of one atlas page: four bytes per pixel in the order red, green, blue, alpha, rows from the top. */
export interface PagePixels {
    width: number;
    height: number;
    data: Uint8Array | Uint8ClampedArray;
}

/** Options for {@link buildAtlasOutlines}. Each one is passed on to the function that uses it. */
export interface OutlinesOptions {
    /** The pixels kept around every visible pixel. Default 1. See `TightOptions.margin`. */
    margin?: number;
    /** The most vertices of an outline, 4 or more. Default 8. */
    maxVertices?: number;
    /** The largest share of its rectangle an outline may cover and still replace the quad. Default 0.9. */
    threshold?: number;
    /** The pixels an opaque rectangle stays away from a pixel that is not opaque. Default 1. */
    opaqueMargin?: number;
    /** The least area in pixels of an opaque rectangle that is kept. Default 1024. */
    minOpaqueArea?: number;
}

/** What a set of outlines saves, from {@link summarizeOutlines}. Areas are in pixels of the pages. */
export interface OutlinesSummary {
    /** The regions of the atlas. */
    regions: number;
    /** The regions that are drawn as a polygon. */
    outlined: number;
    /** The regions without a visible pixel. Nothing is drawn for them. */
    empty: number;
    /** The regions with an opaque rectangle. */
    opaque: number;
    /** The pages whose pixels were not read. Their regions have no outline. */
    skippedPages: number;
    /** The area of the quads of all regions on pages that were read. */
    quadArea: number;
    /** The area that is drawn with the outlines: polygons, and quads where no polygon pays off. */
    outlineArea: number;
    /** {@link quadArea} minus {@link outlineArea}: the fill saved when every region is drawn once. */
    savedArea: number;
    /** {@link savedArea} as a share of {@link quadArea}, from 0 to 1. */
    savedShare: number;
}

const FIX = 'Write the file again for this atlas: pixi-marrow outlines <atlas>.';

const insideRect = (inner: PageRect, outer: PageRect): boolean =>
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;

/** The alpha of a page, or a {@link MarrowError} when the pixels are not the image the atlas describes. */
function pageAlpha(atlas: AtlasModel, index: number, pixels: PagePixels): Uint8Array {
    const page = atlas.pages[index];
    const name = page?.name ?? String(index);

    if (page === undefined || pixels.width !== page.width || pixels.height !== page.height) {
        throw new MarrowError(
            'invalid-data',
            `The image of the page "${name}" has ${pixels.width}x${pixels.height} pixels and the atlas states ${page?.width}x${page?.height}.`,
            { fix: 'Pass the images the atlas was exported with, in the order of the pages, at their full size.' },
        );
    }
    if (pixels.data.length !== pixels.width * pixels.height * 4) {
        throw new MarrowError(
            'invalid-data',
            `The image of the page "${name}" has ${pixels.data.length} bytes for ${pixels.width}x${pixels.height} pixels.`,
            { fix: 'Pass four bytes per pixel: red, green, blue, alpha.' },
        );
    }

    return alphaFromRgba(pixels.data, page.pma);
}

/**
 * Builds the outlines of every region of an atlas from the pixels of its pages: the tight
 * polygon of {@link computeTightOutline} and the opaque rectangle of {@link computeOpaqueRect}.
 *
 * `pages` holds the pixels of each atlas page, in page order. A page that is undefined or null
 * is skipped: its regions get null. A region that leaves its page keeps the quad. Throws a
 * {@link MarrowError} for pixels that do not have the size the atlas states.
 *
 * @example
 * const atlas = importAtlas(atlasText);
 * const outlines = buildAtlasOutlines(atlas, [await decodePng(pageBytes)]);
 * console.log(summarizeOutlines(atlas, outlines).savedShare);
 */
export function buildAtlasOutlines(
    atlas: AtlasModel,
    pages: readonly (PagePixels | null | undefined)[],
    options: OutlinesOptions = {},
): AtlasOutlines {
    const margin = options.margin ?? 1;
    const opaqueMargin = options.opaqueMargin ?? 1;
    const tight = {
        margin,
        ...(options.maxVertices === undefined ? {} : { maxVertices: options.maxVertices }),
        ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
    };
    const opaque = {
        margin: opaqueMargin,
        ...(options.minOpaqueArea === undefined ? {} : { minArea: options.minOpaqueArea }),
    };
    const alphas = atlas.pages.map((_, index) => {
        const pixels = pages[index];

        return pixels === undefined || pixels === null ? undefined : pageAlpha(atlas, index, pixels);
    });
    const regions = atlas.regionNames.map((name, index): RegionOutline | null => {
        const region = readRegion(atlas, index);
        const alpha = alphas[region.page];
        const page = atlas.pages[region.page];
        const rect = regionPageRect(region);

        if (alpha === undefined || page === undefined) return null;
        if (!insideRect(rect, { x: 0, y: 0, width: page.width, height: page.height })) {
            return { name, rect, polygon: null, triangles: [], coverage: 1, opaque: null };
        }
        const outline = computeTightOutline(alpha, page.width, page.height, rect, {
            ...tight,
            repeatX: page.repeatX,
            repeatY: page.repeatY,
        });

        return {
            name,
            rect,
            polygon: outline.worthIt ? Array.from(outline.polygon) : null,
            triangles: outline.worthIt ? Array.from(outline.triangles) : [],
            coverage: outline.coverage,
            opaque: computeOpaqueRect(alpha, page.width, page.height, rect, opaque),
        };
    });

    return { version: ATLAS_OUTLINES_VERSION, margin, opaqueMargin, regions };
}

/**
 * Counts what a set of outlines saves: how many regions are drawn as polygons, and the area of
 * the quads against the area of the outlines. Works for outlines that were built and for
 * outlines that were read from a file.
 *
 * @example
 * const summary = summarizeOutlines(atlas, outlines);
 * console.log(`${summary.outlined} of ${summary.regions} regions, ${summary.savedArea} pixels saved`);
 */
export function summarizeOutlines(atlas: AtlasModel, outlines: AtlasOutlines): OutlinesSummary {
    const skipped = new Set<number>();
    const summary: OutlinesSummary = {
        regions: outlines.regions.length,
        outlined: 0,
        empty: 0,
        opaque: 0,
        skippedPages: 0,
        quadArea: 0,
        outlineArea: 0,
        savedArea: 0,
        savedShare: 0,
    };

    outlines.regions.forEach((region, index) => {
        if (region === null) {
            skipped.add(atlas.regions[index * ATLAS_REGION_STRIDE] ?? -1);

            return;
        }
        const quad = region.rect.width * region.rect.height;
        const { polygon } = region;

        summary.quadArea += quad;
        summary.outlineArea += polygon === null ? quad : polygonArea(polygon, polygon.length >> 1);
        if (polygon !== null) summary[polygon.length === 0 ? 'empty' : 'outlined']++;
        if (region.opaque !== null) summary.opaque++;
    });
    summary.skippedPages = skipped.size;
    summary.savedArea = summary.quadArea - summary.outlineArea;
    summary.savedShare = summary.quadArea > 0 ? summary.savedArea / summary.quadArea : 0;

    return summary;
}

function refuse(message: string): MarrowError {
    return new MarrowError('invalid-data', `The outlines file does not fit the atlas: ${message}.`, { fix: FIX });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function numberOf(
    value: unknown,
    what: string,
    least = Number.NEGATIVE_INFINITY,
    most = Number.POSITIVE_INFINITY,
): number {
    if (!isFiniteNumber(value) || value < least || value > most) throw refuse(`${what} is ${JSON.stringify(value)}`);

    return value;
}

function numbersOf(value: unknown, what: string): number[] {
    if (!Array.isArray(value) || !value.every(isFiniteNumber)) throw refuse(`${what} is not a list of numbers`);

    return value;
}

function rectOf(value: unknown, what: string): PageRect {
    if (!isRecord(value)) throw refuse(`${what} is not a rectangle`);

    return {
        x: numberOf(value.x, `x of ${what}`),
        y: numberOf(value.y, `y of ${what}`),
        width: numberOf(value.width, `the width of ${what}`, 0),
        height: numberOf(value.height, `the height of ${what}`, 0),
    };
}

/** The polygon of a region: null, empty, or 3 and more points inside the rectangle of the region. */
function polygonOf(value: unknown, rect: PageRect, what: string): number[] | null {
    if (value === null) return null;
    const polygon = numbersOf(value, `the polygon of ${what}`);
    const inside = polygon.every((number, i) =>
        i % 2 === 0
            ? number >= rect.x && number <= rect.x + rect.width
            : number >= rect.y && number <= rect.y + rect.height,
    );

    if (polygon.length % 2 !== 0 || polygon.length === 2 || polygon.length === 4 || !inside) {
        throw refuse(`the polygon of ${what} is not a list of 3 or more points inside the region`);
    }

    return polygon;
}

function trianglesOf(value: unknown, vertices: number, what: string): number[] {
    const triangles = numbersOf(value, `the triangles of ${what}`);
    const valid = triangles.every((vertex) => Number.isInteger(vertex) && vertex >= 0 && vertex < vertices);

    // a polygon of n vertices has n - 2 triangles, however it is cut
    if (triangles.length !== Math.max(0, vertices - 2) * 3 || !valid) {
        throw refuse(`the triangles of ${what} do not cover its polygon of ${vertices} vertices`);
    }

    return triangles;
}

/** One region of a file, checked against the region of the atlas at the same place. */
function regionOf(value: unknown, atlas: AtlasModel, index: number): RegionOutline | null {
    if (value === null) return null;
    const name = atlas.regionNames[index] ?? '';
    const what = `region ${index} "${name}"`;
    const expected = regionPageRect(readRegion(atlas, index));

    if (!isRecord(value)) throw refuse(`${what} is not an object`);
    if (value.name !== name)
        throw refuse(`region ${index} is "${name}" in the atlas and ${JSON.stringify(value.name)} in the file`);
    const rect = rectOf(value.rect, `the rectangle of ${what}`);

    if (
        rect.x !== expected.x ||
        rect.y !== expected.y ||
        rect.width !== expected.width ||
        rect.height !== expected.height
    ) {
        throw refuse(
            `${what} is at ${expected.x}, ${expected.y} with ${expected.width}x${expected.height} pixels in the atlas ` +
                `and at ${rect.x}, ${rect.y} with ${rect.width}x${rect.height} pixels in the file`,
        );
    }
    const polygon = polygonOf(value.polygon, rect, what);
    const opaque = value.opaque === null ? null : rectOf(value.opaque, `the opaque rectangle of ${what}`);

    if (opaque !== null && !insideRect(opaque, rect)) throw refuse(`the opaque rectangle of ${what} leaves the region`);

    return {
        name,
        rect,
        polygon,
        triangles: trianglesOf(value.triangles, polygon === null ? 0 : polygon.length >> 1, what),
        coverage: numberOf(value.coverage, `the coverage of ${what}`, 0, 1),
        opaque,
    };
}

/**
 * Checks parsed JSON against an atlas and returns it as {@link AtlasOutlines}. Use it on the
 * file the `pixi-marrow outlines` command wrote, before the outlines reach the renderer.
 *
 * The file is refused when its format version is not {@link ATLAS_OUTLINES_VERSION}, or when
 * it has another number of regions. It is refused as well when a region has another name or
 * another rectangle than in the atlas. That is the case for the file of another atlas, and for
 * an atlas that was packed again. Polygons and opaque rectangles must lie inside their region.
 *
 * Throws a {@link MarrowError} that states what does not fit. The result is a new object.
 *
 * @example
 * const atlas = importAtlas(atlasText);
 * const outlines = readAtlasOutlines(JSON.parse(outlinesText), atlas);
 */
export function readAtlasOutlines(json: unknown, atlas: AtlasModel): AtlasOutlines {
    if (!isRecord(json)) throw refuse('it is not an object');
    if (json.version !== ATLAS_OUTLINES_VERSION) {
        throw refuse(
            `it has the format version ${JSON.stringify(json.version)} and this release reads version ${ATLAS_OUTLINES_VERSION}`,
        );
    }
    const { regions } = json;
    const count = atlas.regionNames.length;

    if (!Array.isArray(regions) || regions.length !== count) {
        throw refuse(
            `the atlas has ${count} regions and the file has ${Array.isArray(regions) ? regions.length : 'none'}`,
        );
    }
    return {
        version: ATLAS_OUTLINES_VERSION,
        margin: numberOf(json.margin, 'the margin', 0),
        opaqueMargin: numberOf(json.opaqueMargin, 'the opaque margin', 0),
        regions: regions.map((region: unknown, index) => regionOf(region, atlas, index)),
    };
}
