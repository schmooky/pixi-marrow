import { LOCAL_STRIDE, type PoseState, WORLD_STRIDE } from '../state';
import {
    COS_QUARTER,
    DEG_RAD,
    NO_ROTATION_OR_REFLECTION,
    NO_SCALE,
    NO_SCALE_OR_REFLECTION,
    NORMAL,
    ONLY_TRANSLATION,
    QUARTER,
    RAD_DEG,
    SIN_QUARTER,
} from './math';

/*
 * Every function here reads the pose of a bone from `applied`: the official ax, ay, arotation,
 * ascaleX, ascaleY, ashearX and ashearY, in the layout of the local pose. Constraints change them.
 *
 * Many bones of a rig are not turned. Their x axis is at an angle of 0 and their y axis at a
 * quarter turn. The cosine and the sine of those two angles are not computed: `Math.cos(0)` is 1
 * and `Math.sin(0)` is the 0 it is given, by the language, and those of the quarter turn are
 * `COS_QUARTER` and `SIN_QUARTER`. The results are the same numbers, bit for bit.
 */

/** Scratch of mode `noRotationOrReflection`: the parent matrix a, b, c, d without its rotation, then that rotation. */
const parentMatrix = new Float64Array(5);

/** A bone without a parent. `o` is the index of its applied pose, `w` of its world transform. */
function rootBone(pose: PoseState, local: Float64Array, o: number, w: number): void {
    const world = pose.world;
    const rotation = Number(local[o + 2]);
    const scaleX = Number(local[o + 3]);
    const scaleY = Number(local[o + 4]);
    const sx = pose.scaleX;
    const sy = pose.scaleY;
    const rx = (rotation + Number(local[o + 5])) * DEG_RAD;
    const ry = (rotation + 90 + Number(local[o + 6])) * DEG_RAD;
    let cosX = 1;
    let sinX = rx;
    let cosY = COS_QUARTER;
    let sinY = SIN_QUARTER;

    if (rx !== 0) {
        cosX = Math.cos(rx);
        sinX = Math.sin(rx);
    }
    if (ry !== QUARTER) {
        cosY = Math.cos(ry);
        sinY = Math.sin(ry);
    }
    world[w] = cosX * scaleX * sx;
    world[w + 1] = cosY * scaleY * sx;
    world[w + 2] = sinX * scaleX * sy;
    world[w + 3] = sinY * scaleY * sy;
    world[w + 4] = Number(local[o]) * sx + pose.x;
    world[w + 5] = Number(local[o + 1]) * sy + pose.y;
}

/** The world position of a bone with a parent. `p` is the index of the parent's world transform. */
function childPosition(local: Float64Array, world: Float64Array, o: number, w: number, p: number): void {
    const x = Number(local[o]);
    const y = Number(local[o + 1]);

    world[w + 4] = Number(world[p]) * x + Number(world[p + 1]) * y + Number(world[p + 4]);
    world[w + 5] = Number(world[p + 2]) * x + Number(world[p + 3]) * y + Number(world[p + 5]);
}

/** Inherit mode `normal`. The skeleton scale comes with the parent matrix. */
function normalBone(local: Float64Array, world: Float64Array, o: number, w: number, p: number): void {
    const rotation = Number(local[o + 2]);
    const scaleX = Number(local[o + 3]);
    const scaleY = Number(local[o + 4]);
    const pa = Number(world[p]);
    const pb = Number(world[p + 1]);
    const pc = Number(world[p + 2]);
    const pd = Number(world[p + 3]);
    const rx = (rotation + Number(local[o + 5])) * DEG_RAD;
    const ry = (rotation + 90 + Number(local[o + 6])) * DEG_RAD;
    let cosX = 1;
    let sinX = rx;
    let cosY = COS_QUARTER;
    let sinY = SIN_QUARTER;

    if (rx !== 0) {
        cosX = Math.cos(rx);
        sinX = Math.sin(rx);
    }
    if (ry !== QUARTER) {
        cosY = Math.cos(ry);
        sinY = Math.sin(ry);
    }
    const la = cosX * scaleX;
    const lb = cosY * scaleY;
    const lc = sinX * scaleX;
    const ld = sinY * scaleY;

    world[w] = pa * la + pb * lc;
    world[w + 1] = pa * lb + pb * ld;
    world[w + 2] = pc * la + pd * lc;
    world[w + 3] = pc * lb + pd * ld;
}

