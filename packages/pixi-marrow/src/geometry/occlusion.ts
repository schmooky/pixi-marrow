import { type FloatArray, float } from './read';

/*
 * Covered slots: a slot that lies inside the opaque part of a slot drawn above it shows no pixel
 * and can be skipped. The opaque part of a region is found once, from the alpha of its page, in
 * opaque-rect.ts. The test of a slot against it runs every frame and is here.
 */

/**
 * Whether every point lies inside a convex quad, or on its edge. This is the test for a covered
 * slot. The quad holds the world corners of the opaque rectangle of the slot above. The points
 * are the world vertices of the slot below.
 *
 * `quad` holds 4 corners as x, y pairs from `quadAt` on, in the order around the quad, in either
 * winding. `points` holds `count` points, one x, y pair every `stride` numbers from `pointsAt`
 * on. Nothing is allocated. The answer is false for a quad without area, for no points and for
 * a number that is not finite.
 *
 * @example
 * const hidden = pointsInsideQuad(opaqueCorners, 0, positions, first * 2, vertexCount);
 */
export function pointsInsideQuad(
    quad: FloatArray,
    quadAt: number,
    points: FloatArray,
    pointsAt: number,
    count: number,
    stride = 2,
): boolean {
    const ax = float(quad, quadAt);
    const ay = float(quad, quadAt + 1);
    const bx = float(quad, quadAt + 2);
    const by = float(quad, quadAt + 3);
    const cx = float(quad, quadAt + 4);
    const cy = float(quad, quadAt + 5);
    const dx = float(quad, quadAt + 6);
    const dy = float(quad, quadAt + 7);
    // the diagonals give twice the area, with the sign of the winding
    const area = (cx - ax) * (dy - by) - (cy - ay) * (dx - bx);

    if (count <= 0 || !(area > 0 || area < 0)) return false;
    const sign = area > 0 ? 1 : -1;

    for (let i = 0; i < count; i++) {
        const x = float(points, pointsAt + i * stride);
        const y = float(points, pointsAt + i * stride + 1);
        const inside =
            ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * sign >= 0 &&
            ((cx - bx) * (y - by) - (cy - by) * (x - bx)) * sign >= 0 &&
            ((dx - cx) * (y - cy) - (dy - cy) * (x - cx)) * sign >= 0 &&
            ((ax - dx) * (y - dy) - (ay - dy) * (x - dx)) * sign >= 0;

        if (!inside) return false;
    }

    return true;
}
