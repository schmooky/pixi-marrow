import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import { updateAppliedTransform } from './applied';
import { CONSTRAINT_STRIDE, type LegacyConstraint, TRANSFORM_MIX } from './constraints';
import { DEG_RAD, PI, PI2 } from './math';
import type { Solver } from './solver';
import { updateBone } from './world';

/*
 * The official `TransformConstraint`: its four variants, each with the official arithmetic.
 * A value offset below is added to `v`, the index of the constraint's animated values.
 */

const ROTATE = TRANSFORM_MIX;
const X = TRANSFORM_MIX + 1;
const Y = TRANSFORM_MIX + 2;
const SCALE_X = TRANSFORM_MIX + 3;
const SCALE_Y = TRANSFORM_MIX + 4;
const SHEAR_Y = TRANSFORM_MIX + 5;

/** Offsets into the `offsets` of a constraint: rotation, x, y, scaleX, scaleY, shearY. */
const OFFSET_ROTATION = 0;
const OFFSET_X = 1;
const OFFSET_Y = 2;
const OFFSET_SCALE_X = 3;
const OFFSET_SCALE_Y = 4;
const OFFSET_SHEAR_Y = 5;

/**
 * Scratch of the world variants: the target matrix ta, tb, tc, td as it was before the first
 * bone, then the rotation and shear offsets in radians, mirrored with the target.
 */
const t = new Float64Array(6);
const TA = 0;
const TB = 1;
const TC = 2;
const TD = 3;
const ROTATION_OFFSET = 4;
const SHEAR_OFFSET = 5;

/** Reads the target matrix once, as the official code does before its loop over the bones. */
function readTarget(solver: Solver, constraint: LegacyConstraint): void {
    const world = solver.pose.world;
    const w = constraint.target * WORLD_STRIDE;
    const ta = Number(world[w]);
    const tb = Number(world[w + 1]);
    const tc = Number(world[w + 2]);
    const td = Number(world[w + 3]);
    const degRadReflect = ta * td - tb * tc > 0 ? DEG_RAD : -DEG_RAD;

    t[TA] = ta;
    t[TB] = tb;
    t[TC] = tc;
    t[TD] = td;
    t[ROTATION_OFFSET] = Number(constraint.offsets[OFFSET_ROTATION]) * degRadReflect;
    t[SHEAR_OFFSET] = Number(constraint.offsets[OFFSET_SHEAR_Y]) * degRadReflect;
}

/** Turns the matrix of a bone toward the rotation of the target, or by it for a relative constraint. */
function rotate(solver: Solver, constraint: LegacyConstraint, w: number): void {
    const world = solver.pose.world;
    const a = Number(world[w]);
    const b = Number(world[w + 1]);
    const c = Number(world[w + 2]);
    const d = Number(world[w + 3]);
    let r = Math.atan2(Number(t[TC]), Number(t[TA]));

    if (constraint.relative) r += Number(t[ROTATION_OFFSET]);
    else r = r - Math.atan2(c, a) + Number(t[ROTATION_OFFSET]);
    if (r > PI) r -= PI2;
    else if (r < -PI) r += PI2;
    r *= Number(solver.values[constraint.index * CONSTRAINT_STRIDE + ROTATE]);
    const cos = Math.cos(r);
    const sin = Math.sin(r);

    world[w] = cos * a - sin * c;
    world[w + 1] = cos * b - sin * d;
    world[w + 2] = sin * a + cos * c;
    world[w + 3] = sin * b + cos * d;
}

/**
 * Moves a bone toward the offset point in the space of the target, or by it for a relative
 * constraint. The target is read as it is now: it can be one of the bones.
 */
function translate(solver: Solver, constraint: LegacyConstraint, w: number): void {
    const world = solver.pose.world;
    const values = solver.values;
    const v = constraint.index * CONSTRAINT_STRIDE;
    const tw = constraint.target * WORLD_STRIDE;
    const x = Number(constraint.offsets[OFFSET_X]);
    const y = Number(constraint.offsets[OFFSET_Y]);
    const tx = x * Number(world[tw]) + y * Number(world[tw + 1]) + Number(world[tw + 4]);
    const ty = x * Number(world[tw + 2]) + y * Number(world[tw + 3]) + Number(world[tw + 5]);

    if (constraint.relative) {
        world[w + 4] = Number(world[w + 4]) + tx * Number(values[v + X]);
        world[w + 5] = Number(world[w + 5]) + ty * Number(values[v + Y]);
    } else {
        world[w + 4] = Number(world[w + 4]) + (tx - Number(world[w + 4])) * Number(values[v + X]);
        world[w + 5] = Number(world[w + 5]) + (ty - Number(world[w + 5])) * Number(values[v + Y]);
    }
}

