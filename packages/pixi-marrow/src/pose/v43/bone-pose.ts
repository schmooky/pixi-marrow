import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import {
    DEG_RAD,
    EPSILON2,
    NO_ROTATION_OR_REFLECTION,
    NO_SCALE,
    NO_SCALE_OR_REFLECTION,
    NORMAL,
    ONLY_TRANSLATION,
    RAD_DEG,
} from './math';
import type { Pose43 } from './types';

/*
 * The parts of the official `BonePose` that constraints use, on the applied pose of a bone: its
 * local numbers in `Solve43.local` and its world transform in `PoseState.world`. Typed arrays are
 * read in place and the numbers that functions share go through an array, for the reasons given
 * in solve.ts.
 */

const ROTATION = 2;
const SCALE_X = 3;
const SCALE_Y = 4;
const SHEAR_X = 5;
const SHEAR_Y = 6;

/**
 * A matrix on its way to `set4` or `set5`: ra, rb, rc, rd, then the degrees `set5` adds to the
 * rotation. No call keeps it across a return.
 */
const MATRIX = new Float64Array(5);

/** The official `BonePose.set4`: scale and shear from `MATRIX`, for a bone that got its rotation before. */
function set4(local: Float64Array, l: number): void {
    const ra = Number(MATRIX[0]);
    const rb = Number(MATRIX[1]);
    const rc = Number(MATRIX[2]);
    const rd = Number(MATRIX[3]);
    const x = ra * ra + rc * rc;
    const y = rb * rb + rd * rd;

    if (x > EPSILON2) {
        local[l + SHEAR_X] = Math.atan2(rc, ra) * RAD_DEG;
        local[l + SCALE_X] = Math.sqrt(x);
    } else {
        local[l + SHEAR_X] = 0;
        local[l + SCALE_X] = 0;
    }
    local[l + SCALE_Y] = Math.sqrt(y);
    if (y > EPSILON2) {
        let shearY = Math.atan2(rd, rb) * RAD_DEG;

        if (ra * rd - rb * rc < 0) {
            local[l + SCALE_Y] = -Math.sqrt(y);
            shearY += 90;
        } else shearY -= 90;
        if (shearY > 180) shearY -= 360;
        else if (shearY <= -180) shearY += 360;
        local[l + SHEAR_Y] = shearY;
    } else local[l + SHEAR_Y] = 0;
}

/** The official `BonePose.set5`: rotation, scale and shear Y from `MATRIX`. The shear X is 0. */
function set5(local: Float64Array, l: number): void {
    const ra = Number(MATRIX[0]);
    const rb = Number(MATRIX[1]);
    const rc = Number(MATRIX[2]);
    const rd = Number(MATRIX[3]);
    const ro = Number(MATRIX[4]);
    const x = ra * ra + rc * rc;
    const y = rb * rb + rd * rd;

    local[l + SHEAR_X] = 0;
    local[l + SCALE_Y] = Math.sqrt(y);
    if (!(x > EPSILON2)) {
        local[l + SCALE_X] = 0;
        local[l + SHEAR_Y] = 0;
        local[l + ROTATION] = y > EPSILON2 ? Math.atan2(rd, rb) * RAD_DEG - 90 + ro : ro;

        return;
    }
    const r = Math.atan2(rc, ra) * RAD_DEG;

    local[l + ROTATION] = r + ro;
    local[l + SCALE_X] = Math.sqrt(x);
    if (y > EPSILON2) {
        let shearY = Math.atan2(rd, rb) * RAD_DEG;

        if (ra * rd - rb * rc < 0) {
            local[l + SCALE_Y] = -Math.sqrt(y);
            shearY += 90 - r;
        } else shearY -= 90 + r;
        if (shearY > 180) shearY -= 360;
        else if (shearY <= -180) shearY += 360;
        local[l + SHEAR_Y] = shearY;
    } else local[l + SHEAR_Y] = 0;
}

