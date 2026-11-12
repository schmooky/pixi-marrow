import { idlePhysics, physicsRest } from './physics-rest';
import { leaveBusy, updateWorld } from './solve';
import { keepShown, shownSame } from './split';
import type { Pose43 } from './types';

/*
 * An update whose result is known is not computed. The world pass is a function of what it
 * reads: the animated pose, the update order, the placement of the skeleton, the forces and the
 * state of the physics. While none of that changes, every number it would write is there already.
 */

/** True when each number of the placement and the forces that is zero has the sign it had in the last solved update. */
function sameZeros(pose: Pose43): boolean {
    const { state } = pose;
    const { placed } = pose.solve;

    return (
        1 / Number(placed[0]) === 1 / state.x &&
        1 / Number(placed[1]) === 1 / state.y &&
        1 / Number(placed[2]) === 1 / state.scaleX &&
        1 / Number(placed[3]) === 1 / state.scaleY &&
        1 / Number(placed[4]) === 1 / state.windX &&
        1 / Number(placed[5]) === 1 / state.windY &&
        1 / Number(placed[6]) === 1 / state.gravityX &&
        1 / Number(placed[7]) === 1 / state.gravityY
    );
}

/**
 * Notes the placement of the skeleton and the forces on its physics. Returns true when one of
 * them is not what the last solved update read. They are fields anyone can write, so they are
 * compared.
 */
function placedAnew(pose: Pose43): boolean {
    const { state } = pose;
    const { placed } = pose.solve;
    const yDown = state.yDown ? 1 : 0;
    const { x, y, scaleX, scaleY, windX, windY, gravityX, gravityY } = state;

    // number by number, and a zero by its sign too: see solve-tight.ts
    if (
        placed[0] === x &&
        placed[1] === y &&
        placed[2] === scaleX &&
        placed[3] === scaleY &&
        placed[4] === windX &&
        placed[5] === windY &&
        placed[6] === gravityX &&
        placed[7] === gravityY &&
        placed[8] === yDown &&
        (x * y * scaleX * scaleY * windX * windY * gravityX * gravityY !== 0 || sameZeros(pose))
    ) {
        return false;
    }
    placed[0] = state.x;
    placed[1] = state.y;
    placed[2] = state.scaleX;
    placed[3] = state.scaleY;
    placed[4] = state.windX;
    placed[5] = state.windY;
    placed[6] = state.gravityX;
    placed[7] = state.gravityY;
    placed[8] = yDown;

    return true;
}

/**
 * Other code wrote the arrays of the pose state and raised its version. Nothing the engine noted
 * about the pose holds any more: the next update applies every timeline, carries every slot over
 * and poses every bone, and it compares with nothing it kept.
 *
 * With sliders that animate slots, the slot arrays of the pose state hold the applied pose. What
 * other code wrote there is replaced by the animated pose in that update.
 */
export function distrust(pose: Pose43): void {
    const { solve } = pose;
    const { split } = solve;

    solve.dirty = true;
    solve.force = true;
    solve.stale = true;
    solve.orderAt = -1;
    solve.held?.fill(null);
    if (split === null) return;
    split.touched.fill(1);
    split.orderTouched = true;
}

/** True for the updates in a row that are looked at for a pose that rests: 1, 2, 4 and so on, then every 64th. */
const due = (count: number): boolean => (count & (count - 1)) === 0 || count % 64 === 0;

/**
 * The official `Skeleton.updateWorldTransform`, left out when its result is known. It runs when
 * something it reads may have changed. Then it runs again with unchanged inputs until one run
 * shows that the pose rests: it left every bone, every slot and every physics constraint as it
 * was. From there on nothing a renderer reads changes, and only the clocks of the physics move on.
 *
 * Unchanged inputs alone are no proof. The world pass reads some of what the pass before wrote:
 * a constraint can read a bone that is posed after it, and physics keep a state.
 */
export function solvePose(pose: Pose43): void {
    const { solve } = pose;
    const placed = placedAnew(pose);
    const calm = !solve.dirty && !placed;

    if (calm && solve.resting) {
        idlePhysics(pose);

        return;
    }
    // a skeleton that was placed anew moves as a whole
    if (placed) solve.force = true;
    solve.calm = calm ? solve.calm + 1 : 0;
    solve.probing = calm && due(solve.calm);
    // a pose that may rest is looked at
    if (solve.probing && solve.busy > 0) leaveBusy(solve);
    if (solve.probing) keepShown(pose);
    const moved = updateWorld(pose);

    solve.resting = solve.probing && !moved && shownSame(pose) && physicsRest(pose);
    solve.probing = false;
}
