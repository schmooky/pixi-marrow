import type { Batch, Matrix } from 'pixi.js';

/*
 * What a batch element does that is not about its slots: the transform its vertices were placed
 * with, and the borders of its runs. The upkeep of the cut triangles of a clip loads with the
 * code that cuts them, see `clip-code.ts`.
 */

/**
 * Notes the transform the vertices of a skeleton are placed with. Returns whether it is another
 * one than the one noted before: the display object moved, and every vertex is placed again.
 *
 * @param placedWith The six numbers of the transform that was noted last: a, b, c, d, tx, ty.
 *
 * @example
 * const moved = noteTransform(placedWith, body.groupTransform);
 */
export function noteTransform(placedWith: Float64Array, transform: Matrix): boolean {
    const { a, b, c, d, tx, ty } = transform;
    const same =
        a === placedWith[0] &&
        b === placedWith[1] &&
        c === placedWith[2] &&
        d === placedWith[3] &&
        tx === placedWith[4] &&
        ty === placedWith[5];

    if (same) return false;
    placedWith[0] = a;
    placedWith[1] = b;
    placedWith[2] = c;
    placedWith[3] = d;
    placedWith[4] = tx;
    placedWith[5] = ty;

    return true;
}

/**
 * Moves the borders of the batches of the runs of a skeleton to where the runs end now.
 *
 * @param at The first index of the skeleton in the index buffer of the batch.
 *
 * @example
 * spreadRuns(element.batches, element.runSizes, element.runs, element._indexStart);
 */
export function spreadRuns(batches: readonly Batch[], runSizes: readonly number[], runs: number, at: number): void {
    let start = at;

    if (runs === 1) return;
    for (let run = 0; run < runs; run++) {
        const batch = batches[run];

        if (batch === undefined) return;
        if (run > 0) {
            batch.size += batch.start - start;
            batch.start = start;
        }
        start += Number(runSizes[run]);
        if (run < runs - 1) batch.size = start - batch.start;
    }
}