/** The local numbers of a bone that keeps the scale of its parent and drops the rotation. */
function localNoRotation(pose: Pose43, bone: number, parent: number): void {
    const { state } = pose;
    const { world } = state;
    const o = bone * WORLD_STRIDE;
    const p = parent * WORLD_STRIDE;
    const sxi = 1 / state.scaleX;
    const syi = 1 / state.scaleY;
    const pad = Number(world[p]) * Number(world[p + 3]) - Number(world[p + 1]) * Number(world[p + 2]);
    const pa = Number(world[p]) * sxi;
    const pc = Number(world[p + 2]) * syi;
    const wa = Number(world[o]) * sxi;
    const wb = Number(world[o + 1]) * sxi;
    const wc = Number(world[o + 2]) * syi;
    const wd = Number(world[o + 3]) * syi;
    const s = 1 / (pa * pa + pc * pc);
    const det = 1 / Math.abs(pad * sxi * syi);

    MATRIX[0] = (pa * wa + pc * wc) * s;
    MATRIX[1] = (pa * wb + pc * wd) * s;
    MATRIX[2] = (pa * wc - pc * wa) * det;
    MATRIX[3] = (pa * wd - pc * wb) * det;
    MATRIX[4] = Math.atan2(pc, pa) * RAD_DEG;
    set5(pose.solve.local, bone * LOCAL_STRIDE);
}

/** The local numbers of a bone that keeps the rotation of its parent and drops the scale. */
function localNoScale(pose: Pose43, bone: number, parent: number, reflection: boolean): void {
    const { state } = pose;
    const { world } = state;
    const { local } = pose.solve;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const p = parent * WORLD_STRIDE;
    const sx = state.scaleX;
    const sy = state.scaleY;
    const sxi = 1 / sx;
    const syi = 1 / sy;
    const pa = Number(world[p]);
    const pb = Number(world[p + 1]);
    const pc = Number(world[p + 2]);
    const pd = Number(world[p + 3]);
    const pad = pa * pd - pb * pc;
    const a = Number(world[o]);
    const c = Number(world[o + 2]);
    const wa = a * sxi;
    const wb = Number(world[o + 1]) * sxi;
    const wc = c * syi;
    const wd = Number(world[o + 3]) * syi;
    let tx = pd * a - pb * c;
    let ty = pa * c - pc * a;

    if (pad < 0) {
        tx = -tx;
        ty = -ty;
    }
    let r = Math.atan2(ty, tx) * RAD_DEG;

    local[l + ROTATION] = r;
    r *= DEG_RAD;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    let za = (pa * cos + pb * sin) * sxi;
    let zc = (pc * cos + pd * sin) * syi;
    const s = 1 / Math.sqrt(za * za + zc * zc);

    za *= s;
    zc *= s;
    const si = reflection && pad < 0 !== (sx < 0 !== sy < 0) ? -1 : 1;

    MATRIX[0] = za * wa + zc * wc;
    MATRIX[1] = za * wb + zc * wd;
    MATRIX[2] = (za * wc - zc * wa) * si;
    MATRIX[3] = (za * wd - zc * wb) * si;
    set4(local, l);
}

/** The official `BonePose.updateLocalTransform` for a bone without a parent. */
function updateRootLocal(pose: Pose43, bone: number): void {
    const { state } = pose;
    const { world } = state;
    const { local } = pose.solve;
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const sxi = 1 / state.scaleX;
    const syi = 1 / state.scaleY;

    local[l] = (Number(world[o + 4]) - state.x) * sxi;
    local[l + 1] = (Number(world[o + 5]) - state.y) * syi;
    MATRIX[0] = Number(world[o]) * sxi;
    MATRIX[1] = Number(world[o + 1]) * sxi;
    MATRIX[2] = Number(world[o + 2]) * syi;
    MATRIX[3] = Number(world[o + 3]) * syi;
    MATRIX[4] = 0;
    set5(local, l);
}

/**
 * The official `BonePose.updateLocalTransform`: computes the applied local numbers of a bone from
 * its world transform, after a constraint changed that.
 */
