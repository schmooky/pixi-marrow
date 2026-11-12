import { MarrowError } from '../base/errors';
import type { PageRect } from '../model/outlines';
import { type AlphaPixels, checkPageRect } from './tight';

/*
 * The opaque part of a region: the largest rectangle of pixels with full alpha. It is found
 * once, from the alpha of the page. What it hides is tested every frame in occlusion.ts.
 */

/** Options for {@link computeOpaqueRect}. */
export interface OpaqueOptions {
    /**
     * The pixels the rectangle stays away from every pixel that is not opaque. Default 1.
     * Bilinear filtering needs 0.5: a sample mixes the texels up to half a pixel around it.
     * Mipmaps need more. A page drawn at 1/n of its size mixes pixels that are up to 3n apart.
     */
    margin?: number;
    /** The least area in pixels, after the margin, of a rectangle that is worth a test. Default 1024. */
    minArea?: number;
}

const DEFAULT_MARGIN = 1;
const DEFAULT_MIN_AREA = 1024;
const OPAQUE = 255;

/** The best rectangle so far, in pixels of the region. */
interface Best {
    area: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Keeps a rectangle of opaque pixels when more of it is left after the margin than of the best so far. */
function keepLarger(best: Best, x: number, y: number, width: number, height: number, shrink: number): void {
    const area = (width - shrink) * (height - shrink);

    if (width <= shrink || height <= shrink || area <= best.area) return;
    best.area = area;
    best.x = x;
    best.y = y;
    best.width = width;
    best.height = height;
}

/**
 * Looks at every largest rectangle whose last row is `y`. `heights` holds, per column, how many
 * opaque pixels end on that row without a gap. Column `width` has height 0 and closes every run.
 * The stack holds columns of rising height: a column that is lower ends the rectangles of the
 * higher ones before it.
 */
function closeRuns(heights: Int32Array, stack: Int32Array, width: number, y: number, shrink: number, best: Best): void {
    let size = 0;

    for (let x = 0; x <= width; x++) {
        const current = heights[x] ?? 0;

        while (size > 0 && (heights[stack[size - 1] ?? 0] ?? 0) >= current) {
            const run = heights[stack[--size] ?? 0] ?? 0;
            const left = size > 0 ? (stack[size - 1] ?? 0) + 1 : 0;

            keepLarger(best, left, y - run + 1, x - left, run, shrink);
        }
        stack[size++] = x;
    }
}

/**
 * Finds the largest rectangle of a region in which every pixel has alpha 255, made smaller by
 * `margin` on every side. Returns null when its area is below `minArea`. Whatever is drawn
 * behind such a rectangle, with normal blending at full alpha, cannot be seen.
 *
 * The answer is exact: no rectangle of opaque pixels is larger after the margin is taken off.
 * The search is the largest rectangle in a binary matrix. Each row adds to a histogram of opaque
 * run heights, and a stack finds the best rectangle that ends on the row. The time is linear in
 * the pixel count of `rect`.
 *
 * The result is in page pixels and lies inside `rect`. Throws a {@link MarrowError} for a
 * rectangle that leaves the page and for options out of range.
 *
 * @example
 * const alpha = alphaFromRgba(image.data, page.pma);
 * const opaque = computeOpaqueRect(alpha, page.width, page.height, regionPageRect(region));
 * if (opaque !== null) console.log(opaque.x, opaque.y, opaque.width, opaque.height);
 */
export function computeOpaqueRect(
    alpha: AlphaPixels,
    pageWidth: number,
    pageHeight: number,
    rect: PageRect,
    options: OpaqueOptions = {},
): PageRect | null {
    const margin = options.margin ?? DEFAULT_MARGIN;
    const minArea = options.minArea ?? DEFAULT_MIN_AREA;

    checkPageRect(alpha, pageWidth, pageHeight, rect);
    if (!Number.isFinite(margin) || margin < 0 || Number.isNaN(minArea)) {
        throw new MarrowError(
            'invalid-data',
            `An opaque rectangle cannot have a margin of ${margin} pixels and a least area of ${minArea}.`,
            { fix: 'Pass 0 or more as margin and a number as minArea.' },
        );
    }
    const { width, height } = rect;
    const heights = new Int32Array(width + 1);
    const stack = new Int32Array(width + 1);
    const best: Best = { area: 0, x: 0, y: 0, width: 0, height: 0 };
    const shrink = margin * 2;

    for (let y = 0; y < height; y++) {
        const row = (rect.y + y) * pageWidth + rect.x;

        for (let x = 0; x < width; x++) heights[x] = alpha[row + x] === OPAQUE ? (heights[x] ?? 0) + 1 : 0;
        closeRuns(heights, stack, width, y, shrink, best);
    }
    if (best.area <= 0 || best.area < minArea) return null;

    return {
        x: rect.x + best.x + margin,
        y: rect.y + best.y + margin,
        width: best.width - shrink,
        height: best.height - shrink,
    };
}
