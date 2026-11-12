import { MarrowError } from '../base/errors';
import type { PageRect } from '../model/outlines';
import type { AtlasRegion } from './atlas-regions';
import { convexHull, polygonArea, reduceConvexPolygon } from './convex';

/*
 * Tight outlines: a region attachment drawn as a polygon around its visible pixels, not as the
 * full rectangle. Everything here works in pixels of the atlas page, with y down. A region that
 * is rotated inside its page needs no special case that way.
 */

/** The alpha of every pixel of a page, one byte per pixel, rows from the top. */
export type AlphaPixels = Uint8Array | Uint8ClampedArray;

/** Options for {@link computeTightOutline}. */
export interface TightOptions {
    /**
     * The pixels kept around every visible pixel. Default 1. Bilinear filtering needs 0.5: a
     * texel colors the samples up to half a pixel around it. Mipmaps need more. A page drawn at
     * 1/n of its size mixes pixels that are up to 3n apart.
     */
    margin?: number;
    /** The most vertices of the outline, 4 or more. Default 8. */
    maxVertices?: number;
    /** The largest share of the rectangle an outline may cover and still pay off, from 0 to 1. Default 0.9. */
    threshold?: number;
    /** True when the page repeats sideways. A region at the page edge then samples the other edge. */
    repeatX?: boolean;
    /** True when the page repeats up and down. */
    repeatY?: boolean;
}

/** The outline of one region, from {@link computeTightOutline}. */
export interface TightOutline {
    /** The vertices as x, y pairs in page pixels, with a positive shoelace sum. Empty for a region without a visible pixel. */
    polygon: Float64Array;
    /** Three vertex numbers per triangle, as a fan around vertex 0. */
    triangles: Uint16Array;
    /** The share of the region's rectangle that the polygon covers, from 0 to 1. */
    coverage: number;
    /** False when the polygon covers more than the threshold. The quad is then the better choice. */
    worthIt: boolean;
}

const DEFAULT_MARGIN = 1;
const DEFAULT_MAX_VERTICES = 8;
const DEFAULT_THRESHOLD = 0.9;

function badInput(message: string, fix: string): MarrowError {
    return new MarrowError('invalid-data', message, { fix });
}

/**
 * Throws a {@link MarrowError} unless `rect` lies inside a page of `alpha` pixels. The checks of
 * the tight outline and of the opaque rectangle share it.
 *
 * @example
 * checkPageRect(alpha, page.width, page.height, regionPageRect(region));
 */
export function checkPageRect(alpha: AlphaPixels, pageWidth: number, pageHeight: number, rect: PageRect): void {
    const { x, y, width, height } = rect;

    if (!Number.isInteger(pageWidth) || !Number.isInteger(pageHeight) || alpha.length !== pageWidth * pageHeight) {
        throw badInput(
            `A page of ${pageWidth}x${pageHeight} pixels cannot have ${alpha.length} alpha values.`,
            'Pass one alpha byte per pixel, for example from alphaFromRgba.',
        );
    }
    if (![x, y, width, height].every(Number.isInteger) || width < 0 || height < 0) {
        throw badInput(
            `A region cannot be at ${x}, ${y} with a size of ${width}x${height} pixels.`,
            'Pass whole pixels, as regionPageRect gives them.',
        );
    }
    if (x < 0 || y < 0 || x + width > pageWidth || y + height > pageHeight) {
        throw badInput(
            `The region at ${x}, ${y} with ${width}x${height} pixels leaves its page of ${pageWidth}x${pageHeight} pixels.`,
            'Pass the page the region is on. Keep the quad for a region that leaves its page.',
        );
    }
}

/**
 * The alpha of every pixel of an RGBA image, one byte per pixel. On a premultiplied page a pixel
 * with alpha 0 and a color still adds light. Such a pixel gets alpha 1, so that an outline keeps it.
 *
 * @example
 * const alpha = alphaFromRgba(image.data, atlas.pages[0]?.pma ?? false);
 */
export function alphaFromRgba(rgba: Uint8Array | Uint8ClampedArray, pma: boolean): Uint8Array {
    const count = rgba.length >> 2;
    const alpha = new Uint8Array(count);

    for (let i = 0, at = 0; i < count; i++, at += 4) {
        const value = rgba[at + 3] ?? 0;
        const color = (rgba[at] ?? 0) | (rgba[at + 1] ?? 0) | (rgba[at + 2] ?? 0);

        alpha[i] = value === 0 && pma && color !== 0 ? 1 : value;
    }

    return alpha;
}

/**
 * The rectangle a region covers on its page, in pixels. It is the rectangle the texture
 * coordinates of the official runtime span: the sides swap for a rotation of 90 degrees and for
 * no other rotation.
 *
 * @example
 * const rect = regionPageRect(readRegion(atlas, findRegion(atlas, 'head')));
 */
export function regionPageRect(region: AtlasRegion): PageRect {
    const rotated = region.degrees === 90;

    return {
        x: region.x,
        y: region.y,
        width: rotated ? region.height : region.width,
        height: rotated ? region.width : region.height,
    };
}

/** What a scan of the rows of a region needs. */
interface Scan {
    alpha: AlphaPixels;
    pageWidth: number;
    pageHeight: number;
    rect: PageRect;
    /** 1 when the pixels next to the rectangle count: filtering mixes them into the region's edge. */
    ring: number;
    repeatX: boolean;
    repeatY: boolean;
}

/** The index of a row or column on the page, wrapped on a page that repeats. -1 outside the page. */
function wrap(value: number, size: number, repeat: boolean): number {
    if (value >= 0 && value < size) return value;

    return repeat ? ((value % size) + size) % size : -1;
}

