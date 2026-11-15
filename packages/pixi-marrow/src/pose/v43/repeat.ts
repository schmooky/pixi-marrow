import { endWalk, startWalk, walkAttachment, walkFloats, walkInt, walkInts } from '../shared/kept';
import type { Entry } from './entry';
import type { Player43 } from './player';

/*
 * An apply that need not run. The official `AnimationState.apply` is a function of the pose it
 * finds, of the time of every entry and of what the calls set. When an apply finds the times and
 * the settings of the apply before, and that one left every number of the pose as it was, this
 * one would leave them too. Then the timelines are not applied.
 *
 * That holds for every track and every alpha. Whether an apply left the pose as it was is not
 * assumed, it is looked at, with the walk of shared/kept.ts. A timeline that mixes toward its
 * key moves the pose a little in every apply, and can take many applies to arrive.
 */

/** The rotation numbers of the entries that are applied: an apply that mixes writes them. */
function walkRotations(player: Player43, check: boolean): boolean {
    for (const current of player.tracks) {
        if (!current || current.delay > 0) continue;
        if (!walkInt(current.rotationCount, check)) return false;
        if (!walkFloats(current.rotations, current.rotationCount, check)) return false;
    }

    return true;
}

/** How many fractional numbers the walk over the animated pose of a player takes. */
function floatCount(player: Player43): number {
    const { pose, tracks } = player;
    let count = pose.local.length + pose.colors.length + pose.darkColors.length + pose.values.length;

    for (let slot = 0; slot < pose.deformLengths.length; slot++) count += Number(pose.deformLengths[slot]);
    for (const current of tracks) count += current?.rotationCount ?? 0;

    return count;
}

/**
 * Walks over everything an apply can write in the animated pose: copies it to the scratch, or
 * with `check` compares it with what was copied. Returns false when a number or an attachment differs.
 */
function walk(player: Player43, check: boolean): boolean {
    const { pose } = player;
    const slots = pose.attachments.length;
    const bones = pose.inherit.length;

    startWalk(check, check ? 0 : floatCount(player), bones + slots * 3 + player.tracks.length);
    // the deform lengths first: they decide how many numbers of a deform count
    if (!walkInts(pose.deformLengths, slots, check)) return false;
    for (let slot = 0; slot < slots; slot++) {
        if (!walkAttachment(pose.attachments[slot] ?? null, slot, check)) return false;
        if (!walkFloats(pose.deform[slot], Number(pose.deformLengths[slot]), check)) return false;
    }

    return (
        walkInts(pose.inherit, bones, check) &&
        walkInts(pose.sequenceIndices, slots, check) &&
        walkInts(pose.drawOrder, slots, check) &&
        walkFloats(pose.local, pose.local.length, check) &&
        walkFloats(pose.colors, pose.colors.length, check) &&
        walkFloats(pose.darkColors, pose.darkColors.length, check) &&
        walkFloats(pose.values, pose.values.length, check) &&
        walkRotations(player, check)
    );
}

/** Keeps the animated pose of a player as it is before an apply, for {@link poseIsKept}. */
export function keepPose(player: Player43): void {
    walk(player, false);
}

/** True when the apply since {@link keepPose} left every number and every attachment of the pose as it was. */
export function poseIsKept(player: Player43): boolean {
    const kept = walk(player, true);

    endWalk();

    return kept;
}

/** True for two numbers with the same bits. A number that is not a number is never the same. */
const sameBits = (a: number, b: number): boolean => a === b && (a !== 0 || 1 / a === 1 / b);

/**
 * True when the timelines of an entry give at its time what they gave when it was last applied:
 * the time is the same to the bit.
 *
 * The time of a looping entry is a remainder, which is slow to compute. An entry that loops on
 * has another time, unless the update was as long as whole loops, which then counts as a change.
 */
function entryRepeats(current: Entry): boolean {
    const start = current.animationStart;
    const stood = sameBits(current.trackTime, current.trackLast);
    // the official getAnimationTime
    let time = start;

    if (!stood && current.loop && current.animationEnd - start !== 0) return false;
    if (!current.loop) time = Math.min(current.trackTime + start, current.animationEnd);
    else if (current.animationEnd - start !== 0) time = (current.trackTime % (current.animationEnd - start)) + start;
    if (!sameBits(time, current.animationLast)) return false;
    if (!current.clip.resets) return true;

    // a reversed entry is applied at another time than its last time: a physics reset timeline can fire there
    return (current.reverse ? current.clip.duration - time : time) === current.animationLast;
}

/**
 * True when this apply would do what the apply before did. No call and no update changed an
 * entry or the animated pose since, nothing is mixed, and every entry repeats.
 */
export function applyRepeats(player: Player43): boolean {
    const tracks = player.tracks;

    if (player.stirred || player.pose.solve.dirty) return false;
    for (let i = 0, n = tracks.length; i < n; i++) {
        const current = tracks[i];

        if (!current || current.delay > 0) continue;
        // a mix moves on with time, and so does an entry that fades at its end
        if (current.mixingFrom !== null) return false;
        if (current.trackTime >= current.trackEnd && current.next === null) return false;
        if (!entryRepeats(current)) return false;
    }

    return true;
}