/**
 * Scales one axis of a bone matrix toward the length of that axis of the target, or by it for a
 * relative constraint. `axis` is 0 for the x axis, which is a and c, and 1 for the y axis, b and d.
 */
function scaleAxis(solver: Solver, constraint: LegacyConstraint, w: number, axis: number): void {
    const world = solver.pose.world;
    const mix = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + SCALE_X + axis]);
    const offset = Number(constraint.offsets[OFFSET_SCALE_X + axis]);
    const tx = Number(t[TA + axis]);
    const ty = Number(t[TC + axis]);
    const x = Number(world[w + axis]);
    const y = Number(world[w + axis + 2]);
    let s = 0;

    if (constraint.relative) {
        s = (Math.sqrt(tx * tx + ty * ty) - 1 + offset) * mix + 1;
    } else {
        s = Math.sqrt(x * x + y * y);
        if (s !== 0) s = (s + (Math.sqrt(tx * tx + ty * ty) - s + offset) * mix) / s;
    }
    world[w + axis] = x * s;
    world[w + axis + 2] = y * s;
}

/** Shears the y axis of a bone matrix toward the shear of the target, or by it for a relative constraint. */
function shear(solver: Solver, constraint: LegacyConstraint, w: number): void {
    const world = solver.pose.world;
    const mixShearY = Number(solver.values[constraint.index * CONSTRAINT_STRIDE + SHEAR_Y]);
    const b = Number(world[w + 1]);
    const d = Number(world[w + 3]);
    let r = Math.atan2(Number(t[TD]), Number(t[TB])) - Math.atan2(Number(t[TC]), Number(t[TA]));

    if (constraint.relative) {
        if (r > PI) r -= PI2;
        else if (r < -PI) r += PI2;
        r = Math.atan2(d, b) + (r - PI / 2 + Number(t[SHEAR_OFFSET])) * mixShearY;
    } else {
        const by = Math.atan2(d, b);

        r -= by - Math.atan2(Number(world[w + 2]), Number(world[w]));
        if (r > PI) r -= PI2;
        else if (r < -PI) r += PI2;
        r = by + (r + Number(t[SHEAR_OFFSET])) * mixShearY;
    }
    const s = Math.sqrt(b * b + d * d);

    world[w + 1] = Math.cos(r) * s;
    world[w + 3] = Math.sin(r) * s;
}

/** One bone of the official `applyAbsoluteWorld` or `applyRelativeWorld`. */
function worldBone(solver: Solver, constraint: LegacyConstraint, bone: number, translated: boolean): void {
    const { pose, values } = solver;
    const v = constraint.index * CONSTRAINT_STRIDE;
    const w = bone * WORLD_STRIDE;

    if (Number(values[v + ROTATE]) !== 0) rotate(solver, constraint, w);
    if (translated) translate(solver, constraint, w);
    if (Number(values[v + SCALE_X]) !== 0) scaleAxis(solver, constraint, w, 0);
    if (Number(values[v + SCALE_Y]) !== 0) scaleAxis(solver, constraint, w, 1);
    if (Number(values[v + SHEAR_Y]) > 0) shear(solver, constraint, w);
    updateAppliedTransform(pose, solver.applied, solver.rig.model.bones.parents, bone, solver.rig.v41);
}

/** The official `applyAbsoluteWorld` and `applyRelativeWorld`. */
function solveWorld(solver: Solver, constraint: LegacyConstraint): void {
    const v = constraint.index * CONSTRAINT_STRIDE;
    const translated = Number(solver.values[v + X]) !== 0 || Number(solver.values[v + Y]) !== 0;
    const bones = constraint.bones;

    readTarget(solver, constraint);
    for (let i = 0, n = bones.length; i < n; i++) worldBone(solver, constraint, bones[i] ?? -1, translated);
}

