import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import { modifyLocal } from './bone-pose';
import {
    EPSILON,
    NO_ROTATION_OR_REFLECTION,
    NO_SCALE,
    NO_SCALE_OR_REFLECTION,
    ONLY_TRANSLATION,
    RAD_DEG,
} from './math';
import { constraintError } from './solver';
import { CONSTRAINT_STRIDE, IK_MIX, type IkPlan } from './solver-types';
import type { Pose43 } from './types';

/*
 * The official one bone IK. Typed arrays are read in place and the numbers of one solution stay
 * in the variables of one function, for the reasons given in solve.ts.
 */

const ROTATION = 2;
const SCALE_X = 3;
const SCALE_Y = 4;
const SHEAR_X = 5;
const SCALE_Y_UNIFORM = 1;
const SCALE_Y_VOLUME = 2;

/** The factor a bone is scaled by, on its way to `scaleBone`. No call keeps it across a return. */
const FACTOR = new Float64Array(1);

/** The parent of a bone. The official code fails with a TypeError for a bone that has none. */
export function ikParent(pose: Pose43, plan: IkPlan, bone: number): number {
    const parent = pose.rig.model.bones.parents[bone] ?? -1;

    if (parent < 0) {
        const name = pose.rig.model.bones.names[bone];

        throw constraintError('ik', plan.name, `moves the bone "${name}", which has no parent.`);
    }

    return parent;
}

/**
 * Scales a bone on X by a factor, and on Y as the official `ScaleYMode` says: not at all, by the
 * same factor, or so that the area of the bone stays.
 *
 * @param l Where the local numbers of the bone start.
 * @param scaleYMode The official `ScaleYMode` number.
 */
export function scaleBone(local: Float64Array, l: number, scaleYMode: number, factors: Float64Array, at: number): void {
    const s = Number(factors[at]);

    local[l + SCALE_X] = Number(local[l + SCALE_X]) * s;
    if (scaleYMode === SCALE_Y_UNIFORM) local[l + SCALE_Y] = Number(local[l + SCALE_Y]) * s;
    else if (scaleYMode === SCALE_Y_VOLUME) {
        local[l + SCALE_Y] = Number(local[l + SCALE_Y]) / (s < 0.7 ? 0.25 + 0.642857 * s : s);
    }
}

/**
 * The official one bone IK: turns a bone toward the target bone of the constraint, and with
 * `compress` or `stretch` scales it until it reaches the target.
 *
 * @param scaleYMode The official `ScaleYMode` number.
 */
export function solveOneBone(
    pose: Pose43,
    plan: IkPlan,
    bone: number,
    compress: boolean,
    stretch: boolean,
    scaleYMode: number,
): void {
    modifyLocal(pose, bone);
    const parent = ikParent(pose, plan, bone);
    const { state } = pose;
    const { world } = state;
    const { local } = pose.solve;
    const mix = Number(pose.solve.values[plan.index * CONSTRAINT_STRIDE + IK_MIX]);
    const inherit = state.inherit[bone];
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const t = plan.target * WORLD_STRIDE;
    const rotation = Number(local[l + ROTATION]);
    let rotationIK = -Number(local[l + SHEAR_X]) - rotation;
    // the target minus the bone, in the space the bone turns in
    let tx = 0;
    let ty = 0;

    if (inherit === ONLY_TRANSLATION) {
        // in world coordinates. Each axis takes the sign of the scale of the skeleton: the official signum.
        const sx = state.scaleX;
        const sy = state.scaleY;

        tx = (Number(world[t + 4]) - Number(world[o + 4])) * (sx > 0 ? 1 : sx < 0 ? -1 : 0);
        ty = (Number(world[t + 5]) - Number(world[o + 5])) * (sy > 0 ? 1 : sy < 0 ? -1 : 0);
    } else {
        // in the coordinates of the parent of the bone
        const p = parent * WORLD_STRIDE;
        const pa = Number(world[p]);
        const pc = Number(world[p + 2]);
        let pb = Number(world[p + 1]);
        let pd = Number(world[p + 3]);

        if (inherit === NO_ROTATION_OR_REFLECTION) {
            // the bone drops the rotation of its parent: it takes the axes of the parent without their rotation
            const s = Math.abs(pa * pd - pb * pc) / Math.max(EPSILON, pa * pa + pc * pc);
            const sa = pa / state.scaleX;
            const sc = pc / state.scaleY;

            pb = -sc * s * state.scaleX;
            pd = sa * s * state.scaleY;
            rotationIK += Math.atan2(sc, sa) * RAD_DEG;
        }
        const x = Number(world[t + 4]) - Number(world[p + 4]);
        const y = Number(world[t + 5]) - Number(world[p + 5]);
        const d = pa * pd - pb * pc;

        // written as in the official code, so that a NaN takes the second branch too
        if (Math.abs(d) <= EPSILON) {
            tx = 0;
            ty = 0;
        } else {
            tx = (x * pd - y * pb) / d - Number(local[l]);
            ty = (y * pa - x * pc) / d - Number(local[l + 1]);
        }
    }
    rotationIK += Math.atan2(ty, tx) * RAD_DEG;
    if (Number(local[l + SCALE_X]) < 0) rotationIK += 180;
    if (rotationIK > 180) rotationIK -= 360;
    else if (rotationIK <= -180) rotationIK += 360;
    local[l + ROTATION] = rotation + rotationIK * mix;
    if (!compress && !stretch) return;
    if (inherit === NO_SCALE || inherit === NO_SCALE_OR_REFLECTION) {
        tx = Number(world[t + 4]) - Number(world[o + 4]);
        ty = Number(world[t + 5]) - Number(world[o + 5]);
    }
    // the compress and stretch part: scales the bone until it reaches the target
    const b = Number(pose.rig.model.bones.lengths[bone]) * Number(local[l + SCALE_X]);
    const dd = tx * tx + ty * ty;

    // written as in the official code, so that a NaN ends here too
    if (!(b > EPSILON)) return;
    if ((compress && dd < b * b) || (stretch && dd > b * b)) {
        FACTOR[0] = (Math.sqrt(dd) / b - 1) * mix + 1;
        scaleBone(local, l, scaleYMode, FACTOR, 0);
    }
}
