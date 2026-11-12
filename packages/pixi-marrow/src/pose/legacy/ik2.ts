import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import { CONSTRAINT_STRIDE, IK_BEND, IK_MIX, IK_SOFTNESS, IK_STRETCH, type LegacyConstraint } from './constraints';
import { ik1, noParent } from './ik1';
import { NORMAL, PI, RAD_DEG } from './math';
import type { Solver } from './solver';
import { updateBone } from './world';

/*
 * The official two bone IK, `IkConstraint.apply2`, cut into steps. The numbers one step hands to
 * the next live in `t`: a number that is passed to a call or returned from one can cost an
 * allocation. The arithmetic and its order are the official ones.
 */

/** Scratch of two bone IK. */
const t = new Float64Array(19);
const PSX = 0;
const PSY = 1;
const CSX = 2;
const OS1 = 3;
const OS2 = 4;
const S2 = 5;
const CX = 6;
const CY = 7;
const CWX = 8;
const CWY = 9;
const L1 = 10;
const L2 = 11;
const TX2 = 12;
const TY2 = 13;
const DD = 14;
const A1 = 15;
const A2 = 16;
const SX2 = 17;
const SY2 = 18;

/**
 * The start of the official `apply2`: the scales of the two bones without their signs, and the
 * child position in world space. Returns the official `u`: true when the parent scale is uniform.
 */
function ik2Start(solver: Solver, parent: number, child: number, stretch: boolean): boolean {
    const { pose, applied } = solver;
    const world = pose.world;
    const po = parent * LOCAL_STRIDE;
    const co = child * LOCAL_STRIDE;
    const pw = parent * WORLD_STRIDE;
    let psx = Number(applied[po + 3]);
    let psy = Number(applied[po + 4]);
    let csx = Number(applied[co + 3]);
    let s2 = 1;

    t[SX2] = psx;
    t[SY2] = psy;
    t[OS1] = 0;
    t[OS2] = 0;
    if (psx < 0) {
        psx = -psx;
        t[OS1] = 180;
        s2 = -1;
    }
    if (psy < 0) {
        psy = -psy;
        s2 = -s2;
    }
    if (csx < 0) {
        csx = -csx;
        t[OS2] = 180;
    }
    const cx = Number(applied[co]);
    const uniformScale = Math.abs(psx - psy) <= 0.0001;
    const a = Number(world[pw]);
    const c = Number(world[pw + 2]);

    if (!uniformScale || stretch) {
        t[CY] = 0;
        t[CWX] = a * cx + Number(world[pw + 4]);
        t[CWY] = c * cx + Number(world[pw + 5]);
    } else {
        const cy = Number(applied[co + 1]);

        t[CY] = cy;
        t[CWX] = a * cx + Number(world[pw + 1]) * cy + Number(world[pw + 4]);
        t[CWY] = c * cx + Number(world[pw + 3]) * cy + Number(world[pw + 5]);
    }
    t[PSX] = psx;
    t[PSY] = psy;
    t[CSX] = csx;
    t[S2] = s2;
    t[CX] = cx;

    return uniformScale;
}

/**
 * The middle of the official `apply2`: the lengths of the two bones and the target, in the space
 * of the parent of the parent, with softness. Writes `L1`, `L2`, `TX2`, `TY2` and `DD`.
 */