/** Whether the pixel in column `x` of the page row that starts at `row` is visible. `x` can lie next to the page. */
function visible(scan: Scan, row: number, x: number): boolean {
    const column = wrap(x, scan.pageWidth, scan.repeatX);

    return column !== -1 && scan.alpha[row + column] !== 0;
}

/** What {@link firstVisible} returns for a row without a visible pixel. No column has this number. */
const EMPTY_ROW = -2;

/** The first visible column of a row, from the left or from the right. {@link EMPTY_ROW} when there is none. */
function firstVisible(scan: Scan, row: number, step: 1 | -1): number {
    const { alpha, rect, ring } = scan;
    const left = rect.x;
    const right = rect.x + rect.width - 1;
    const outerStart = step === 1 ? left - 1 : right + 1;
    const outerEnd = step === 1 ? right + 1 : left - 1;

    if (ring === 1 && visible(scan, row, outerStart)) return outerStart;
    for (let x = step === 1 ? left : right; x >= left && x <= right; x += step) {
        if (alpha[row + x] !== 0) return x;
    }

    return ring === 1 && visible(scan, row, outerEnd) ? outerEnd : EMPTY_ROW;
}

/**
 * Writes the corners of what each row of a region shows: the span from its first to its last
 * visible pixel, grown by the margin and cut to the rectangle. Returns the number of points.
 */
function collectCorners(scan: Scan, margin: number, points: Float64Array): number {
    const { rect, ring } = scan;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    let at = 0;

    for (let y = rect.y - ring; y < bottom + ring; y++) {
        const pageRow = wrap(y, scan.pageHeight, scan.repeatY);

        if (pageRow === -1) continue;
        const row = pageRow * scan.pageWidth;
        const first = firstVisible(scan, row, 1);

        if (first === EMPTY_ROW) continue;
        const x0 = Math.max(rect.x, first - margin);
        const x1 = Math.min(right, firstVisible(scan, row, -1) + 1 + margin);
        const y0 = Math.max(rect.y, y - margin);
        const y1 = Math.min(bottom, y + 1 + margin);

        points[at++] = x0;
        points[at++] = y0;
        points[at++] = x1;
        points[at++] = y0;
        points[at++] = x0;
        points[at++] = y1;
        points[at++] = x1;
        points[at++] = y1;
    }

    return at / 2;
}

/** The triangles of a convex polygon as a fan around vertex 0. */
function fan(vertices: number): Uint16Array {
    const triangles = new Uint16Array(Math.max(0, vertices - 2) * 3);

    for (let i = 0; i < vertices - 2; i++) triangles.set([0, i + 1, i + 2], i * 3);

    return triangles;
}

function checkOptions(margin: number, threshold: number): void {
    if (!Number.isFinite(margin) || margin < 0) {
        throw badInput(`An outline cannot keep a margin of ${margin} pixels.`, 'Pass 0 or more as margin.');
    }
    if (!(threshold >= 0 && threshold <= 1)) {
        throw badInput(`An outline cannot have a threshold of ${threshold}.`, 'Pass a share from 0 to 1 as threshold.');
    }
}

/**
 * Builds the tight outline of a region from the alpha of its page: a convex polygon with few
 * vertices that holds every visible pixel of `rect`, and `margin` pixels around each. It never
 * leaves `rect`. A pixel is visible when its alpha is above 0.
 *
 * With a margin above 0 a visible pixel right next to `rect` counts as well, since filtering
 * mixes it into the edge of the region. The polygon is the hull of all those pixels, reduced to
 * `maxVertices` by {@link reduceConvexPolygon}: it only grows, by the least area.
 *
 * A region without a visible pixel gives an empty polygon: nothing needs to be drawn. `worthIt`
 * is false when the polygon covers more of `rect` than `threshold`. Throws a {@link MarrowError}
 * for a rectangle that leaves the page and for options out of range.
 *
 * @example
 * const alpha = alphaFromRgba(image.data, page.pma);
 * const outline = computeTightOutline(alpha, page.width, page.height, regionPageRect(region));
 * if (outline.worthIt) console.log(outline.polygon, outline.triangles, outline.coverage);
 */
export function computeTightOutline(
    alpha: AlphaPixels,
    pageWidth: number,
    pageHeight: number,
    rect: PageRect,
    options: TightOptions = {},
): TightOutline {
    const margin = options.margin ?? DEFAULT_MARGIN;
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const maxVertices = options.maxVertices ?? DEFAULT_MAX_VERTICES;

    checkPageRect(alpha, pageWidth, pageHeight, rect);
    checkOptions(margin, threshold);
    const scan: Scan = {
        alpha,
        pageWidth,
        pageHeight,
        rect,
        ring: margin > 0 ? 1 : 0,
        repeatX: options.repeatX ?? false,
        repeatY: options.repeatY ?? false,
    };
    const corners = new Float64Array((rect.height + 2) * 8);
    const cornerCount = rect.width > 0 ? collectCorners(scan, margin, corners) : 0;
    const hull = new Float64Array(cornerCount * 2);
    const hullCount = convexHull(corners, cornerCount, hull);
    // a reduced polygon never has more vertices than its hull
    const reduced = new Float64Array(hullCount * 2);
    const count = reduceConvexPolygon(hull, hullCount, maxVertices, reduced);

    // a hull without area cannot come from pixels: it stands for nothing to draw
    if (count < 3) return { polygon: new Float64Array(0), triangles: new Uint16Array(0), coverage: 0, worthIt: true };
    const polygon = reduced.slice(0, count * 2);
    const coverage = Math.min(1, polygonArea(polygon, count) / (rect.width * rect.height));

    return { polygon, triangles: fan(count), coverage, worthIt: coverage <= threshold };
}
