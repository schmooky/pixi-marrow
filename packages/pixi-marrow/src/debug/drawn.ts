import type { SkeletonView } from '../render/skeleton-view';

/**
 * The triangles a view draws, 6 numbers each, in the space of the display object: the slots it
 * shows in draw order, after the cuts of overdraw. A slot that a later opaque slot covers is left
 * out, a hollow region has none, and a region drawn as a polygon has the triangles of its polygon.
 * Clipping is not applied: a clipped slot shows its whole shape.
 *
 * @example
 * const triangles = drawnTriangles(view);
 * console.log(triangles.length / 6);
 */
export function drawnTriangles(view: SkeletonView): number[] {
    const { template, seen, cover } = view.parts;
    const { positions } = template;
    const out: number[] = [];

    for (let i = 0; i < seen.count; i++) {
        if (cover.skipped[i] === 1) continue;
        const entry = seen.list[i] ?? 0;
        const first = template.first[entry] ?? 0;
        const triangles = template.triangles[entry];

        if ((template.counts[entry] ?? 0) === 0 || triangles === undefined) continue;
        for (let k = 0; k < triangles.length; k++) {
            const at = (first + (triangles[k] ?? 0)) * 2;

            out.push(positions[at] ?? 0, positions[at + 1] ?? 0);
        }
    }

    return out;
}
