import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import { modifyLocal, modifyWorld, validateLocal } from './bone-pose';
import { DEG_RAD, PI, PI2, RAD_DEG } from './math';
import type { TransformPlan } from './solver-types';
import type { Pose43 } from './types';

// The property kinds: the official `TransformConstraintData` numbers.
const ROTATION = 0;
const X = 1;
const Y = 2;
const SCALE_X = 3;
const SCALE_Y = 4;
const SHEAR_Y = 5;

/** Where each property kind is among the local numbers of a bone. */
const LOCAL_OFFSETS: readonly number[] = [2, 0, 1, 3, 4, 6];

/**
 * The value that is on its way from the source bone to a bone of the constraint. It goes through
 * this array and typed arrays are read in place, for the reasons given in solve.ts. No call keeps
 * the array across a return.
 */
export const V: Float64Array = new Float64Array(2);
/** Where the value of a source property is in {@link V}. */
export const SOURCE = 0;
/** The value a target property is set to. */
const TARGET = 1;

/** The official `FromProperty.value` of a bone in world coordinates. Writes it to `V`. */
function readWorld(pose: Pose43, bone: number, offsets: Float64Array, kind: number): void {
    const { state } = pose;
    const { world } = state;
    const o = bone * WORLD_STRIDE;
    const a = Number(world[o]);
    const b = Number(world[o + 1]);
    const c = Number(world[o + 2]);
    const d = Number(world[o + 3]);
    const sx = state.scaleX;
    const sy = state.scaleY;

    switch (kind) {
        case ROTATION: {
            const offset = Number(offsets[ROTATION]);
            const value = Math.atan2(c / sy, a / sx) * RAD_DEG + ((a * d - b * c) * sx * sy > 0 ? offset : -offset);

            V[SOURCE] = value < 0 ? value + 360 : value;
            break;
        }
        case X:
            V[SOURCE] = (Number(offsets[X]) * a + Number(offsets[Y]) * b + Number(world[o + 4])) / sx;
            break;
        case Y:
            V[SOURCE] = (Number(offsets[X]) * c + Number(offsets[Y]) * d + Number(world[o + 5])) / sy;
            break;
        case SCALE_X: {
            const ax = a / sx;
            const cy = c / sy;

            V[SOURCE] = Math.sqrt(ax * ax + cy * cy) + Number(offsets[SCALE_X]);
            break;
        }
        case SCALE_Y: {
            const bx = b / sx;
            const dy = d / sy;

            V[SOURCE] = Math.sqrt(bx * bx + dy * dy) + Number(offsets[SCALE_Y]);
            break;
        }
        default: {
            const ix = 1 / sx;
            const iy = 1 / sy;

            V[SOURCE] =
                (Math.atan2(d * iy, b * ix) - Math.atan2(c * iy, a * ix)) * RAD_DEG - 90 + Number(offsets[SHEAR_Y]);
        }
    }
}

/**
 * The official `FromProperty.value`: one property of the applied pose of a bone, in local or in
 * world coordinates. Writes it to {@link V} at {@link SOURCE}.
 *
 * @param offsets The six official offsets, by property kind.
 * @param kind The property kind: see `TransformPlan`.
 */
export function readProperty(pose: Pose43, bone: number, offsets: Float64Array, kind: number, local: boolean): void {
    if (local) {
        const i = bone * LOCAL_STRIDE + (LOCAL_OFFSETS[kind] ?? 0);

        V[SOURCE] = Number(pose.solve.local[i]) + Number(offsets[kind]);
    } else readWorld(pose, bone, offsets, kind);
}

/**
 * The official `FromProperty.value` minus the offset of the property: one property of the source
 * bone. Writes it to `V`.
 */
function readSource(pose: Pose43, plan: TransformPlan, from: number): void {
    readProperty(pose, plan.source, plan.offsets, plan.fromKinds[from] ?? 0, plan.localSource);
    V[SOURCE] = Number(V[SOURCE]) - Number(plan.fromOffsets[from]);
}

/** The official `ToProperty.apply` for local coordinates: mixes the target value into one local number of a bone. */
function applyLocal(pose: Pose43, plan: TransformPlan, bone: number, kind: number): void {
    const { local, applied } = pose.solve;
    const { additive } = plan;
    const mix = Number(applied[plan.at + kind]);
    const i = bone * LOCAL_STRIDE + (LOCAL_OFFSETS[kind] ?? 0);
    const current = Number(local[i]);
    let value = Number(V[TARGET]);

    if (kind === SCALE_X || kind === SCALE_Y) {
        if (additive) local[i] = current * (1 + (value - 1) * mix);
        else if (current !== 0) local[i] = current + (value - current) * mix;
    } else if (kind === SHEAR_Y) {
        if (!additive) value -= current;
        local[i] = current + value * mix;
    } else {
        local[i] = current + (additive ? value : value - current) * mix;
    }
}

/** The official `ToRotate.apply` in world coordinates: turns the axes of a bone. */
function rotateWorld(pose: Pose43, plan: TransformPlan, o: number): void {
    const { state } = pose;
    const { world } = state;
    const sx = state.scaleX;
    const sy = state.scaleY;
    const ix = 1 / sx;
    const iy = 1 / sy;
    const a = Number(world[o]) * ix;
    const b = Number(world[o + 1]) * ix;
    const c = Number(world[o + 2]) * iy;
    const d = Number(world[o + 3]) * iy;
    let value = Number(V[TARGET]) * DEG_RAD;

    if (!plan.additive) value -= Math.atan2(c, a);
    if (value > PI) value -= PI2;
    else if (value < -PI) value += PI2;
    value *= Number(pose.solve.applied[plan.at + ROTATION]);
    const cos = Math.cos(value);
    const sin = Math.sin(value);

    world[o] = (cos * a - sin * c) * sx;
    world[o + 1] = (cos * b - sin * d) * sx;
    world[o + 2] = (sin * a + cos * c) * sy;
    world[o + 3] = (sin * b + cos * d) * sy;
}

