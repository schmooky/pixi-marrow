import { LOCAL_STRIDE } from '../state';
import { applyTimeline } from './apply-timeline';
import { LOCAL_ROTATION } from './bones';
import { ALPHA, curveValues, SHARED, TIME } from './curves';
import type { LegacyEntry } from './entry';
import type { LegacyPlayer } from './player';
import { FIRST, type LegacyTimeline, MIX_IN, SETUP } from './timelines';

/*
 * Rotate timelines of an entry that is mixed: the official `applyRotateTimeline`. A rotation is
 * mixed along the shortest way on the first frame of a mix and keeps that direction afterwards.
 */

/**
 * The rotation numbers of an entry for this apply, or null for an entry with `shortestRotation`,
 * whose rotate timelines are applied like any other. On the first frame of a mix the numbers
 * start unwritten: the official `timelinesRotation.length = count << 1`.
 */
export function rotationsOf(entry: LegacyEntry, count: number, firstFrame: boolean): Float64Array | null {
    if (entry.shortestRotation) return null;
    if (!firstFrame) return entry.timelinesRotation;
    let rotations = entry.timelinesRotation;

    if (rotations === null) {
        rotations = new Float64Array(count << 1);
        entry.timelinesRotation = rotations;
    }
    rotations.fill(Number.NaN);
    entry.rotationLength = count << 1;

    return rotations;
}

/*
 * The two functions below take the new difference from `values[0]`, the last total rotation from
 * `rotations[i]` and the last difference from `rotations[i + 1]`. They write the new total to
 * `rotations[i]`. Numbers passed to a call or returned from it can cost an allocation.
 */

/** The total rotation of a mix in 4.1. */
function totalRotation41(rotations: Float64Array, i: number, values: Float64Array): void {
    const diff = Number(values[0]);
    const lastDiff = Number(rotations[i + 1]);
    let lastTotal = Number(rotations[i]);
    const current = diff > 0;
    // the official signum of the last difference and of this one
    const lastSide = lastDiff > 0 ? 1 : lastDiff < 0 ? -1 : 0;
    const side = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    let dir = lastTotal >= 0;

    // detect cross at 0 (not 180)
    if (lastSide !== side && Math.abs(lastDiff) <= 90) {
        // a cross after a 360 rotation is a loop
        if (Math.abs(lastTotal) > 180) lastTotal += lastTotal > 0 ? 360 : -360;
        dir = current;
    }
    let total = diff + lastTotal - (lastTotal % 360);

    // the official 360 * signum(lastTotal)
    if (dir !== current) total += lastTotal > 0 ? 360 : lastTotal < 0 ? -360 : 0;
    rotations[i] = total;
}

/** The total rotation of a mix in 4.2. */
function totalRotation42(rotations: Float64Array, i: number, values: Float64Array): void {
    const diff = Number(values[0]);
    const lastDiff = Number(rotations[i + 1]);
    const lastTotal = Number(rotations[i]);
    const loops = lastTotal - (lastTotal % 360);
    let total = diff + loops;
    const current = diff >= 0;
    // the official signum of the last total, of the last difference and of this one
    const totalSide = lastTotal > 0 ? 1 : lastTotal < 0 ? -1 : 0;
    const lastSide = lastDiff > 0 ? 1 : lastDiff < 0 ? -1 : 0;
    const side = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    let dir = lastTotal >= 0;

    if (Math.abs(lastDiff) <= 90 && lastSide !== side) {
        if (Math.abs(lastTotal - loops) > 180) {
            total += 360 * totalSide;
            dir = current;
        } else if (loops !== 0) {
            total -= 360 * totalSide;
        } else {
            dir = current;
        }
    }
    if (dir !== current) total += 360 * totalSide;
    rotations[i] = total;
}

/**
 * Sets the local rotation at `at` to `player.values[0]` and notes the bone as moved when the
 * rotation is a new one, down to the sign of a zero.
 */
function setRotation(player: LegacyPlayer, bone: number, at: number): void {
    const local = player.pose.local;
    const moved = player.solver.moved;
    const rotation = Number(player.values[0]);
    const current = Number(local[at]);

    if (rotation !== current || (rotation === 0 && 1 / rotation !== 1 / current)) {
        moved[bone + 1] = 1;
        moved[0] = 1;
        local[at] = rotation;
    }
}

/**
 * The official `applyRotateTimeline`: mixes a rotation along the shortest way on the first frame
 * of a mix and keeps that direction afterwards. `i` is the index of the entry's two rotation numbers.
 */
export function applyRotateTimeline(
    player: LegacyPlayer,
    timeline: LegacyTimeline,
    blend: number,
    rotations: Float64Array,
    i: number,
    firstFrame: boolean,
): void {
    const alpha = Number(SHARED[ALPHA]);

    if (firstFrame) rotations[i] = 0;
    if (alpha === 1) {
        applyTimeline(player, timeline, null, blend, MIX_IN);

        return;
    }
    const { rig, pose, values } = player;
    const bone = timeline.target;

    if (pose.active[bone] !== 1) return;
    const at = bone * LOCAL_STRIDE + LOCAL_ROTATION;
    const setup = Number(rig.model.bones.setup[at]);
    let r1 = 0;
    let r2 = 0;

    if (Number(SHARED[TIME]) < Number(timeline.frames[0])) {
        if (blend === SETUP) {
            values[0] = setup;
            setRotation(player, bone, at);
        }
        if (blend !== FIRST) return;
        r1 = Number(pose.local[at]);
        r2 = setup;
    } else {
        curveValues(timeline.frames, timeline.curves, 2, values);
        r1 = blend === SETUP ? setup : Number(pose.local[at]);
        r2 = setup + Number(values[0]);
    }
    // mix between rotations using the direction of the shortest route on the first frame while detecting crosses
    let diff = r2 - r1;

    diff -= rig.v41 ? (16384 - ((16384.499999999996 - diff / 360) | 0)) * 360 : Math.ceil(diff / 360 - 0.5) * 360;
    if (diff !== 0) {
        // on the first frame the last total is 0, as set above, and the last difference is the new one
        if (firstFrame) rotations[i + 1] = diff;
        values[0] = diff;
        if (rig.v41) totalRotation41(rotations, i, values);
        else totalRotation42(rotations, i, values);
    }
    rotations[i + 1] = diff;
    values[0] = r1 + Number(rotations[i]) * alpha;
    setRotation(player, bone, at);
}
