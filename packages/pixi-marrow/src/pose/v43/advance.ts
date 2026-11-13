import { MarrowError } from '../../base/errors';
import { LOCAL_STRIDE } from '../state';
import { finish, setTimes } from './apply';
import { ALPHA, SHARED, TIME } from './curves';
import type { Entry } from './entry';
import { animationsChanged } from './hold';
import { drain, type Player43 } from './player';
import { distrust } from './rest';
import { IK_SIZE } from './solver-types';
import { applyTimeline } from './timelines';
import {
    type Clip43,
    OP_IK,
    OP_INHERIT,
    OP_MIXES,
    OP_PAIR,
    OP_RELATIVE,
    OP_SCALE,
    OP_SCALE_PAIR,
    OP_VALUE,
    type Pose43,
    ROLE_EVENT,
    SETUP,
    type Timeline43,
} from './types';
import { updateTracks } from './update';

/*
 * What baked playback needs of the 4.3 engine: whether one entry alone poses the next update, an
 * update of the tracks and the events without the pose, and whether the pose holds the setup
 * values that an animation leaves alone.
 */

/** Numbers per bone in the keyed scratch: the 7 local values, then the inherit mode. */
const BONE_KEYS = 8;

/** Scratch of {@link holdsSetup}: 1 for each value an animation keys. It grows with the largest rig. */
let keyed = new Uint8Array(0);

/**
 * The entry that alone poses the next update, as `PoseEngine.solo` describes it, or null. Its
 * apply is `applyFromSetup`: every timeline replaces the setup pose.
 */
export function soloEntry(player: Player43): Entry | null {
    const { tracks } = player;
    const current = tracks[0] ?? null;

    if (current === null || current.animation < 0) return null;
    for (let i = 1; i < tracks.length; i++) if ((tracks[i] ?? null) !== null) return null;
    if (current.mixingFrom !== null || current.next !== null || current.delay > 0) return null;

    return current.alpha === 1 && current.trackEnd === Number.MAX_VALUE ? current : null;
}

/**
 * The tracks, the events and the times of an update whose pose comes from elsewhere: the
 * official `AnimationState.update`, then of the official `apply` what the solo entry does
 * besides its pose. Its event timelines fire, also in reverse, its `complete` is queued and its
 * times move on. Nothing is known of the pose afterwards: the next update applies and solves all.
 *
 * Returns the animation of the entry, and leaves the time its timelines would apply at in
 * `SHARED` at `TIME`.
 */
export function advanceTracks(player: Player43, dt: number): Clip43 {
    const current = soloEntry(player);

    if (current === null) {
        throw new MarrowError('invalid-data', 'advance needs one entry that plays alone on track 0.', {
            fix: 'Call update, or call advance only while solo() returns an entry.',
        });
    }
    updateTracks(player, dt);
    if (player.animationsChanged) animationsChanged(player);
    setTimes(current);
    SHARED[ALPHA] = 1;
    const time = Number(SHARED[TIME]);
    const events = current.reverse ? null : player.fired;

    for (const timeline of current.clip.timelines) {
        if (timeline.role === ROLE_EVENT) applyTimeline(player.pose, timeline, events, SETUP, false, false);
    }
    finish(player, current);
    player.unkeyedState += 2;
    player.rested = null;
    distrust(player.pose);
    drain(player);
    // the event timelines move the time while they fire across a loop
    SHARED[TIME] = time;

    return current.clip;
}

/** The kernels that write the local pose of a bone, its inherit mode or the pose of a constraint. */
const posesBones = (op: number): boolean =>
    op === OP_RELATIVE ||
    op === OP_PAIR ||
    op === OP_SCALE_PAIR ||
    op === OP_SCALE ||
    op === OP_INHERIT ||
    op === OP_IK ||
    op === OP_MIXES ||
    op === OP_VALUE;

/**
 * Applies the timelines of `clip` that write the bones and the constraints, at `time` and alpha
 * 1 from the setup pose, as the solo entry would. Nothing else: no slot, no event, no time of an
 * entry moves. The world transforms stay as they are until the next update computes them all.
 */
export function poseBehind(pose: Pose43, clip: Clip43, time: number): void {
    SHARED[TIME] = time;
    SHARED[ALPHA] = 1;
    for (const timeline of clip.timelines) {
        if (posesBones(timeline.op)) applyTimeline(pose, timeline, null, SETUP, false, false);
    }
}

/** How many local values a bone kernel writes, from `offset` on. */
const boneValues = (op: number): number => (op === OP_PAIR || op === OP_SCALE_PAIR ? 2 : 1);

/** Marks in the keyed scratch the values that one timeline writes. `values` is where the constraint poses start. */
function markKeyed(timeline: Timeline43, values: number): void {
    const { op, target, offset } = timeline;

    if (op === OP_INHERIT) keyed[target * BONE_KEYS + 7] = 1;
    else if (op === OP_RELATIVE || op === OP_PAIR || op === OP_SCALE_PAIR || op === OP_SCALE) {
        const at = target * BONE_KEYS + offset;

        keyed.fill(1, at, at + boneValues(op));
    } else if (op === OP_IK) keyed.fill(1, values + offset, values + offset + IK_SIZE);
    else if (op === OP_MIXES) keyed.fill(1, values + offset, values + offset + timeline.entries - 1);
    else if (op === OP_VALUE) keyed[values + offset] = 1;
}

/** True for two numbers that are equal, or both not a number. */
const same = (a: number, b: number): boolean => a === b || (Number.isNaN(a) && Number.isNaN(b));

/**
 * True when the animated pose holds the setup value in everything `clip` does not key. That is
 * the local values and the inherit mode of the bones `bones` marks, or of every bone. It is also
 * the pose of every constraint.
 */
export function holdsSetup(pose: Pose43, clip: Clip43, bones: Uint8Array | undefined): boolean {
    const { model, solver } = pose.rig;
    const count = model.bones.count;
    const values = count * BONE_KEYS;
    const size = values + pose.values.length;

    if (keyed.length < size) keyed = new Uint8Array(size);
    else keyed.fill(0, 0, size);
    for (const timeline of clip.timelines) markKeyed(timeline, values);
    const { setup, inherit } = model.bones;

    for (let bone = 0; bone < count; bone++) {
        if (bones !== undefined && bones[bone] !== 1) continue;
        const at = bone * BONE_KEYS;
        const local = bone * LOCAL_STRIDE;

        for (let i = 0; i < LOCAL_STRIDE; i++) {
            if (keyed[at + i] === 0 && !same(Number(pose.local[local + i]), Number(setup[local + i]))) return false;
        }
        if (keyed[at + 7] === 0 && pose.inherit[bone] !== inherit[bone]) return false;
    }
    for (let i = 0; i < pose.values.length; i++) {
        if (keyed[values + i] === 0 && !same(Number(pose.values[i]), Number(solver.setup[i]))) return false;
    }

    return true;
}