/** Inherit mode `onlyTranslation`, before the skeleton scale. */
function onlyTranslationBone(local: Float64Array, world: Float64Array, o: number, w: number): void {
    const rotation = Number(local[o + 2]);
    const scaleX = Number(local[o + 3]);
    const scaleY = Number(local[o + 4]);
    const rx = (rotation + Number(local[o + 5])) * DEG_RAD;
    const ry = (rotation + 90 + Number(local[o + 6])) * DEG_RAD;
    let cosX = 1;
    let sinX = rx;
    let cosY = COS_QUARTER;
    let sinY = SIN_QUARTER;

    if (rx !== 0) {
        cosX = Math.cos(rx);
        sinX = Math.sin(rx);
    }
    if (ry !== QUARTER) {
        cosY = Math.cos(ry);
        sinY = Math.sin(ry);
    }
    world[w] = cosX * scaleX;
    world[w + 1] = cosY * scaleY;
    world[w + 2] = sinX * scaleX;
    world[w + 3] = sinY * scaleY;
}

/** Takes the rotation out of the parent matrix for mode `noRotationOrReflection` in 4.2. Fills `parentMatrix`. */
function parentRotation42(pose: PoseState, p: number): void {
    const world = pose.world;
    const sx = 1 / pose.scaleX;
    const sy = 1 / pose.scaleY;
    let pa = Number(world[p]) * sx;
    let pb = Number(world[p + 1]);
    let pc = Number(world[p + 2]) * sy;
    let pd = Number(world[p + 3]);
    let s = pa * pa + pc * pc;
    let prx = 0;

    if (s > 0.0001) {
        s = Math.abs(pa * pd * sy - pb * sx * pc) / s;
        pb = pc * s;
        pd = pa * s;
        prx = Math.atan2(pc, pa) * RAD_DEG;
    } else {
        pa = 0;
        pc = 0;
        prx = 90 - Math.atan2(pd, pb) * RAD_DEG;
    }
    parentMatrix[0] = pa;
    parentMatrix[1] = pb;
    parentMatrix[2] = pc;
    parentMatrix[3] = pd;
    parentMatrix[4] = prx;
}

/** Like {@link parentRotation42}, with the arithmetic of 4.1. */
function parentRotation41(pose: PoseState, p: number): void {
    const world = pose.world;
    let pa = Number(world[p]);
    let pb = Number(world[p + 1]);
    let pc = Number(world[p + 2]);
    let pd = Number(world[p + 3]);
    let s = pa * pa + pc * pc;
    let prx = 0;

    if (s > 0.0001) {
        s = Math.abs(pa * pd - pb * pc) / s;
        pa /= pose.scaleX;
        pc /= pose.scaleY;
        pb = pc * s;
        pd = pa * s;
        prx = Math.atan2(pc, pa) * RAD_DEG;
    } else {
        pa = 0;
        pc = 0;
        prx = 90 - Math.atan2(pd, pb) * RAD_DEG;
    }
    parentMatrix[0] = pa;
    parentMatrix[1] = pb;
    parentMatrix[2] = pc;
    parentMatrix[3] = pd;
    parentMatrix[4] = prx;
}

/** Inherit mode `noRotationOrReflection`, before the skeleton scale. */
function noRotationBone(pose: PoseState, local: Float64Array, o: number, w: number, p: number, v41: boolean): void {
    if (v41) parentRotation41(pose, p);
    else parentRotation42(pose, p);
    const prx = Number(parentMatrix[4]);
    const pa = Number(parentMatrix[0]);
    const pb = Number(parentMatrix[1]);
    const pc = Number(parentMatrix[2]);
    const pd = Number(parentMatrix[3]);
    const rotation = Number(local[o + 2]);
    const scaleX = Number(local[o + 3]);
    const scaleY = Number(local[o + 4]);
    const rx = (rotation + Number(local[o + 5]) - prx) * DEG_RAD;
    const ry = (rotation + Number(local[o + 6]) - prx + 90) * DEG_RAD;
    const la = Math.cos(rx) * scaleX;
    const lb = Math.cos(ry) * scaleY;
    const lc = Math.sin(rx) * scaleX;
    const ld = Math.sin(ry) * scaleY;

    const world = pose.world;

    world[w] = pa * la - pb * lc;
    world[w + 1] = pa * lb - pb * ld;
    world[w + 2] = pc * la + pd * lc;
    world[w + 3] = pc * lb + pd * ld;
}

