import { LOCAL_STRIDE, type PoseState, WORLD_STRIDE } from '../state';
import { f64 } from './curves';
import type { Pose43 } from './types';

// biome-ignore lint/suspicious/noApproximativeNumericConstant: the official MathUtils.PI is this rounded number
const PI = 3.1415927;
const DEG_RAD = PI / 180;
const RAD_DEG = 180 / PI;
const EPSILON = 0.00001;
const EPSILON2 = EPSILON * EPSILON;

const NORMAL = 0;
const ONLY_TRANSLATION = 1;
const NO_ROTATION_OR_REFLECTION = 2;
const NO_SCALE = 3;
const NO_SCALE_OR_REFLECTION = 4;

const atan2Deg = (y: number, x: number): number => Math.atan2(y, x) * RAD_DEG;

/** Writes a, b, c, d of a bone that takes its rotation, scale and shear from its own numbers alone. */
function writeOwnAxes(state: PoseState, bone: number): void {
    const { local, world } = state;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const rotation = f64(local, l + 2);
    const scaleX = f64(local, l + 3);
    const scaleY = f64(local, l + 4);
    const sx = state.scaleX;
    const sy = state.scaleY;
    const rx = (rotation + f64(local, l + 5)) * DEG_RAD;
    const ry = (rotation + 90 + f64(local, l + 6)) * DEG_RAD;

    world[o] = Math.cos(rx) * scaleX * sx;
    world[o + 1] = Math.cos(ry) * scaleY * sx;
    world[o + 2] = Math.sin(rx) * scaleX * sy;
    world[o + 3] = Math.sin(ry) * scaleY * sy;
}

/** The world transform of a bone without a parent. The position and the scale of the skeleton apply here. */
function updateRoot(state: PoseState, bone: number): void {
    const { local, world } = state;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;

    writeOwnAxes(state, bone);
    world[o + 4] = f64(local, l) * state.scaleX + state.x;
    world[o + 5] = f64(local, l + 1) * state.scaleY + state.y;
}

/** The official `Inherit.Normal`: the parent transform times the local transform. */
function inheritNormal(state: PoseState, bone: number, pa: number, pb: number, pc: number, pd: number): void {
    const { local, world } = state;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const rotation = f64(local, l + 2);
    const scaleX = f64(local, l + 3);
    const scaleY = f64(local, l + 4);
    const rx = (rotation + f64(local, l + 5)) * DEG_RAD;
    const ry = (rotation + 90 + f64(local, l + 6)) * DEG_RAD;
    const la = Math.cos(rx) * scaleX;
    const lb = Math.cos(ry) * scaleY;
    const lc = Math.sin(rx) * scaleX;
    const ld = Math.sin(ry) * scaleY;

    world[o] = pa * la + pb * lc;
    world[o + 1] = pa * lb + pb * ld;
    world[o + 2] = pc * la + pd * lc;
    world[o + 3] = pc * lb + pd * ld;
}

/** The official `Inherit.NoRotationOrReflection`: the scale of the parent without its rotation. */
function inheritNoRotation(state: PoseState, bone: number, pa: number, pb: number, pc: number, pd: number): void {
    const { local, world } = state;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const rotation = f64(local, l + 2);
    const scaleX = f64(local, l + 3);
    const scaleY = f64(local, l + 4);
    const sx = state.scaleX;
    const sy = state.scaleY;
    const sxi = 1 / sx;
    const syi = 1 / sy;
    let r = 0;

    pa *= sxi;
    pc *= syi;
    let s = pa * pa + pc * pc;

    if (s > EPSILON2) {
        s = Math.abs(pa * pd * syi - pb * sxi * pc) / s;
        pb = pc * s;
        pd = pa * s;
        r = rotation - atan2Deg(pc, pa);
    } else {
        pa = 0;
        pc = 0;
        r = rotation - 90 + atan2Deg(pd, pb);
    }
    const rx = (r + f64(local, l + 5)) * DEG_RAD;
    const ry = (r + f64(local, l + 6) + 90) * DEG_RAD;
    const la = Math.cos(rx) * scaleX;
    const lb = Math.cos(ry) * scaleY;
    const lc = Math.sin(rx) * scaleX;
    const ld = Math.sin(ry) * scaleY;

    world[o] = (pa * la - pb * lc) * sx;
    world[o + 1] = (pa * lb - pb * ld) * sx;
    world[o + 2] = (pc * la + pd * lc) * sy;
    world[o + 3] = (pc * lb + pd * ld) * sy;
}

