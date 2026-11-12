import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import { modifyLocal } from './bone-pose';
import { ikParent, scaleBone, solveOneBone } from './ik-one';
import { EPSILON, NORMAL, PI, RAD_DEG } from './math';
import { CONSTRAINT_STRIDE, IK_BEND_DIRECTION, IK_MIX, IK_SOFTNESS, type IkPlan } from './solver-types';
import type { Pose43 } from './types';

/*
 * The official two bone IK. Typed arrays are read in place. The numbers of one solution stay in
 * the variables of `solveTwoBones`, and those the functions that find the angles share go through
 * an array, for the reasons given in solve.ts.
 */

const ROTATION = 2;
const SCALE_X = 3;
const SCALE_Y = 4;
const SHEAR_X = 5;
const SCALE_Y_NONE = 0;

/** The numbers the functions here share. No call keeps them across a return. */
const T = new Float64Array(10);
/** The target in the space of the parent of the parent bone: x, y and the squared distance. */
const TX = 0;
const TY = 1;
const DD = 2;
/** The length of the parent bone and of the child bone. */
const L1 = 3;
const L2 = 4;
/** The sizes of the scale X and Y of the parent bone. */
const PSX = 5;
const PSY = 6;
/** The angles of the parent bone and of the child bone, in radians. */
const A1 = 7;
const A2 = 8;
/** The factor a stretch scales the parent bone by. */
const FACTOR = 9;

/**
 * The official two bone IK for a parent bone with different scales on its axes and a target out
 * of reach. The tip of the child bone goes to the nearest or the farthest point it can be at.
 */
function solveExtreme(bendDir: number): void {
    const l1 = Number(T[L1]);
    const l2 = Number(T[L2]);
    const a = Number(T[PSX]) * l2;
    const b = Number(T[PSY]) * l2;
    const ta = Math.atan2(Number(T[TY]), Number(T[TX]));
    let minAngle = PI;
    let minX = l1 - a;
    let minDist = minX * minX;
    let minY = 0;
    let maxAngle = 0;
    let maxX = l1 + a;
    let maxDist = maxX * maxX;
    let maxY = 0;
    let c = (-a * l1) / (a * a - b * b);

    if (c >= -1 && c <= 1) {
        c = Math.acos(c);
        const x = a * Math.cos(c) + l1;
        const y = b * Math.sin(c);
        const d = x * x + y * y;

        if (d < minDist) {
            minAngle = c;
            minDist = d;
            minX = x;
            minY = y;
        }
        if (d > maxDist) {
            maxAngle = c;
            maxDist = d;
            maxX = x;
            maxY = y;
        }
    }
    if (Number(T[DD]) <= (minDist + maxDist) * 0.5) {
        T[A1] = ta - Math.atan2(minY * bendDir, minX);
        T[A2] = minAngle * bendDir;
    } else {
        T[A1] = ta - Math.atan2(maxY * bendDir, maxX);
        T[A2] = maxAngle * bendDir;
    }
}

/**
 * The official two bone IK for a parent bone with different scales on its axes. Reads the target,
 * the bone lengths and the scales from `T` and writes the angles of both bones to it.
 *
 * @param bendDir The bend direction, 1 or -1. A whole number, so that passing it allocates nothing.
 */
function solveNonUniform(bendDir: number): void {
    const tx = Number(T[TX]);
    const ty = Number(T[TY]);
    const dd = Number(T[DD]);
    const l1 = Number(T[L1]);
    const l2 = Number(T[L2]);
    const psx = Number(T[PSX]);
    const psy = Number(T[PSY]);
    const a = psx * l2;
    const b = psy * l2;
    const aa = a * a;
    const bb = b * b;
    const c = bb * l1 * l1 + aa * dd - aa * bb;
    const c1 = -2 * bb * l1;
    const c2 = bb - aa;
    const d = c1 * c1 - 4 * c2 * c;

    if (d >= 0) {
        let q = Math.sqrt(d);

        if (c1 < 0) q = -q;
        q = -(c1 + q) * 0.5;
        const r0 = q / c2;
        const r1 = c / q;
        const r = Math.abs(r0) < Math.abs(r1) ? r0 : r1;
        const rest = dd - r * r;

        if (rest >= 0) {
            const y = Math.sqrt(rest) * bendDir;

            T[A1] = Math.atan2(ty, tx) - Math.atan2(y, r);
            T[A2] = Math.atan2(y / psy, (r - l1) / psx);

            return;
        }
    }
    solveExtreme(bendDir);
}

/**
 * The official two bone IK: bends a parent bone and its child so that the tip of the child
 * reaches the target bone of the constraint. Both bones must inherit all of their parent.
 */
