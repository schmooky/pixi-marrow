import { MarrowError } from '../../base/errors';
import { LOCAL_STRIDE } from '../state';
import { queueEvents, setTimes } from './apply';
import { applyTimeline } from './apply-timeline';
import { CONSTRAINT_STRIDE, IK_MIX, PATH_MIX, PATH_POSITION, PATH_SPACING, TRANSFORM_MIX } from './constraints';
import { ALPHA, ANIMATION_TIME, SHARED, TIME } from './curves';
import type { LegacyEntry } from './entry';
import { computeHolds } from './hold';
import type { LegacyPlayer } from './player';
import {
    type Clip,
    FIRST,
    K_EVENT,
    K_IK,
    K_INHERIT,
    K_PATH_MIX,
    K_PATH_POSITION,
    K_PATH_SPACING,
    K_ROTATE,
    K_SCALE,
    K_SCALE_X,
    K_SCALE_Y,
    K_SHEAR,
    K_SHEAR_X,
    K_SHEAR_Y,
    K_TRANSFORM,
    K_TRANSLATE,
    K_TRANSLATE_X,
    K_TRANSLATE_Y,
    type LegacyTimeline,
    MIX_IN,
} from './timelines';
import { updateTracks } from './update';

/*
 * What baked playback needs of the 4.1 and 4.2 engine: whether one entry alone poses the next
 * update, an update of the tracks and the events without the pose, and whether the pose holds
 * the setup values that an animation leaves alone.
 */

/** Numbers per bone in the keyed scratch: the 7 local values, then the inherit mode. */
const BONE_KEYS = 8;
/** Where the constraint values of one constraint start among its values, by timeline kind, and how many there are. */
const CONSTRAINT_KEYS: Readonly<Record<number, readonly [number, number]>> = {
    // mix, softness, bend direction, compress and stretch
    [K_IK]: [IK_MIX, 5],
    [K_TRANSFORM]: [TRANSFORM_MIX, 6],
    [K_PATH_MIX]: [PATH_MIX, 3],
    [K_PATH_POSITION]: [PATH_POSITION, 1],
    [K_PATH_SPACING]: [PATH_SPACING, 1],
};
/** Which local values each bone timeline keys: the first one and how many. The inherit mode is value 7. */
const BONE_VALUES: Readonly<Record<number, readonly [number, number]>> = {
    [K_ROTATE]: [2, 1],
    [K_TRANSLATE]: [0, 2],
    [K_TRANSLATE_X]: [0, 1],
    [K_TRANSLATE_Y]: [1, 1],
    [K_SCALE]: [3, 2],
    [K_SCALE_X]: [3, 1],
    [K_SCALE_Y]: [4, 1],
    [K_SHEAR]: [5, 2],
    [K_SHEAR_X]: [5, 1],
    [K_SHEAR_Y]: [6, 1],
    [K_INHERIT]: [7, 1],
};

/** Scratch of {@link holdsSetup}: 1 for each value an animation keys. It grows with the largest rig. */
let keyed = new Uint8Array(0);

/**
 * The entry that alone poses the next update, as `PoseEngine.solo` describes it, or null. The
 * apply of such an entry is `plainTimelines` with blend `first` at alpha 1.
 */
