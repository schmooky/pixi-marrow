import { VERDICT_CUT, VERDICT_NOTHING, VERDICT_WHOLE } from '../../src/geometry/clip-triangles';
import type { Problems } from './geometry-compare';

/*
 * Holds the verdict of the clip kernel about a slot against what clipping the slot writes: in
 * the kernel and in the official clipper. A verdict of nothing must meet an empty output. A
 * verdict of whole must meet the triangles of the slot: the same positions bit for bit, corner
 * after corner, and indices that count up. A verdict of cut is always allowed, and is counted
 * as missed where one of the other two would have been true.
 */

/** How often a checker heard each verdict, and how often a careful one. */
export interface VerdictTally {
    nothing: number;
    whole: number;
    cut: number;
    /** Verdicts of cut for a slot of which nothing is left. */
    missedNothing: number;
    /** Verdicts of cut for a slot that is written as it is. */
    missedWhole: number;
}

/** What clipping a slot wrote, in the kernel or in the official clipper. */
export interface Written {
    positions: Float32Array;
    uvs: Float32Array;
    indices: ArrayLike<number>;
}

/** The triangles of a slot, as the checker holds them. */
interface Slot {
    positions: Float32Array;
    uvs: Float32Array;
    triangles: Uint16Array;
}

/** Whether an output is the triangles of the slot as they are: every corner in its place. */
function isWhole(slot: Slot, { positions, indices }: Written): boolean {
    const { triangles } = slot;

    if (positions.length !== triangles.length * 2 || indices.length !== triangles.length) return false;

    return triangles.every((vertex, corner) => {
        const sameX = Object.is(positions[corner * 2], slot.positions[vertex * 2]);
        const sameY = Object.is(positions[corner * 2 + 1], slot.positions[vertex * 2 + 1]);

        return sameX && sameY && indices[corner] === corner;
    });
}

/** The verdict that is true for an output. An empty slot leaves nothing. */
function trueVerdict(slot: Slot, written: Written): 0 | 1 | 2 {
    if (written.positions.length === 0 && written.indices.length === 0) return VERDICT_NOTHING;

    return isWhole(slot, written) ? VERDICT_WHOLE : VERDICT_CUT;
}

/** The texture coordinates of the corners of every triangle of a slot, in order. */
function cornerUVs(slot: Slot): Float32Array {
    return Float32Array.from({ length: slot.triangles.length * 2 }, (_, i) => {
        const vertex = slot.triangles[i >> 1] ?? 0;

        return slot.uvs[vertex * 2 + (i & 1)] ?? Number.NaN;
    });
}

/**
 * Compares a verdict with what the kernel and the official clipper wrote for the slot, and
 * counts it.
 *
 * @param inverse Whether the clip keeps the outside. Its texture coordinates are computed again,
 * so only the positions of a whole slot are compared.
 */
export function checkVerdict(
    problems: Problems,
    tally: VerdictTally,
    where: string,
    said: number,
    slot: Slot,
    kernel: Written,
    official: Written,
    inverse: boolean,
): void {
    const truth = trueVerdict(slot, kernel);

    problems.same(`${where} true verdict of the official output`, trueVerdict(slot, official), truth);
    if (said === VERDICT_CUT) {
        tally.cut++;
        if (truth === VERDICT_NOTHING) tally.missedNothing++;
        if (truth === VERDICT_WHOLE) tally.missedWhole++;

        return;
    }
    problems.same(`${where} verdict`, said, truth);
    if (said === VERDICT_NOTHING) tally.nothing++;
    else tally.whole++;
    if (said === VERDICT_WHOLE && !inverse) problems.equal(`${where} uvs of a whole slot`, kernel.uvs, cornerUVs(slot));
}
