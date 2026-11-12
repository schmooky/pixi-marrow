import { MarrowError } from '../../base/errors';
import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import { CONSTRAINT_STRIDE, IK_MIX, type LegacyConstraint } from './constraints';
import { NO_ROTATION_OR_REFLECTION, NO_SCALE, NO_SCALE_OR_REFLECTION, ONLY_TRANSLATION, RAD_DEG } from './math';
import type { Solver } from './solver';
import { updateBone } from './world';

/*
 * The official one bone IK, `IkConstraint.apply1`, cut into steps. The numbers one step hands to
 * the next live in `t`: a number that is passed to a call or returned from one can cost an
 * allocation. The arithmetic and its order are the official ones.
 */

/** Scratch of one bone IK: the target in the space of the bone, the rotation toward it, and the scale. */
const t = new Float64Array(5);
const TX = 0;
const TY = 1;
const ROTATION = 2;
const SX = 3;
const SY = 4;

/** The error for an IK constraint whose bones have no parent to turn in. The official runtime throws there too. */
export function noParent(constraint: LegacyConstraint, what: string): MarrowError {
    return new MarrowError('invalid-data', `The IK constraint "${constraint.name}" ${what}.`, {
        fix: 'Constrain bones below the root bone: one bone IK needs a parent, two bone IK a parent of the parent.',
    });
}

/**
 * The first part of the official `apply1`: the target in the space of the bone and the rotation
 * that points the bone at it. Writes `TX`, `TY` and `ROTATION`.
 */
function ik1Rotation(solver: Solver, constraint: LegacyConstraint, bone: number, parent: number): void {
    const { pose, applied } = solver;
    const world = pose.world;
    const o = bone * LOCAL_STRIDE;
    const w = bone * WORLD_STRIDE;
    const p = parent * WORLD_STRIDE;
    const targetX = Number(world[constraint.target * WORLD_STRIDE + 4]);
    const targetY = Number(world[constraint.target * WORLD_STRIDE + 5]);
    const mode = pose.inherit[bone];
    const pa = Number(world[p]);
    const pc = Number(world[p + 2]);
    let pb = Number(world[p + 1]);
    let pd = Number(world[p + 3]);
    let rotationIK = -Number(applied[o + 5]) - Number(applied[o + 2]);
    let tx = 0;
    let ty = 0;

    if (mode === ONLY_TRANSLATION) {
        // each axis takes the sign of the scale of the skeleton: the official signum
        tx = (targetX - Number(world[w + 4])) * (pose.scaleX > 0 ? 1 : pose.scaleX < 0 ? -1 : 0);
        ty = (targetY - Number(world[w + 5])) * (pose.scaleY > 0 ? 1 : pose.scaleY < 0 ? -1 : 0);
    } else {
        if (mode === NO_ROTATION_OR_REFLECTION) {
            const s = Math.abs(pa * pd - pb * pc) / Math.max(0.0001, pa * pa + pc * pc);
            const sa = pa / pose.scaleX;
            const sc = pc / pose.scaleY;

            pb = -sc * s * pose.scaleX;
            pd = sa * s * pose.scaleY;
            rotationIK += Math.atan2(sc, sa) * RAD_DEG;
        }
        const x = targetX - Number(world[p + 4]);
        const y = targetY - Number(world[p + 5]);
        const d = pa * pd - pb * pc;

        // written this way round so that a determinant that is not a number takes the official branch
        if (!(Math.abs(d) <= 0.0001)) {
            tx = (x * pd - y * pb) / d - Number(applied[o]);
            ty = (y * pa - x * pc) / d - Number(applied[o + 1]);
        }
    }
    rotationIK += Math.atan2(ty, tx) * RAD_DEG;
    if (Number(applied[o + 3]) < 0) rotationIK += 180;
    if (rotationIK > 180) rotationIK -= 360;
    else if (rotationIK < -180) rotationIK += 360;
    t[TX] = tx;
    t[TY] = ty;
    t[ROTATION] = rotationIK;
}

/**
 * The second part of the official `apply1`: the scale that makes the bone reach the target.
 * Reads `TX` and `TY`, writes `SX` and `SY`. The versions differ in how they compare the distance.
 */
function ik1Scale(
    solver: Solver,
    constraint: LegacyConstraint,
    bone: number,
    compress: boolean,
    stretch: boolean,
    uniform: boolean,
): void {
    const { pose, applied } = solver;
    const world = pose.world;
    const o = bone * LOCAL_STRIDE;
    const w = bone * WORLD_STRIDE;
    const mode = pose.inherit[bone];
    const alpha = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + IK_MIX]);
    let sx = Number(applied[o + 3]);
    let sy = Number(applied[o + 4]);
    let tx = Number(t[TX]);
    let ty = Number(t[TY]);

    if (mode === NO_SCALE || mode === NO_SCALE_OR_REFLECTION) {
        tx = Number(world[constraint.target * WORLD_STRIDE + 4]) - Number(world[w + 4]);
        ty = Number(world[constraint.target * WORLD_STRIDE + 5]) - Number(world[w + 5]);
    }
    const b = Number(solver.rig.model.bones.lengths[bone]) * sx;
    let s = 1;
    let scaled = false;

    if (solver.rig.v41) {
        const dd = Math.sqrt(tx * tx + ty * ty);

        scaled = (compress && dd < b) || (stretch && dd > b && b > 0.0001);
        if (scaled) s = (dd / b - 1) * alpha + 1;
    } else if (b > 0.0001) {
        const dd = tx * tx + ty * ty;

        scaled = (compress && dd < b * b) || (stretch && dd > b * b);
        if (scaled) s = (Math.sqrt(dd) / b - 1) * alpha + 1;
    }
    if (scaled) {
        sx *= s;
        if (uniform) sy *= s;
    }
    t[SX] = sx;
    t[SY] = sy;
}

/** The official `apply1`: one bone IK. The target and the mix are those of the constraint. */
export function ik1(
    solver: Solver,
    constraint: LegacyConstraint,
    bone: number,
    compress: boolean,
    stretch: boolean,
    uniform: boolean,
): void {
    const { applied, rig } = solver;
    const parents = rig.model.bones.parents;
    const parent = parents[bone] ?? -1;
    const o = bone * LOCAL_STRIDE;

    if (parent < 0) throw noParent(constraint, 'constrains a bone without a parent');
    ik1Rotation(solver, constraint, bone, parent);
    t[SX] = Number(applied[o + 3]);
    t[SY] = Number(applied[o + 4]);
    if (compress || stretch) ik1Scale(solver, constraint, bone, compress, stretch, uniform);
    const alpha = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + IK_MIX]);

    applied[o + 2] = Number(applied[o + 2]) + Number(t[ROTATION]) * alpha;
    applied[o + 3] = Number(t[SX]);
    applied[o + 4] = Number(t[SY]);
    updateBone(solver.pose, applied, parents, bone, rig.v41);
}