function ik2Reach(solver: Solver, constraint: LegacyConstraint, parent: number, child: number, grand: number): void {
    const { pose, applied } = solver;
    const world = pose.world;
    const g = grand * WORLD_STRIDE;
    const v = constraint.index * CONSTRAINT_STRIDE;
    const px = Number(applied[parent * LOCAL_STRIDE]);
    const py = Number(applied[parent * LOCAL_STRIDE + 1]);
    const psx = Number(t[PSX]);
    const csx = Number(t[CSX]);
    const a = Number(world[g]);
    const b = Number(world[g + 1]);
    const c = Number(world[g + 2]);
    const d = Number(world[g + 3]);
    let id = a * d - b * c;
    let x = Number(t[CWX]) - Number(world[g + 4]);
    let y = Number(t[CWY]) - Number(world[g + 5]);

    id = Math.abs(id) <= 0.0001 ? 0 : 1 / id;
    const dx = (x * d - y * b) * id - px;
    const dy = (y * a - x * c) * id - py;
    const l1 = Math.sqrt(dx * dx + dy * dy);
    const l2 = Number(solver.rig.model.bones.lengths[child]) * csx;

    x = Number(world[constraint.target * WORLD_STRIDE + 4]) - Number(world[g + 4]);
    y = Number(world[constraint.target * WORLD_STRIDE + 5]) - Number(world[g + 5]);
    let tx = (x * d - y * b) * id - px;
    let ty = (y * a - x * c) * id - py;
    let dd = tx * tx + ty * ty;
    let softness = Number(solver.values[v + IK_SOFTNESS]);

    if (softness !== 0) {
        softness *= psx * (csx + 1) * 0.5;
        const td = Math.sqrt(dd);
        const sd = td - l1 - l2 * psx + softness;

        if (sd > 0) {
            let p = Math.min(1, sd / (softness * 2)) - 1;

            p = (sd - softness * (1 - p * p)) / td;
            tx -= p * tx;
            ty -= p * ty;
            dd = tx * tx + ty * ty;
        }
    }
    t[L1] = l1;
    t[L2] = l2;
    t[TX2] = tx;
    t[TY2] = ty;
    t[DD] = dd;
}

/** The angles of the official `apply2` for a parent with uniform scale. Writes `A1`, `A2` and the stretched scale. */
function ik2Circle(solver: Solver, constraint: LegacyConstraint, stretch: boolean): void {
    const v = constraint.index * CONSTRAINT_STRIDE;
    const bendDir = Number(solver.values[v + IK_BEND]);
    const l1 = Number(t[L1]);
    const l2 = Number(t[L2]) * Number(t[PSX]);
    const tx = Number(t[TX2]);
    const ty = Number(t[TY2]);
    const dd = Number(t[DD]);
    let cos = (dd - l1 * l1 - l2 * l2) / (2 * l1 * l2);
    let a2 = 0;

    if (cos < -1) {
        cos = -1;
        a2 = Math.PI * bendDir;
    } else if (cos > 1) {
        cos = 1;
        a2 = 0;
        if (stretch) {
            const a = (Math.sqrt(dd) / (l1 + l2) - 1) * Number(solver.values[v + IK_MIX]) + 1;

            t[SX2] = Number(t[SX2]) * a;
            if (constraint.uniform) t[SY2] = Number(t[SY2]) * a;
        }
    } else {
        a2 = Math.acos(cos) * bendDir;
    }
    const a = l1 + l2 * cos;
    const b = l2 * Math.sin(a2);

    t[A1] = Math.atan2(ty * a - tx * b, tx * a + ty * b);
    t[A2] = a2;
}

/**
 * The angles of the official `apply2` for a parent with scale that is not uniform, where the tip
 * of the child moves on an ellipse: the exact solution. Returns false when there is none.
 */
function ik2EllipseRoots(solver: Solver, constraint: LegacyConstraint): boolean {
    const bendDir = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + IK_BEND]);
    const psx = Number(t[PSX]);
    const psy = Number(t[PSY]);
    const l1 = Number(t[L1]);
    const l2 = Number(t[L2]);
    const dd = Number(t[DD]);
    const a = psx * l2;
    const b = psy * l2;
    const aa = a * a;
    const bb = b * b;
    const c = bb * l1 * l1 + aa * dd - aa * bb;
    const c1 = -2 * bb * l1;
    const c2 = bb - aa;
    const d = c1 * c1 - 4 * c2 * c;

    if (!(d >= 0)) return false;
    let q = Math.sqrt(d);

    if (c1 < 0) q = -q;
    q = -(c1 + q) * 0.5;
    const r0 = q / c2;
    const r1 = c / q;
    const r = Math.abs(r0) < Math.abs(r1) ? r0 : r1;
    // 4.1 compares the squares, 4.2 the sign of their difference
    const fits = solver.rig.v41 ? r * r <= dd : dd - r * r >= 0;

    if (!fits) return false;
    const y = Math.sqrt(dd - r * r) * bendDir;

    t[A1] = Math.atan2(Number(t[TY2]), Number(t[TX2])) - Math.atan2(y, r);
    t[A2] = Math.atan2(y / psy, (r - l1) / psx);

    return true;
}

