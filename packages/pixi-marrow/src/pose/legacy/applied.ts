import { LOCAL_STRIDE, type PoseState, WORLD_STRIDE } from '../state';
import {
    DEG_RAD,
    NO_ROTATION_OR_REFLECTION,
    NO_SCALE,
    NO_SCALE_OR_REFLECTION,
    NORMAL,
    ONLY_TRANSLATION,
    PI,
    RAD_DEG,
} from './math';

/*
 * The official `Bone.updateAppliedTransform`: the applied pose that gives the world transform a
 * constraint wrote. `applied` holds ax, ay, arotation, ascaleX, ascaleY, ashearX and ashearY per
 * bone. Numbers go from one step to the next through `m`, because a number that is passed to a
 * call or returned from one can cost an allocation.
 */

/**
 * Scratch. First the parent matrix pa, pb, pc, pd. Then the inverse parts ia, ib, ic, id and the
 * inverse determinant pid. Then the matrix of the bone relative to its parent: ra, rb, rc, rd.
 */
const m = new Float64Array(13);
const PA = 0;
const PB = 1;
const PC = 2;
const PD = 3;
const IA = 4;
const IB = 5;
const IC = 6;
const ID = 7;
const PID = 8;
const RA = 9;
const RB = 10;
const RC = 11;
const RD = 12;

/** A bone without a parent. `o` is the index of its applied pose, `w` of its world transform. */
function rootApplied(pose: PoseState, applied: Float64Array, o: number, w: number): void {
    const world = pose.world;
    const a = Number(world[w]);
    const b = Number(world[w + 1]);
    const c = Number(world[w + 2]);
    const d = Number(world[w + 3]);

    applied[o] = Number(world[w + 4]) - pose.x;
    applied[o + 1] = Number(world[w + 5]) - pose.y;
    applied[o + 2] = Math.atan2(c, a) * RAD_DEG;
    applied[o + 3] = Math.sqrt(a * a + c * c);
    applied[o + 4] = Math.sqrt(b * b + d * d);
    applied[o + 5] = 0;
    applied[o + 6] = Math.atan2(a * b + c * d, a * d - b * c) * RAD_DEG;
}

/** The parent matrix a bone with inherit mode `noRotationOrReflection` sees in 4.2. Changes pb, pd, ia and ib. */
function withoutRotation(pose: PoseState): void {
    const pa = Number(m[PA]);
    const pc = Number(m[PC]);
    const s = Math.abs(pa * Number(m[PD]) - Number(m[PB]) * pc) / (pa * pa + pc * pc);
    const pb = (-pc * pose.scaleX * s) / pose.scaleY;
    const pd = (pa * pose.scaleY * s) / pose.scaleX;
    const pid = 1 / (pa * pd - pb * pc);

    m[PB] = pb;
    m[PD] = pd;
    m[IA] = pd * pid;
    m[IB] = pb * pid;
}

/**
 * The parent matrix a bone with inherit mode `noScale` or `noScaleOrReflection` sees in 4.2.
 * The rotation is the animated local one at `o`, not the applied one, as in the official code.
 */
function withoutScale(pose: PoseState, mode: number, o: number): void {
    const radians = Number(pose.local[o + 2]) * DEG_RAD;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    let pa = (Number(m[PA]) * cos + Number(m[PB]) * sin) / pose.scaleX;
    let pc = (Number(m[PC]) * cos + Number(m[PD]) * sin) / pose.scaleY;
    let s = Math.sqrt(pa * pa + pc * pc);

    if (s > 0.00001) s = 1 / s;
    pa *= s;
    pc *= s;
    s = Math.sqrt(pa * pa + pc * pc);
    if (mode === NO_SCALE && Number(m[PID]) < 0 !== (pose.scaleX < 0 !== pose.scaleY < 0)) s = -s;
    const r = PI / 2 + Math.atan2(pc, pa);
    const pb = Math.cos(r) * s;
    const pd = Math.sin(r) * s;
    const pid = 1 / (pa * pd - pb * pc);

    m[PA] = pa;
    m[PC] = pc;
    m[IA] = pd * pid;
    m[IB] = pb * pid;
    m[IC] = pc * pid;
    m[ID] = pa * pid;
}

/**
 * Writes rotation, scale and shear from the matrix of a bone relative to its parent, which is in
 * `m` at `RA`. In 4.2 the shear has the other sign.
 */
