import type { BoneTable } from '../../model/model';
import { LOCAL_STRIDE, type PoseState, WORLD_STRIDE } from '../state';

// biome-ignore lint/suspicious/noApproximativeNumericConstant: the official MathUtils.PI is this rounded number
const PI = 3.1415927;
const RAD_DEG = 180 / PI;
const DEG_RAD = PI / 180;

const NORMAL = 0;
const ONLY_TRANSLATION = 1;
const NO_ROTATION_OR_REFLECTION = 2;
const NO_SCALE = 3;
const NO_SCALE_OR_REFLECTION = 4;

/** Scratch of mode `noRotationOrReflection`: the parent matrix a, b, c, d without its rotation, then that rotation. */
const parentMatrix = new Float64Array(5);

function writeMatrix(world: Float64Array, w: number, a: number, b: number, c: number, d: number): void {
    world[w] = a;
    world[w + 1] = b;
    world[w + 2] = c;
    world[w + 3] = d;
}

/** A bone without a parent. `o` is the index of its local pose, `w` of its world transform. */
function rootBone(pose: PoseState, o: number, w: number): void {
    const { local, world } = pose;
    const rotation = Number(local[o + 2]);
    const scaleX = Number(local[o + 3]);
    const scaleY = Number(local[o + 4]);
    const sx = pose.scaleX;
    const sy = pose.scaleY;
    const rx = (rotation + Number(local[o + 5])) * DEG_RAD;
    const ry = (rotation + 90 + Number(local[o + 6])) * DEG_RAD;

    writeMatrix(
        world,
        w,
        Math.cos(rx) * scaleX * sx,
        Math.cos(ry) * scaleY * sx,
        Math.sin(rx) * scaleX * sy,
        Math.sin(ry) * scaleY * sy,
    );
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
    const la = Math.cos(rx) * scaleX;
    const lb = Math.cos(ry) * scaleY;
    const lc = Math.sin(rx) * scaleX;
    const ld = Math.sin(ry) * scaleY;

    writeMatrix(world, w, pa * la + pb * lc, pa * lb + pb * ld, pc * la + pd * lc, pc * lb + pd * ld);
}

/** Inherit mode `onlyTranslation`, before the skeleton scale. */
function onlyTranslationBone(local: Float64Array, world: Float64Array, o: number, w: number): void {
    const rotation = Number(local[o + 2]);
    const scaleX = Number(local[o + 3]);
    const scaleY = Number(local[o + 4]);
    const rx = (rotation + Number(local[o + 5])) * DEG_RAD;
    const ry = (rotation + 90 + Number(local[o + 6])) * DEG_RAD;

    writeMatrix(world, w, Math.cos(rx) * scaleX, Math.cos(ry) * scaleY, Math.sin(rx) * scaleX, Math.sin(ry) * scaleY);
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
    writeMatrix(parentMatrix, 0, pa, pb, pc, pd);
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
    writeMatrix(parentMatrix, 0, pa, pb, pc, pd);
    parentMatrix[4] = prx;
}

/** Inherit mode `noRotationOrReflection`, before the skeleton scale. */
function noRotationBone(pose: PoseState, o: number, w: number, p: number, v41: boolean): void {
    const local = pose.local;
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

    writeMatrix(pose.world, w, pa * la - pb * lc, pa * lb - pb * ld, pc * la + pd * lc, pc * lb + pd * ld);
}

/** Inherit modes `noScale` and `noScaleOrReflection`, before the skeleton scale. */
function noScaleBone(pose: PoseState, o: number, w: number, p: number, mode: number): void {
    const { local, world } = pose;
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
    const la = Math.cos(shearX) * scaleX;
    const lb = Math.cos(shearY) * scaleY;
    const lc = Math.sin(shearX) * scaleX;
    const ld = Math.sin(shearY) * scaleY;

    writeMatrix(world, w, za * la + zb * lc, za * lb + zb * ld, zc * la + zd * lc, zc * lb + zd * ld);
}

/** A bone that does not inherit all of its parent transform. The result gets the skeleton scale. */
function partBone(pose: PoseState, o: number, w: number, p: number, mode: number, v41: boolean): void {
    const world = pose.world;

    if (mode === ONLY_TRANSLATION) onlyTranslationBone(pose.local, world, o, w);
    else if (mode === NO_ROTATION_OR_REFLECTION) noRotationBone(pose, o, w, p, v41);
    else if (mode === NO_SCALE || mode === NO_SCALE_OR_REFLECTION) noScaleBone(pose, o, w, p, mode);
    world[w] = Number(world[w]) * pose.scaleX;
    world[w + 1] = Number(world[w + 1]) * pose.scaleX;
    world[w + 2] = Number(world[w + 2]) * pose.scaleY;
    world[w + 3] = Number(world[w + 3]) * pose.scaleY;
}

/**
 * Computes the world transform of every active bone from its local pose: the official
 * `Skeleton.updateWorldTransform` with an update cache that holds bones only, and the official
 * `Bone.updateWorldTransformWith` for each bone. An inactive bone keeps the transform it had.
 */
export function updateWorldTransforms(bones: BoneTable, pose: PoseState, v41: boolean): void {
    const { local, world, active, inherit } = pose;
    const parents = bones.parents;

    for (let bone = 0, n = bones.count; bone < n; bone++) {
        if (active[bone] !== 1) continue;
        const o = bone * LOCAL_STRIDE;
        const w = bone * WORLD_STRIDE;
        const parent = parents[bone] ?? -1;

        if (parent < 0) {
            rootBone(pose, o, w);
            continue;
        }
        const p = parent * WORLD_STRIDE;
        const mode = inherit[bone] ?? NORMAL;

        childPosition(local, world, o, w, p);
        if (mode === NORMAL) normalBone(local, world, o, w, p);
        else partBone(pose, o, w, p, mode, v41);
    }
}
