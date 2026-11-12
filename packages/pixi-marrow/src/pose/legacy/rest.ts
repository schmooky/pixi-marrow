import type { AttachmentData } from '../../model/attachments';
import type { LegacyEntry } from './entry';
import type { LegacyPlayer } from './player';

/*
 * An apply that need not run. The official `AnimationState.apply` is a function of the pose it
 * finds, of the time of every entry and of what the calls set. When an apply finds the times and
 * the settings of the apply before, and that one left every number of the pose as it was, this
 * one would leave them too. Then the timelines are not applied.
 *
 * Whether an apply left the pose as it was is not assumed, it is looked at: the pose is copied
 * before such an apply and compared after it, bit for bit. A timeline that mixes toward its key
 * moves the pose a little in every apply, and can take many applies to arrive.
 */

/** Scratch of the comparison: every fractional number an apply can write. It grows with the largest pose. */
let floats = new Float64Array(0);
/** Scratch of the comparison: every whole number an apply can write. */
let ints = new Int32Array(0);
/** Scratch of the comparison: the attachment of every slot. */
const shown: (AttachmentData | null)[] = [];
/** Where the walk over the pose is in `floats` and in `ints`. */
let floatAt = 0;
let intAt = 0;

/** Copies `count` numbers to the scratch, or with `check` compares them with it. Returns false when one differs. */
function walkFloats(source: Float64Array, count: number, check: boolean): boolean {
    const at = floatAt;

    floatAt += count;
    if (!check) {
        for (let i = 0; i < count; i++) floats[at + i] = Number(source[i]);

        return true;
    }
    for (let i = 0; i < count; i++) {
        const now = Number(source[i]);
        const before = Number(floats[at + i]);

        // by bits, where every number that is not a number counts as the same
        if (now === before ? now === 0 && 1 / now !== 1 / before : !(Number.isNaN(now) && Number.isNaN(before))) {
            return false;
        }
    }

    return true;
}

/** The same as {@link walkFloats} for whole numbers. */
function walkInts(source: ArrayLike<number>, count: number, check: boolean): boolean {
    const at = intAt;

    intAt += count;
    if (!check) {
        for (let i = 0; i < count; i++) ints[at + i] = Number(source[i]);

        return true;
    }
    for (let i = 0; i < count; i++) {
        if (Number(source[i]) !== ints[at + i]) return false;
    }

    return true;
}

/** The rotation numbers of the entries that are applied: an apply that mixes writes them. */
function walkRotations(player: LegacyPlayer, check: boolean): boolean {
    for (const current of player.tracks) {
        if (current === null || current.delay > 0) continue;
        const rotations = current.timelinesRotation;

        if (!check) ints[intAt] = current.rotationLength;
        if (ints[intAt++] !== current.rotationLength) return false;
        if (rotations !== null && !walkFloats(rotations, rotations.length, check)) return false;
    }

    return true;
}

/** How many fractional numbers the walk over the pose of a player takes. */
function floatCount(player: LegacyPlayer): number {
    const { pose, solver, tracks } = player;
    let count = pose.local.length + pose.colors.length + pose.darkColors.length;

    count += solver.values.length + solver.physics.length;
    for (let slot = 0; slot < pose.deformLengths.length; slot++) count += Number(pose.deformLengths[slot]);
    for (const current of tracks) count += current?.timelinesRotation?.length ?? 0;

    return count;
}

/**
 * Walks over everything an apply can write: copies it to the scratch, or with `check` compares
 * it with what was copied. Returns false when a number or an attachment differs.
 */
function walk(player: LegacyPlayer, check: boolean): boolean {
    const { pose, solver } = player;
    const slots = pose.attachments.length;
    const bones = pose.inherit.length;

    floatAt = 0;
    intAt = 0;
    if (!check) {
        const needed = floatCount(player);

        if (floats.length < needed) floats = new Float64Array(needed);
        if (ints.length < bones + slots * 3 + player.tracks.length) {
            ints = new Int32Array(bones + slots * 3 + player.tracks.length);
        }
    }
    // the deform lengths first: they decide how many numbers of a deform count
    if (!walkInts(pose.deformLengths, slots, check)) return false;
    for (let slot = 0; slot < slots; slot++) {
        if (check ? shown[slot] !== pose.attachments[slot] : false) return false;
        shown[slot] = pose.attachments[slot] ?? null;
        if (!walkFloats(pose.deform[slot] ?? floats, Number(pose.deformLengths[slot]), check)) return false;
    }

    return (
        walkInts(pose.inherit, bones, check) &&
        walkInts(pose.sequenceIndices, slots, check) &&
        walkInts(pose.drawOrder, slots, check) &&
        walkFloats(pose.local, pose.local.length, check) &&
        walkFloats(pose.colors, pose.colors.length, check) &&
        walkFloats(pose.darkColors, pose.darkColors.length, check) &&
        walkFloats(solver.values, solver.values.length, check) &&
        walkFloats(solver.physics, solver.physics.length, check) &&
        walkRotations(player, check)
    );
}

/** Keeps the pose of a player as it is before an apply, for {@link poseIsKept}. */
export function keepPose(player: LegacyPlayer): void {
    walk(player, false);
}

/** True when the apply since {@link keepPose} left every number and every attachment of the pose as it was. */
export function poseIsKept(player: LegacyPlayer): boolean {
    const kept = walk(player, true);

    // the scratch must not keep the attachments of a skeleton alive
    shown.fill(null);

    return kept;
}

/**
 * True when the timelines of an entry give at its time what they gave when it was last applied.
 * Either the time is the same to the bit. Or every timeline of the animation holds one value from
 * its first key on, and both times are at or after those keys.
 *
 * The time of a looping entry is a remainder, which is slow to compute. The common cases do not
 * need it. An entry whose track time stood still has the time it had. One that loops on has
 * another time, unless the update was as long as whole loops, which then counts as a change.
 */
function entryRepeats(current: LegacyEntry): boolean {
    const clip = current.clip;
    const trackTime = current.trackTime;
    const trackLast = current.trackLast;

    if (trackTime === trackLast && (trackTime !== 0 || 1 / trackTime === 1 / trackLast)) return true;
    // the common case comes first: an animation that loops and moves
    if (current.loop && !clip.still) return false;
    const start = current.animationStart;
    const last = current.animationLast;
    // the official getAnimationTime
    let time = start;

    if (!current.loop) time = Math.min(trackTime + start, current.animationEnd);
    else if (current.animationEnd - start !== 0) time = (trackTime % (current.animationEnd - start)) + start;
    if (time === last && (time !== 0 || 1 / time === 1 / last)) return true;
    if (!clip.still) return false;
    const now = current.reverse ? clip.duration - time : time;
    const before = current.reverse ? clip.duration - last : last;

    return now >= clip.stillFrom && before >= clip.stillFrom;
}

/**
 * True when this apply would do what the apply before did: no call and no update changed an
 * entry since, nothing is mixed, and every entry repeats. The caller knows that nothing else
 * wrote the pose.
 */
export function applyRepeats(player: LegacyPlayer): boolean {
    const tracks = player.tracks;

    if (player.stirred) return false;
    for (let i = 0, n = tracks.length; i < n; i++) {
        const current = tracks[i] ?? null;

        if (current === null || current.delay > 0) continue;
        // a mix moves on with time, and so does an entry that fades at its end
        if (current.mixingFrom !== null) return false;
        if (current.trackTime >= current.trackEnd && current.next === null) return false;
        if (!entryRepeats(current)) return false;
    }

    return true;
}