function decompose(applied: Float64Array, o: number, v41: boolean): void {
    const ra = Number(m[RA]);
    const rb = Number(m[RB]);
    const rc = Number(m[RC]);
    const rd = Number(m[RD]);
    const scaleX = Math.sqrt(ra * ra + rc * rc);

    applied[o + 5] = 0;
    if (scaleX > 0.0001) {
        const det = ra * rd - rb * rc;
        const shear = Math.atan2(ra * rb + rc * rd, det);

        applied[o + 3] = scaleX;
        applied[o + 4] = det / scaleX;
        applied[o + 6] = v41 ? shear * RAD_DEG : -shear * RAD_DEG;
        applied[o + 2] = Math.atan2(rc, ra) * RAD_DEG;
    } else {
        applied[o + 3] = 0;
        applied[o + 4] = Math.sqrt(rb * rb + rd * rd);
        applied[o + 6] = 0;
        applied[o + 2] = 90 - Math.atan2(rd, rb) * RAD_DEG;
    }
}

/** A bone with a parent in 4.1, which ignores the inherit mode. */
function childApplied41(pose: PoseState, applied: Float64Array, o: number, w: number, p: number): void {
    const world = pose.world;
    const pa = Number(world[p]);
    const pb = Number(world[p + 1]);
    const pc = Number(world[p + 2]);
    const pd = Number(world[p + 3]);
    const pid = 1 / (pa * pd - pb * pc);
    const dx = Number(world[w + 4]) - Number(world[p + 4]);
    const dy = Number(world[w + 5]) - Number(world[p + 5]);
    const a = Number(world[w]);
    const b = Number(world[w + 1]);
    const c = Number(world[w + 2]);
    const d = Number(world[w + 3]);

    applied[o] = dx * pd * pid - dy * pb * pid;
    applied[o + 1] = dy * pa * pid - dx * pc * pid;
    const ia = pid * pd;
    const id = pid * pa;
    const ib = pid * pb;
    const ic = pid * pc;

    m[RA] = ia * a - ib * c;
    m[RB] = ia * b - ib * d;
    m[RC] = id * c - ic * a;
    m[RD] = id * d - ic * b;
    decompose(applied, o, true);
}

/** A bone with a parent in 4.2. `mode` is its inherit mode. */
function childApplied42(pose: PoseState, applied: Float64Array, o: number, w: number, p: number, mode: number): void {
    const world = pose.world;
    const pa = Number(world[p]);
    const pb = Number(world[p + 1]);
    const pc = Number(world[p + 2]);
    const pd = Number(world[p + 3]);
    const pid = 1 / (pa * pd - pb * pc);
    const dx = Number(world[w + 4]) - Number(world[p + 4]);
    const dy = Number(world[w + 5]) - Number(world[p + 5]);
    const a = Number(world[w]);
    const b = Number(world[w + 1]);
    const c = Number(world[w + 2]);
    const d = Number(world[w + 3]);

    m[PA] = pa;
    m[PB] = pb;
    m[PC] = pc;
    m[PD] = pd;
    m[IA] = pd * pid;
    m[IB] = pb * pid;
    m[IC] = pc * pid;
    m[ID] = pa * pid;
    m[PID] = pid;
    applied[o] = dx * Number(m[IA]) - dy * Number(m[IB]);
    applied[o + 1] = dy * Number(m[ID]) - dx * Number(m[IC]);
    if (mode === ONLY_TRANSLATION) {
        m[RA] = a;
        m[RB] = b;
        m[RC] = c;
        m[RD] = d;
    } else {
        if (mode === NO_ROTATION_OR_REFLECTION) withoutRotation(pose);
        else if (mode === NO_SCALE || mode === NO_SCALE_OR_REFLECTION) withoutScale(pose, mode, o);
        const ia = Number(m[IA]);
        const ib = Number(m[IB]);
        const ic = Number(m[IC]);
        const id = Number(m[ID]);

        m[RA] = ia * a - ib * c;
        m[RB] = ia * b - ib * d;
        m[RC] = id * c - ic * a;
        m[RD] = id * d - ic * b;
    }
    decompose(applied, o, false);
}

/**
 * The official `Bone.updateAppliedTransform`: computes the applied pose of a bone from its world
 * transform and the one of its parent. The 4.1 runtime ignores the inherit mode. The 4.2 runtime
 * takes it into account and reads the animated local rotation for the modes without scale.
 */
export function updateAppliedTransform(
    pose: PoseState,
    applied: Float64Array,
    parents: Int16Array,
    bone: number,
    v41: boolean,
): void {
    const o = bone * LOCAL_STRIDE;
    const w = bone * WORLD_STRIDE;
    const parent = parents[bone] ?? -1;

    if (parent < 0) rootApplied(pose, applied, o, w);
    else if (v41) childApplied41(pose, applied, o, w, parent * WORLD_STRIDE);
    else childApplied42(pose, applied, o, w, parent * WORLD_STRIDE, pose.inherit[bone] ?? NORMAL);
}
