import { nextVersion, type PoseState } from '../state';
import { SHARED, STAMP, STAMPED } from './curves';

/*
 * The stamps of a pose state say what changed, so that a renderer can leave the rest alone. An
 * update or a command opens them, sets the stamp of each thing it changes and closes them. The
 * version moves only when a stamp was set, so an update that changes nothing leaves it alone.
 *
 * The version to stamp with goes through `SHARED`, like the times of an update: the code that
 * changes a slot is reached from many places, and none of them has to hand it down.
 */

/** Starts the stamps of an update or a command. */
export function openStamps(pose: PoseState): void {
    SHARED[STAMP] = nextVersion(pose.version);
    SHARED[STAMPED] = 0;
}

/** Ends the stamps of an update or a command: raises the version when one was set. */
export function closeStamps(pose: PoseState): void {
    if (Number(SHARED[STAMPED]) !== 0) pose.version = Number(SHARED[STAMP]);
}

/** Notes that the color, the dark color, the attachment, the sequence index or the deform of a slot changed. */
export function stampSlot(pose: PoseState, slot: number): void {
    pose.slotStamps[slot] = Number(SHARED[STAMP]);
    SHARED[STAMPED] = 1;
}

/** Notes that the world transform or the activity of a bone changed. */
export function stampBone(pose: PoseState, bone: number): void {
    pose.boneStamps[bone] = Number(SHARED[STAMP]);
    SHARED[STAMPED] = 1;
}

/** Notes that the draw order changed. */
export function stampDrawOrder(pose: PoseState): void {
    pose.drawOrderStamp = Number(SHARED[STAMP]);
    SHARED[STAMPED] = 1;
}