/** One bone of the official `applyAbsoluteLocal`. The applied pose of the target is read as it is now. */
function absoluteLocalBone(solver: Solver, constraint: LegacyConstraint, bone: number): void {
    const { applied, values, rig } = solver;
    const offsets = constraint.offsets;
    const v = constraint.index * CONSTRAINT_STRIDE;
    const o = bone * LOCAL_STRIDE;
    const to = constraint.target * LOCAL_STRIDE;
    const mixRotate = Number(values[v + ROTATE]);
    const mixScaleX = Number(values[v + SCALE_X]);
    const mixScaleY = Number(values[v + SCALE_Y]);
    const mixShearY = Number(values[v + SHEAR_Y]);
    let rotation = Number(applied[o + 2]);
    let x = Number(applied[o]);
    let y = Number(applied[o + 1]);
    let scaleX = Number(applied[o + 3]);
    let scaleY = Number(applied[o + 4]);
    let shearY = Number(applied[o + 6]);

    if (mixRotate !== 0) {
        let r = Number(applied[to + 2]) - rotation + Number(offsets[OFFSET_ROTATION]);

        // 4.1 wraps the difference into the half turn around zero, 4.2 mixes it as it is
        if (rig.v41) r -= (16384 - ((16384.499999999996 - r / 360) | 0)) * 360;
        rotation += r * mixRotate;
    }
    x += (Number(applied[to]) - x + Number(offsets[OFFSET_X])) * Number(values[v + X]);
    y += (Number(applied[to + 1]) - y + Number(offsets[OFFSET_Y])) * Number(values[v + Y]);
    if (mixScaleX !== 0 && scaleX !== 0) {
        scaleX = (scaleX + (Number(applied[to + 3]) - scaleX + Number(offsets[OFFSET_SCALE_X])) * mixScaleX) / scaleX;
    }
    if (mixScaleY !== 0 && scaleY !== 0) {
        scaleY = (scaleY + (Number(applied[to + 4]) - scaleY + Number(offsets[OFFSET_SCALE_Y])) * mixScaleY) / scaleY;
    }
    if (mixShearY !== 0) {
        let r = Number(applied[to + 6]) - shearY + Number(offsets[OFFSET_SHEAR_Y]);

        if (rig.v41) r -= (16384 - ((16384.499999999996 - r / 360) | 0)) * 360;
        shearY += r * mixShearY;
    }
    applied[o] = x;
    applied[o + 1] = y;
    applied[o + 2] = rotation;
    applied[o + 3] = scaleX;
    applied[o + 4] = scaleY;
    applied[o + 6] = shearY;
    updateBone(solver.pose, applied, rig.model.bones.parents, bone, rig.v41);
}

/** One bone of the official `applyRelativeLocal`. */
function relativeLocalBone(solver: Solver, constraint: LegacyConstraint, bone: number): void {
    const { applied, values, rig } = solver;
    const offsets = constraint.offsets;
    const v = constraint.index * CONSTRAINT_STRIDE;
    const o = bone * LOCAL_STRIDE;
    const to = constraint.target * LOCAL_STRIDE;
    const rotation =
        Number(applied[o + 2]) +
        (Number(applied[to + 2]) + Number(offsets[OFFSET_ROTATION])) * Number(values[v + ROTATE]);
    const x = Number(applied[o]) + (Number(applied[to]) + Number(offsets[OFFSET_X])) * Number(values[v + X]);
    const y = Number(applied[o + 1]) + (Number(applied[to + 1]) + Number(offsets[OFFSET_Y])) * Number(values[v + Y]);
    const scaleX =
        Number(applied[o + 3]) *
        ((Number(applied[to + 3]) - 1 + Number(offsets[OFFSET_SCALE_X])) * Number(values[v + SCALE_X]) + 1);
    const scaleY =
        Number(applied[o + 4]) *
        ((Number(applied[to + 4]) - 1 + Number(offsets[OFFSET_SCALE_Y])) * Number(values[v + SCALE_Y]) + 1);
    const shearY =
        Number(applied[o + 6]) +
        (Number(applied[to + 6]) + Number(offsets[OFFSET_SHEAR_Y])) * Number(values[v + SHEAR_Y]);

    applied[o] = x;
    applied[o + 1] = y;
    applied[o + 2] = rotation;
    applied[o + 3] = scaleX;
    applied[o + 4] = scaleY;
    applied[o + 6] = shearY;
    updateBone(solver.pose, applied, rig.model.bones.parents, bone, rig.v41);
}

/** The official `TransformConstraint.update`: nothing when every mix is zero, else one of the four variants. */
export function solveTransform(solver: Solver, constraint: LegacyConstraint): void {
    const values = solver.values;
    const v = constraint.index * CONSTRAINT_STRIDE;
    const bones = constraint.bones;
    let idle = true;

    for (let i = 0; i < 6; i++) idle = idle && Number(values[v + i]) === 0;
    if (idle) return;
    if (!constraint.local) {
        solveWorld(solver, constraint);
    } else if (constraint.relative) {
        for (let i = 0, n = bones.length; i < n; i++) relativeLocalBone(solver, constraint, bones[i] ?? -1);
    } else {
        for (let i = 0, n = bones.length; i < n; i++) absoluteLocalBone(solver, constraint, bones[i] ?? -1);
    }
}