/** Inherit modes `noScale` and `noScaleOrReflection`, before the skeleton scale. */
function noScaleBone(pose: PoseState, local: Float64Array, o: number, w: number, p: number, mode: number): void {
    const world = pose.world;
    const pa = Number(world[p]);
    const pb = Number(world[p + 1]);
    const pc = Number(world[p + 2]);
    const pd = Number(world[p + 3]);
    const scaleX = Number(local[o + 3]);
    const scaleY = Number(local[o + 4]);
    const rotation = Number(local[o + 2]) * DEG_RAD;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    let za = (pa * cos + pb * sin) / pose.scaleX;
    let zc = (pc * cos + pd * sin) / pose.scaleY;
    let s = Math.sqrt(za * za + zc * zc);

    if (s > 0.00001) s = 1 / s;
    za *= s;
    zc *= s;
    s = Math.sqrt(za * za + zc * zc);
    if (mode === NO_SCALE && pa * pd - pb * pc < 0 !== (pose.scaleX < 0 !== pose.scaleY < 0)) s = -s;
    const turned = Math.PI / 2 + Math.atan2(zc, za);
    const zb = Math.cos(turned) * s;
    const zd = Math.sin(turned) * s;
    const shearX = Number(local[o + 5]) * DEG_RAD;
    const shearY = (90 + Number(local[o + 6])) * DEG_RAD;
    let cosX = 1;
    let sinX = shearX;
    let cosY = COS_QUARTER;
    let sinY = SIN_QUARTER;

    if (shearX !== 0) {
        cosX = Math.cos(shearX);
        sinX = Math.sin(shearX);
    }
    if (shearY !== QUARTER) {
        cosY = Math.cos(shearY);
        sinY = Math.sin(shearY);
    }
    const la = cosX * scaleX;
    const lb = cosY * scaleY;
    const lc = sinX * scaleX;
    const ld = sinY * scaleY;

    world[w] = za * la + zb * lc;
    world[w + 1] = za * lb + zb * ld;
    world[w + 2] = zc * la + zd * lc;
    world[w + 3] = zc * lb + zd * ld;
}

/** A bone that does not inherit all of its parent transform. The result gets the skeleton scale. */
function partBone(
    pose: PoseState,
    local: Float64Array,
    o: number,
    w: number,
    p: number,
    mode: number,
    v41: boolean,
): void {
    const world = pose.world;

    if (mode === ONLY_TRANSLATION) onlyTranslationBone(local, world, o, w);
    else if (mode === NO_ROTATION_OR_REFLECTION) noRotationBone(pose, local, o, w, p, v41);
    else if (mode === NO_SCALE || mode === NO_SCALE_OR_REFLECTION) noScaleBone(pose, local, o, w, p, mode);
    world[w] = Number(world[w]) * pose.scaleX;
    world[w + 1] = Number(world[w + 1]) * pose.scaleX;
    world[w + 2] = Number(world[w + 2]) * pose.scaleY;
    world[w + 3] = Number(world[w + 3]) * pose.scaleY;
}

/**
 * Computes the world transform of one bone from its applied pose and the world transform of its
 * parent: the official `Bone.update`, which is `Bone.updateWorldTransformWith` on the applied pose.
 * To pose a bone as the official `updateWorldTransformWith` does, write `applied` first.
 */
export function updateBone(
    pose: PoseState,
    applied: Float64Array,
    parents: Int16Array,
    bone: number,
    v41: boolean,
): void {
    const world = pose.world;
    const o = bone * LOCAL_STRIDE;
    const w = bone * WORLD_STRIDE;
    const parent = parents[bone] ?? -1;

    if (parent < 0) {
        rootBone(pose, applied, o, w);

        return;
    }
    const p = parent * WORLD_STRIDE;
    const mode = pose.inherit[bone] ?? NORMAL;

    childPosition(applied, world, o, w, p);
    if (mode === NORMAL) normalBone(applied, world, o, w, p);
    else partBone(pose, applied, o, w, p, mode, v41);
}