export function solveTwoBones(pose: Pose43, plan: IkPlan, parent: number, child: number, stretch: boolean): void {
    const { state } = pose;

    if (state.inherit[parent] !== NORMAL || state.inherit[child] !== NORMAL) return;
    modifyLocal(pose, parent);
    modifyLocal(pose, child);
    const { world } = state;
    const { local, values } = pose.solve;
    const v = plan.index * CONSTRAINT_STRIDE;
    const pl = parent * LOCAL_STRIDE;
    const cl = child * LOCAL_STRIDE;
    const po = parent * WORLD_STRIDE;
    // the position of the parent bone is read here: moving the child bone can change it when both are one bone
    const px = Number(local[pl]);
    const py = Number(local[pl + 1]);
    let psx = Number(local[pl + SCALE_X]);
    let psy = Number(local[pl + SCALE_Y]);
    let csx = Number(local[cl + SCALE_X]);
    // the degrees added for a parent bone and a child bone with a negative scale X, and the sign of the scales of the parent bone
    let os1 = 0;
    let os2 = 0;
    let s2 = 1;

    if (psx < 0) {
        psx = -psx;
        os1 = 180;
        s2 = -1;
    }
    if (psy < 0) {
        psy = -psy;
        s2 = -s2;
    }
    if (csx < 0) {
        csx = -csx;
        os2 = 180;
    }
    const uniform = Math.abs(psx - psy) <= EPSILON;
    // where the child bone starts in the world. For a parent bone with different scales and for
    // a stretch it is moved onto the x axis of the parent bone first.
    const cx = Number(local[cl]);
    let cwx = Number(world[po]) * cx;
    let cwy = Number(world[po + 2]) * cx;

    if (!uniform || stretch) local[cl + 1] = 0;
    else {
        const cy = Number(local[cl + 1]);

        cwx += Number(world[po + 1]) * cy;
        cwy += Number(world[po + 3]) * cy;
    }
    cwx += Number(world[po + 4]);
    cwy += Number(world[po + 5]);
    // the bone lengths and the target, in the space the parent bone is placed in, relative to the parent bone
    const t = plan.target * WORLD_STRIDE;
    const pp = ikParent(pose, plan, parent) * WORLD_STRIDE;
    const a = Number(world[pp]);
    const b = Number(world[pp + 1]);
    const c = Number(world[pp + 2]);
    const d = Number(world[pp + 3]);
    const worldX = Number(world[pp + 4]);
    const worldY = Number(world[pp + 5]);
    let id = a * d - b * c;
    let x = cwx - worldX;
    let y = cwy - worldY;

    id = Math.abs(id) <= EPSILON ? 0 : 1 / id;
    const dx = (x * d - y * b) * id - px;
    const dy = (y * a - x * c) * id - py;
    const l1 = Math.sqrt(dx * dx + dy * dy);
    const l2 = Number(pose.rig.model.bones.lengths[child]) * csx;

    if (l1 < EPSILON) {
        // the child bone starts where the parent bone does: the official code solves one bone only
        solveOneBone(pose, plan, parent, false, stretch, SCALE_Y_NONE);
        local[cl + ROTATION] = 0;

        return;
    }
    x = Number(world[t + 4]) - worldX;
    y = Number(world[t + 5]) - worldY;
    let tx = (x * d - y * b) * id - px;
    let ty = (y * a - x * c) * id - py;
    let dd = tx * tx + ty * ty;

    if (values[v + IK_SOFTNESS] !== 0) {
        // the official softness rule: pulls a target near the reach of the two bones in
        const td = Math.sqrt(dd);
        const softness = Number(values[v + IK_SOFTNESS]) * (psx * (csx + 1) * 0.5);
        const sd = td - l1 - l2 * psx + softness;

        if (sd > 0) {
            let p = Math.min(1, sd / (softness * 2)) - 1;

            p = (sd - softness * (1 - p * p)) / td;
            tx -= p * tx;
            ty -= p * ty;
            dd = tx * tx + ty * ty;
        }
    }
    const mix = Number(values[v + IK_MIX]);
    const bendDir = Number(values[v + IK_BEND_DIRECTION]);
    // the angles of the parent bone and of the child bone, in radians
    let angle1 = 0;
    let angle2 = 0;

    if (uniform) {
        // the parent bone has the same scale on both axes: the law of cosines
        const reach = l2 * psx;
        let cos = (dd - l1 * l1 - reach * reach) / (2 * l1 * reach);

        if (cos < -1) {
            cos = -1;
            angle2 = Math.PI * bendDir;
        } else if (cos > 1) {
            cos = 1;
            if (stretch) {
                // the target is out of reach: the official stretch scales the parent bone
                T[FACTOR] = (Math.sqrt(dd) / (l1 + reach) - 1) * mix + 1;
                scaleBone(local, pl, plan.scaleYMode, T, FACTOR);
            }
        } else angle2 = Math.acos(cos) * bendDir;
        const along = l1 + reach * cos;
        const across = reach * Math.sin(angle2);

        angle1 = Math.atan2(ty * along - tx * across, tx * along + ty * across);
    } else {
        T[TX] = tx;
        T[TY] = ty;
        T[DD] = dd;
        T[L1] = l1;
        T[L2] = l2;
        T[PSX] = psx;
        T[PSY] = psy;
        solveNonUniform(bendDir);
        angle1 = Number(T[A1]);
        angle2 = Number(T[A2]);
    }
    // turns both bones by the angles that were found: the end of the official two bone IK
    const os = Math.atan2(Number(local[cl + 1]), Number(local[cl])) * s2;
    const parentRotation = Number(local[pl + ROTATION]);
    let a1 = (angle1 - os) * RAD_DEG + os1 - parentRotation;

    if (a1 > 180) a1 -= 360;
    else if (a1 <= -180) a1 += 360;
    local[pl + ROTATION] = parentRotation + a1 * mix;
    // read after the parent bone is turned: the two bones can be one bone
    const childRotation = Number(local[cl + ROTATION]);
    let a2 = ((angle2 + os) * RAD_DEG - Number(local[cl + SHEAR_X])) * s2 + os2 - childRotation;

    if (a2 > 180) a2 -= 360;
    else if (a2 <= -180) a2 += 360;
    local[cl + ROTATION] = childRotation + a2 * mix;
}