/**
 * The official `ToScaleX.apply` and `ToScaleY.apply` in world coordinates: scales one axis of a
 * bone. `o` points at the x part of the axis, the y part is two numbers later.
 */
function scaleWorld(pose: Pose43, plan: TransformPlan, o: number, kind: number): void {
    const { state } = pose;
    const { world } = state;
    const value = Number(V[TARGET]);
    const mix = Number(pose.solve.applied[plan.at + kind]);
    let s = 0;

    if (plan.additive) s = 1 + (value - 1) * mix;
    else {
        const x = Number(world[o]) / state.scaleX;
        const y = Number(world[o + 2]) / state.scaleY;

        s = Math.sqrt(x * x + y * y);
        if (s === 0) return;
        s = 1 + ((value - s) * mix) / s;
    }
    world[o] = Number(world[o]) * s;
    world[o + 2] = Number(world[o + 2]) * s;
}

/** The official `ToShearY.apply` in world coordinates: turns the y axis of a bone. */
function shearWorld(pose: Pose43, plan: TransformPlan, o: number): void {
    const { state } = pose;
    const { world } = state;
    const sx = state.scaleX;
    const sy = state.scaleY;
    const b = Number(world[o + 1]) / sx;
    const d = Number(world[o + 3]) / sy;
    const by = Math.atan2(d, b);
    let value = (Number(V[TARGET]) + 90) * DEG_RAD;

    if (plan.additive) value -= PI / 2;
    else {
        value -= by - Math.atan2(Number(world[o + 2]) / sy, Number(world[o]) / sx);
        if (value > PI) value -= PI2;
        else if (value < -PI) value += PI2;
    }
    value = by + value * Number(pose.solve.applied[plan.at + SHEAR_Y]);
    const s = Math.sqrt(b * b + d * d);

    world[o + 1] = Math.cos(value) * s * sx;
    world[o + 3] = Math.sin(value) * s * sy;
}

/**
 * The official `ToX.apply` and `ToY.apply` in world coordinates: moves a bone along one axis of
 * the world. `kind` is `X` or `Y`.
 */
function moveWorld(pose: Pose43, plan: TransformPlan, bone: number, kind: number): void {
    const { state } = pose;
    const { world } = state;
    const i = bone * WORLD_STRIDE + (kind === X ? 4 : 5);
    const scale = kind === X ? state.scaleX : state.scaleY;
    let value = Number(V[TARGET]);

    if (!plan.additive) value -= Number(world[i]) / scale;
    world[i] = Number(world[i]) + value * Number(pose.solve.applied[plan.at + kind]) * scale;
}

/** The official `ToProperty.apply` for world coordinates: mixes the target value into the world transform of a bone. */
function applyWorld(pose: Pose43, plan: TransformPlan, bone: number, kind: number): void {
    const o = bone * WORLD_STRIDE;

    switch (kind) {
        case ROTATION:
            rotateWorld(pose, plan, o);
            break;
        case X:
        case Y:
            moveWorld(pose, plan, bone, kind);
            break;
        case SCALE_X:
            scaleWorld(pose, plan, o, kind);
            break;
        case SCALE_Y:
            scaleWorld(pose, plan, o + 1, kind);
            break;
        default:
            shearWorld(pose, plan, o);
    }
}

/** Keeps the target value between the offset and the maximum of a target property, whichever is lower. */
function clampTarget(plan: TransformPlan, to: number): void {
    const offset = Number(plan.toOffsets[to]);
    const max = Number(plan.toMax[to]);
    const low = offset < max ? offset : max;
    const high = offset < max ? max : offset;

    // the official MathUtils.clamp
    if (Number(V[TARGET]) < low) V[TARGET] = low;
    else if (Number(V[TARGET]) > high) V[TARGET] = high;
}

/** Applies every target property of one source property to one bone. Reads the source value from `V`. */
function applyTargets(pose: Pose43, plan: TransformPlan, from: number, bone: number): void {
    const values = pose.solve.applied;
    const { toKinds, toOffsets, toScales } = plan;
    const v = plan.at;
    const end = plan.toStarts[from + 1] ?? 0;

    for (let t = plan.toStarts[from] ?? 0; t < end; t++) {
        const kind = toKinds[t] ?? 0;

        if (values[v + kind] === 0) continue;
        V[TARGET] = Number(toOffsets[t]) + Number(V[SOURCE]) * Number(toScales[t]);
        if (plan.clamp) clampTarget(plan, t);
        if (plan.localTarget) applyLocal(pose, plan, bone, kind);
        else applyWorld(pose, plan, bone, kind);
    }
}

/** True when every mix of a transform constraint is 0, so that it changes nothing. */
function mixedOut(values: Float64Array, v: number): boolean {
    for (let i = v; i < v + 6; i++) if (values[i] !== 0) return false;

    return true;
}

/**
 * The official `TransformConstraint.update`: reads properties of the source bone and mixes them
 * into the bones of the constraint, in local or in world coordinates.
 */
export function solveTransform(pose: Pose43, plan: TransformPlan): void {
    const { bones, fromKinds } = plan;

    if (mixedOut(pose.solve.applied, plan.at)) return;
    if (plan.localSource) validateLocal(pose, plan.source);
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i] ?? -1;

        if (plan.localTarget) modifyLocal(pose, bone);
        else modifyWorld(pose, bone);
        for (let f = 0; f < fromKinds.length; f++) {
            readSource(pose, plan, f);
            applyTargets(pose, plan, f, bone);
        }
    }
}