export function soloEntry(player: LegacyPlayer): LegacyEntry | null {
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
 * besides its pose. Its event timelines fire, its `complete` is queued and its times move on.
 * The next apply runs every timeline: the pose is not the one the times say.
 *
 * Returns the animation of the entry, and leaves the time its timelines would apply at in
 * `SHARED` at `TIME`.
 */
export function advanceTracks(player: LegacyPlayer, dt: number): Clip {
    const current = soloEntry(player);

    if (current === null) {
        throw new MarrowError('invalid-data', 'advance needs one entry that plays alone on track 0.', {
            fix: 'Call update, or call advance only while solo() returns an entry.',
        });
    }
    updateTracks(player, dt);
    if (player.animationsChanged) computeHolds(player);
    setTimes(current);
    SHARED[ALPHA] = 1;
    const time = Number(SHARED[TIME]);

    // a reversed entry fires no events in 4.1 and 4.2
    if (!current.reverse) {
        for (const timeline of current.clip.timelines) {
            if (timeline.kind === K_EVENT) applyTimeline(player, timeline, player.fired, FIRST, MIX_IN);
        }
    }
    queueEvents(player, current);
    current.nextAnimationLast = Number(SHARED[ANIMATION_TIME]);
    current.nextTrackLast = current.trackTime;
    player.unkeyedState += 2;
    player.stirred = true;
    // the event timelines move the time while they fire across a loop
    SHARED[TIME] = time;

    return current.clip;
}

/** The kinds that write the local pose of a bone, its inherit mode or the values of a constraint. */
const posesBones = (kind: number): boolean => kind <= K_INHERIT || (kind >= K_IK && kind <= K_PATH_MIX);

/**
 * Applies the timelines of `clip` that write the bones and the constraints, at `time` and alpha
 * 1 with blend `first`, as the solo entry would. Nothing else: no slot, no event, no time of an
 * entry moves. The world transforms stay as they are until the next update computes them all.
 */
export function poseBehind(player: LegacyPlayer, clip: Clip, time: number): void {
    SHARED[TIME] = time;
    SHARED[ALPHA] = 1;
    for (const timeline of clip.timelines) {
        if (posesBones(timeline.kind)) applyTimeline(player, timeline, null, FIRST, MIX_IN);
    }
}

/** Marks in the keyed scratch the values that one timeline writes. `values` is where the constraint values start. */
function markKeyed(timeline: LegacyTimeline, values: number): void {
    const bone = BONE_VALUES[timeline.kind];
    const constraint = CONSTRAINT_KEYS[timeline.kind];

    if (bone !== undefined) {
        const at = timeline.target * BONE_KEYS + bone[0];

        keyed.fill(1, at, at + bone[1]);
    } else if (constraint !== undefined) {
        const at = values + timeline.target * CONSTRAINT_STRIDE + constraint[0];

        keyed.fill(1, at, at + constraint[1]);
    }
}

/** True for two numbers that are equal, or both not a number. */
const same = (a: number, b: number): boolean => a === b || (Number.isNaN(a) && Number.isNaN(b));

/**
 * True when the animated pose holds the setup value in everything `clip` does not key. That is
 * the local values and the inherit mode of the bones `bones` marks, or of every bone. It is also
 * every value of every IK, transform and path constraint.
 */
export function holdsSetup(player: LegacyPlayer, clip: Clip, bones: Uint8Array | undefined): boolean {
    const { rig, pose, solver } = player;
    const count = rig.model.bones.count;
    const values = count * BONE_KEYS;
    const size = values + solver.values.length;

    if (keyed.length < size) keyed = new Uint8Array(size);
    else keyed.fill(0, 0, size);
    for (const timeline of clip.timelines) markKeyed(timeline, values);
    const { setup, inherit } = rig.model.bones;

    for (let bone = 0; bone < count; bone++) {
        if (bones !== undefined && bones[bone] !== 1) continue;
        const at = bone * BONE_KEYS;
        const local = bone * LOCAL_STRIDE;

        for (let i = 0; i < LOCAL_STRIDE; i++) {
            if (keyed[at + i] === 0 && !same(Number(pose.local[local + i]), Number(setup[local + i]))) return false;
        }
        if (keyed[at + 7] === 0 && pose.inherit[bone] !== inherit[bone]) return false;
    }
    const setupValues = rig.plan.setup;

    for (let i = 0; i < solver.values.length; i++) {
        if (keyed[values + i] === 0 && !same(Number(solver.values[i]), Number(setupValues[i]))) return false;
    }

    return true;
}
