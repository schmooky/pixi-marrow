import { LOCAL_STRIDE, type PoseState, WORLD_STRIDE } from '../state';
import {
    COS_QUARTER,
    DEG_RAD,
    EPSILON2,
    NO_ROTATION_OR_REFLECTION,
    NO_SCALE,
    NO_SCALE_OR_REFLECTION,
    ONLY_TRANSLATION,
    QUARTER,
    RAD_DEG,
    SIN_QUARTER,
} from './math';

/*
 * The official `BonePose.updateWorldTransform`. `local` holds the local numbers the world transform
 * is computed from: the animated pose, or the applied pose when constraints are solved. Typed
 * arrays are read in place, for the reasons given in solve.ts.
 *
 * Many bones of a rig are not turned. Their x axis is at an angle of 0 and their y axis at a
 * quarter turn. The cosine and the sine of those two angles are not computed: `Math.cos(0)` is 1
 * and `Math.sin(0)` is the 0 it is given, by the language, and those of the quarter turn are
 * `COS_QUARTER` and `SIN_QUARTER`. The results are the same numbers, bit for bit.
 */

/** Writes a, b, c, d of a bone that takes its rotation, scale and shear from its own numbers alone. */
function writeOwnAxes(state: PoseState, local: Float64Array, bone: number): void {
    const { world } = state;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const rotation = Number(local[l + 2]);
    const scaleX = Number(local[l + 3]);
    const scaleY = Number(local[l + 4]);
    const sx = state.scaleX;
    const sy = state.scaleY;
    const rx = (rotation + Number(local[l + 5])) * DEG_RAD;
    const ry = (rotation + 90 + Number(local[l + 6])) * DEG_RAD;
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
    world[o] = cosX * scaleX * sx;
    world[o + 1] = cosY * scaleY * sx;
    world[o + 2] = sinX * scaleX * sy;
    world[o + 3] = sinY * scaleY * sy;
}

/** The world transform of a bone without a parent. The position and the scale of the skeleton apply here. */
function updateRoot(state: PoseState, local: Float64Array, bone: number): void {
    const { world } = state;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;

    writeOwnAxes(state, local, bone);
    world[o + 4] = Number(local[l]) * state.scaleX + state.x;
    world[o + 5] = Number(local[l + 1]) * state.scaleY + state.y;
}

/** The official `Inherit.NoRotationOrReflection`: the scale of the parent without its rotation. */
function inheritNoRotation(state: PoseState, local: Float64Array, bone: number, parent: number): void {
    const { world } = state;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const p = parent * WORLD_STRIDE;
    let pa = Number(world[p]);
    let pb = Number(world[p + 1]);
    let pc = Number(world[p + 2]);
    let pd = Number(world[p + 3]);
    const rotation = Number(local[l + 2]);
    const scaleX = Number(local[l + 3]);
    const scaleY = Number(local[l + 4]);
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
        r = rotation - Math.atan2(pc, pa) * RAD_DEG;
    } else {
        pa = 0;
        pc = 0;
        r = rotation - 90 + Math.atan2(pd, pb) * RAD_DEG;
    }
    const rx = (r + Number(local[l + 5])) * DEG_RAD;
    const ry = (r + Number(local[l + 6]) + 90) * DEG_RAD;
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
    local: Float64Array,
    bone: number,
    parent: number,
    reflection: boolean,
): void {
    const { world } = state;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const p = parent * WORLD_STRIDE;
    const pa = Number(world[p]);
    const pb = Number(world[p + 1]);
    const pc = Number(world[p + 2]);
    const pd = Number(world[p + 3]);
    const scaleX = Number(local[l + 3]);
    const scaleY = Number(local[l + 4]);
    const sx = state.scaleX;
    const sy = state.scaleY;
    const sxi = 1 / sx;
    const syi = 1 / sy;
    const r = Number(local[l + 2]) * DEG_RAD;
    const rx = Number(local[l + 5]) * DEG_RAD;
    const ry = (90 + Number(local[l + 6])) * DEG_RAD;
    let cos = 1;
    let sin = r;
    let cosX = 1;
    let sinX = rx;
    let cosY = COS_QUARTER;
    let sinY = SIN_QUARTER;

    if (r !== 0) {
        cos = Math.cos(r);
        sin = Math.sin(r);
    }
    if (rx !== 0) {
        cosX = Math.cos(rx);
        sinX = Math.sin(rx);
    }
    if (ry !== QUARTER) {
        cosY = Math.cos(ry);
        sinY = Math.sin(ry);
    }
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
    const la = cosX * scaleX;
    const lb = cosY * scaleY;
    const lc = sinX * scaleX;
    const ld = sinY * scaleY;

    world[o] = (za * la + zb * lc) * sx;
    world[o + 1] = (za * lb + zb * ld) * sx;
    world[o + 2] = (zc * la + zd * lc) * sy;
    world[o + 3] = (zc * lb + zd * ld) * sy;
}

/**
 * The world transform of a bone with a parent that does not inherit all of the parent transform,
 * by the inherit mode of the bone.
 */
function updateChild(state: PoseState, local: Float64Array, bone: number, parent: number, inherit: number): void {
    const { world } = state;
    const p = parent * WORLD_STRIDE;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const x = Number(local[l]);
    const y = Number(local[l + 1]);

    world[o + 4] = Number(world[p]) * x + Number(world[p + 1]) * y + Number(world[p + 4]);
    world[o + 5] = Number(world[p + 2]) * x + Number(world[p + 3]) * y + Number(world[p + 5]);
    if (inherit === ONLY_TRANSLATION) writeOwnAxes(state, local, bone);
    else if (inherit === NO_ROTATION_OR_REFLECTION) inheritNoRotation(state, local, bone, parent);
    else if (inherit === NO_SCALE) inheritNoScale(state, local, bone, parent, true);
    else if (inherit === NO_SCALE_OR_REFLECTION) inheritNoScale(state, local, bone, parent, false);
}

/**
 * Writes the world transform of a bone without a parent, or of one that does not inherit all of
 * its parent transform. The loop of `updateWorld` computes the official `Inherit.Normal` of a bone
 * with a parent itself: nearly every bone has it.
 *
 * `local` holds the local numbers of the bone. `parent` is -1 for a bone without a parent.
 * `inherit` is the inherit mode of the bone, a whole number.
 */
export function updateBoneWorld(
    state: PoseState,
    local: Float64Array,
    bone: number,
    parent: number,
    inherit: number,
): void {
    if (parent < 0) updateRoot(state, local, bone);
    else updateChild(state, local, bone, parent, inherit);
}