export function updateLocalTransform(pose: Pose43, bone: number): void {
    const { state, solve } = pose;
    const { world } = state;
    const { local } = solve;
    const parent = pose.rig.model.bones.parents[bone] ?? -1;

    solve.localStamps[bone] = 0;
    solve.worldStamps[bone] = solve.stamp;
    if (parent < 0) {
        updateRootLocal(pose, bone);

        return;
    }
    const l = bone * LOCAL_STRIDE;
    const o = bone * WORLD_STRIDE;
    const p = parent * WORLD_STRIDE;
    const pa = Number(world[p]);
    const pb = Number(world[p + 1]);
    const pc = Number(world[p + 2]);
    const pd = Number(world[p + 3]);
    const pid = 1 / (pa * pd - pb * pc);
    const ia = pd * pid;
    const ib = pb * pid;
    const ic = pc * pid;
    const id = pa * pid;
    const dx = Number(world[o + 4]) - Number(world[p + 4]);
    const dy = Number(world[o + 5]) - Number(world[p + 5]);
    const a = Number(world[o]);
    const b = Number(world[o + 1]);
    const c = Number(world[o + 2]);
    const d = Number(world[o + 3]);

    local[l] = dx * ia - dy * ib;
    local[l + 1] = dy * id - dx * ic;
    switch (solve.inherit[bone]) {
        case NORMAL:
            MATRIX[0] = ia * a - ib * c;
            MATRIX[1] = ia * b - ib * d;
            MATRIX[2] = id * c - ic * a;
            MATRIX[3] = id * d - ic * b;
            MATRIX[4] = 0;
            set5(local, l);
            break;
        case ONLY_TRANSLATION:
            MATRIX[0] = a * (1 / state.scaleX);
            MATRIX[1] = b * (1 / state.scaleX);
            MATRIX[2] = c * (1 / state.scaleY);
            MATRIX[3] = d * (1 / state.scaleY);
            MATRIX[4] = 0;
            set5(local, l);
            break;
        case NO_ROTATION_OR_REFLECTION:
            localNoRotation(pose, bone, parent);
            break;
        case NO_SCALE:
            localNoScale(pose, bone, parent, true);
            break;
        case NO_SCALE_OR_REFLECTION:
            localNoScale(pose, bone, parent, false);
            break;
    }
}

/**
 * The official `BonePose.resetWorld`: the bones below a bone whose pose changes need their world
 * transform again. One that a constraint moved gets its local numbers first.
 */
function resetWorld(pose: Pose43, bone: number): void {
    const { solve } = pose;
    const { childStarts, children } = pose.rig.solver;
    const end = childStarts[bone + 1] ?? 0;

    for (let i = childStarts[bone] ?? 0; i < end; i++) {
        const child = children[i] ?? -1;

        if (solve.worldStamps[child] !== solve.stamp) continue;
        if (solve.localStamps[child] === solve.stamp) updateLocalTransform(pose, child);
        solve.worldStamps[child] = 0;
        resetWorld(pose, child);
    }
}

/** The official `BonePose.validateLocalTransform`: brings the local numbers of a bone up to date. */
export function validateLocal(pose: Pose43, bone: number): void {
    if (pose.solve.localStamps[bone] === pose.solve.stamp) updateLocalTransform(pose, bone);
}

/** The official `BonePose.modifyLocal`: call it before a constraint changes the local numbers of a bone. */
export function modifyLocal(pose: Pose43, bone: number): void {
    const { solve } = pose;

    if (solve.localStamps[bone] === solve.stamp) updateLocalTransform(pose, bone);
    solve.worldStamps[bone] = 0;
    resetWorld(pose, bone);
}

/** The official `BonePose.modifyWorld`: call it before a constraint changes the world transform of a bone. */
export function modifyWorld(pose: Pose43, bone: number): void {
    const { solve } = pose;

    solve.localStamps[bone] = solve.stamp;
    solve.worldStamps[bone] = solve.stamp;
    resetWorld(pose, bone);
}
