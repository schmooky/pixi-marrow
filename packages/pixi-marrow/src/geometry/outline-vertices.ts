import { MarrowError } from '../base/errors';
import { type FloatArray, float } from './read';

/*
 * The one piece of tight outlines that runs in the game: placing the points of an outline on a
 * region attachment. The outlines themselves are built in tight.ts, which a game loads only
 * when it reads page pixels.
 */

/**
 * Turns points on an atlas page into vertices of a region attachment: per point the offset from
 * the bone and the texture coordinates. This is what a tight outline needs to be drawn in place
 * of the quad. The four corners of an opaque rectangle go through it the same way.
 *
 * `quadOffsets` holds the 8 numbers of `computeRegionOffsets` and `quadUVs` the 8 numbers of
 * `computeRegionUVs`. The quad is a parallelogram, so the way from a page position to an offset
 * is affine. Three corners define it. The rotation of the region inside its page is part of the
 * quad's UVs and needs no special case.
 *
 * `points` holds x, y pairs in page pixels. Offsets are written as x, y pairs from `offsetsAt`
 * on. One u, v pair is written every `uvStride` numbers from `uvsAt` on. Nothing is allocated.
 * Throws a {@link MarrowError} for a quad without area.
 *
 * @example
 * const offsets = new Float32Array(outline.polygon.length);
 * const uvs = new Float32Array(outline.polygon.length);
 * computeOutlineVertices(outline.polygon, page.width, page.height, quadOffsets, quadUVs, offsets, uvs);
 */
export function computeOutlineVertices(
    points: ArrayLike<number>,
    pageWidth: number,
    pageHeight: number,
    quadOffsets: FloatArray,
    quadUVs: FloatArray,
    outOffsets: FloatArray,
    outUVs: FloatArray,
    offsetsAt = 0,
    uvsAt = 0,
    uvStride = 2,
): void {
    // corner 0 and the two corners next to it, on the page and around the bone
    const originX = float(quadUVs, 0) * pageWidth;
    const originY = float(quadUVs, 1) * pageHeight;
    const sideX = float(quadUVs, 2) * pageWidth - originX;
    const sideY = float(quadUVs, 3) * pageHeight - originY;
    const baseX = float(quadUVs, 6) * pageWidth - originX;
    const baseY = float(quadUVs, 7) * pageHeight - originY;
    const offsetX = float(quadOffsets, 0);
    const offsetY = float(quadOffsets, 1);
    const sideOffsetX = float(quadOffsets, 2) - offsetX;
    const sideOffsetY = float(quadOffsets, 3) - offsetY;
    const baseOffsetX = float(quadOffsets, 6) - offsetX;
    const baseOffsetY = float(quadOffsets, 7) - offsetY;
    const area = sideX * baseY - sideY * baseX;
    const count = points.length >> 1;

    if (count > 0 && !(Math.abs(area) > 0)) {
        throw new MarrowError(
            'invalid-data',
            'The quad of the region has no area on its page, so page positions have no place on it.',
            { fix: 'Pass the 8 texture coordinates of computeRegionUVs for the region of the outline.' },
        );
    }
    for (let i = 0; i < count; i++) {
        const x = points[i * 2] ?? 0;
        const y = points[i * 2 + 1] ?? 0;
        // how far the point lies along the two sides of the quad, from 0 to 1
        const alongSide = ((x - originX) * baseY - (y - originY) * baseX) / area;
        const alongBase = (sideX * (y - originY) - sideY * (x - originX)) / area;

        outOffsets[offsetsAt + i * 2] = offsetX + alongSide * sideOffsetX + alongBase * baseOffsetX;
        outOffsets[offsetsAt + i * 2 + 1] = offsetY + alongSide * sideOffsetY + alongBase * baseOffsetY;
        outUVs[uvsAt + i * uvStride] = x / pageWidth;
        outUVs[uvsAt + i * uvStride + 1] = y / pageHeight;
    }
}