/** The official `Inherit.NoScale` and `Inherit.NoScaleOrReflection`: the rotation of the parent without its scale. */
function inheritNoScale(
    state: PoseState,
    bone: number,
    pa: number,
    pb: number,
    pc: number,
    pd: number,
    reflection: boolean,
): void {
    const { local, world } = state;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const scaleX = f64(local, l + 3);
    const scaleY = f64(local, l + 4);
    const sx = state.scaleX;
    const sy = state.scaleY;
    const sxi = 1 / sx;
    const syi = 1 / sy;
    const r = f64(local, l + 2) * DEG_RAD;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    let za = (pa * cos + pb * sin) * sxi;
    let zc = (pc * cos + pd * sin) * syi;
    const s = 1 / Math.sqrt(za * za + zc * zc);

    za *= s;
    zc *= s;
    let zb = -zc;
    let zd = za;

    if (reflection && pa * pd - pb * pc < 0 !== (sx < 0 !== sy < 0)) {
        zb = -zb;
        zd = -zd;
    }
    const rx = f64(local, l + 5) * DEG_RAD;
    const ry = (90 + f64(local, l + 6)) * DEG_RAD;
    const la = Math.cos(rx) * scaleX;
    const lb = Math.cos(ry) * scaleY;
    const lc = Math.sin(rx) * scaleX;
    const ld = Math.sin(ry) * scaleY;

    world[o] = (za * la + zb * lc) * sx;
    world[o + 1] = (za * lb + zb * ld) * sx;
    world[o + 2] = (zc * la + zd * lc) * sy;
    world[o + 3] = (zc * lb + zd * ld) * sy;
}

/** The world transform of a bone with a parent, by the inherit mode of the bone. */
function updateChild(state: PoseState, bone: number, parent: number): void {
    const { local, world } = state;
    const p = parent * WORLD_STRIDE;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const pa = f64(world, p);
    const pb = f64(world, p + 1);
    const pc = f64(world, p + 2);
    const pd = f64(world, p + 3);
    const x = f64(local, l);
    const y = f64(local, l + 1);

    world[o + 4] = pa * x + pb * y + f64(world, p + 4);
    world[o + 5] = pc * x + pd * y + f64(world, p + 5);
    switch (state.inherit[bone]) {
        case NORMAL:
            inheritNormal(state, bone, pa, pb, pc, pd);
            break;
        case ONLY_TRANSLATION:
            writeOwnAxes(state, bone);
            break;
        case NO_ROTATION_OR_REFLECTION:
            inheritNoRotation(state, bone, pa, pb, pc, pd);
            break;
        case NO_SCALE:
            inheritNoScale(state, bone, pa, pb, pc, pd, true);
            break;
        case NO_SCALE_OR_REFLECTION:
            inheritNoScale(state, bone, pa, pb, pc, pd, false);
            break;
    }
}

/**
 * The official `Skeleton.updateWorldTransform` without constraints: the world transform of every
 * active bone, parents first. A bone that is not active keeps the transform it had.
 */
export function updateWorld(pose: Pose43): void {
    const { state } = pose;
    const { parents, count } = pose.rig.model.bones;

    for (let bone = 0; bone < count; bone++) {
        if (state.active[bone] !== 1) continue;
        const parent = parents[bone] ?? -1;

        if (parent < 0) updateRoot(state, bone);
        else updateChild(state, bone, parent);
    }
}