/** The angles of the official `apply2` when the ellipse has no exact solution: its nearest or farthest point. */
function ik2EllipseEnds(solver: Solver, constraint: LegacyConstraint): void {
    const bendDir = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + IK_BEND]);
    const l1 = Number(t[L1]);
    const l2 = Number(t[L2]);
    const dd = Number(t[DD]);
    const a = Number(t[PSX]) * l2;
    const b = Number(t[PSY]) * l2;
    const ta = Math.atan2(Number(t[TY2]), Number(t[TX2]));
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
    if (dd <= (minDist + maxDist) * 0.5) {
        t[A1] = ta - Math.atan2(minY * bendDir, minX);
        t[A2] = minAngle * bendDir;
    } else {
        t[A1] = ta - Math.atan2(maxY * bendDir, maxX);
        t[A2] = maxAngle * bendDir;
    }
}

/** The end of the official `apply2`: poses the parent, then the child. Reads `A1` and `A2`. */
function ik2Finish(solver: Solver, constraint: LegacyConstraint, parent: number, child: number): void {
    const { pose, applied, rig } = solver;
    const parents = rig.model.bones.parents;
    const po = parent * LOCAL_STRIDE;
    const co = child * LOCAL_STRIDE;
    const alpha = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + IK_MIX]);
    const s2 = Number(t[S2]);
    const os = Math.atan2(Number(t[CY]), Number(t[CX])) * s2;
    let rotation = Number(applied[po + 2]);
    let a1 = (Number(t[A1]) - os) * RAD_DEG + Number(t[OS1]) - rotation;

    if (a1 > 180) a1 -= 360;
    else if (a1 < -180) a1 += 360;
    applied[po + 2] = rotation + a1 * alpha;
    applied[po + 3] = Number(t[SX2]);
    applied[po + 4] = Number(t[SY2]);
    applied[po + 5] = 0;
    applied[po + 6] = 0;
    updateBone(pose, applied, parents, parent, rig.v41);
    rotation = Number(applied[co + 2]);
    let a2 = ((Number(t[A2]) + os) * RAD_DEG - Number(applied[co + 5])) * s2 + Number(t[OS2]) - rotation;

    if (a2 > 180) a2 -= 360;
    else if (a2 < -180) a2 += 360;
    applied[co + 1] = Number(t[CY]);
    applied[co + 2] = rotation + a2 * alpha;
    updateBone(pose, applied, parents, child, rig.v41);
}

/** The official `apply2`: two bone IK. 4.2 does nothing unless both bones inherit everything. */
export function ik2(solver: Solver, constraint: LegacyConstraint, parent: number, child: number): void {
    const { pose, applied, rig } = solver;
    const parents = rig.model.bones.parents;
    const stretch = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + IK_STRETCH]) !== 0;

    if (!rig.v41 && (pose.inherit[parent] !== NORMAL || pose.inherit[child] !== NORMAL)) return;
    const uniformScale = ik2Start(solver, parent, child, stretch);
    const grand = parents[parent] ?? -1;

    if (grand < 0) throw noParent(constraint, 'constrains a parent bone that has no parent itself');
    ik2Reach(solver, constraint, parent, child, grand);
    if (Number(t[L1]) < 0.0001) {
        // the child sits on the parent: point the parent at the target and lay the child along it
        ik1(solver, constraint, parent, false, stretch, false);
        applied[child * LOCAL_STRIDE + 1] = Number(t[CY]);
        applied[child * LOCAL_STRIDE + 2] = 0;
        updateBone(pose, applied, parents, child, rig.v41);

        return;
    }
    if (uniformScale) ik2Circle(solver, constraint, stretch);
    else if (!ik2EllipseRoots(solver, constraint)) ik2EllipseEnds(solver, constraint);
    ik2Finish(solver, constraint, parent, child);
}
