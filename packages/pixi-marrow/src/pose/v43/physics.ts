import { WORLD_STRIDE } from '../state';
import { modifyWorld } from './bone-pose';
import { DEG_RAD, PI2 } from './math';
import {
    PHYSICS_DAMPING,
    PHYSICS_GRAVITY,
    PHYSICS_INERTIA,
    PHYSICS_MASS_INVERSE,
    PHYSICS_MIX,
    PHYSICS_NONE,
    PHYSICS_POSE,
    PHYSICS_RESET,
    PHYSICS_STATE,
    PHYSICS_STRENGTH,
    PHYSICS_WIND,
    type PhysicsPlan,
} from './solver-types';
import type { Pose43 } from './types';

/*
 * The official `PhysicsConstraint`. What it keeps between updates is in `Solve43.physics`, at
 * `state` of its plan, in the order below. The arithmetic is in the order of the official code.
 *
 * Typed arrays are read in place, for the reasons given in solve.ts. The numbers of one update
 * that the functions here share go through `W`.
 */

/** The official `_reset`: 1 until the constraint has seen where its bone is. */
const FRESH = 0;
const UX = 1;
const UY = 2;
const CX = 3;
const CY = 4;
const TX = 5;
const TY = 6;
const X_OFFSET = 7;
const X_LAG = 8;
const X_VELOCITY = 9;
const Y_OFFSET = 10;
const Y_LAG = 11;
const Y_VELOCITY = 12;
const ROTATE_OFFSET = 13;
const ROTATE_LAG = 14;
const ROTATE_VELOCITY = 15;
const SCALE_OFFSET = 16;
const SCALE_LAG = 17;
const SCALE_VELOCITY = 18;
/** Where the official `remaining` of a physics constraint is among its numbers: the time no step has used yet. */
export const PHYSICS_REMAINING = 19;
/** Where the official `lastTime` of a physics constraint is among its numbers. */
export const PHYSICS_LAST_TIME = 20;
const REMAINING = PHYSICS_REMAINING;
const LAST_TIME = PHYSICS_LAST_TIME;

/** The official `MathUtils.invPI2`. */
const INV_PI2: number = 1 / PI2;
const SCALE_Y_UNIFORM = 1;
const SCALE_Y_VOLUME = 2;

/** The numbers of one update that the functions here share. No call keeps them across a return. */
const W = new Float64Array(9);
/** The official `mix` of the applied pose. */
const MIX = 0;
/** The official `z`: how far the bone lags behind the last step. */
const Z = 1;
/** The official `aa`: the seconds that were left over before this update. */
const AA = 2;
/** The official `a`: the seconds that are left over after the steps of this update. */
const A = 3;
/** The official `d`, `m` and `e`: the damping, the mass and the strength of one step. `d` is -1 until they are set. */
const D = 4;
const M = 5;
const E = 6;
/** The official `qx` and `qy`: how far the bone may move in this update. */
const QX = 7;
const QY = 8;

/** The state of the physics constraints of a new engine: nothing has moved, and no bone was seen yet. */
export function createPhysicsState(plans: readonly PhysicsPlan[]): Float64Array {
    const state = new Float64Array(plans.length * PHYSICS_STATE);

    for (const plan of plans) state[plan.state + FRESH] = 1;

    return state;
}

/** The official `PhysicsConstraint.reset`: forgets what earlier movement did to the constraint. */
export function resetPhysics(pose: Pose43, plan: PhysicsPlan): void {
    const s = pose.solve.physics;
    const o = plan.state;

    s[o + REMAINING] = 0;
    s[o + LAST_TIME] = pose.state.time;
    s[o + FRESH] = 1;
    s.fill(0, o + X_OFFSET, o + REMAINING);
}

/** The official `Skeleton.physicsTranslate`: every physics constraint sees the skeleton move by `x`, `y`. */
export function physicsTranslate(pose: Pose43, x: number, y: number): void {
    const s = pose.solve.physics;

    for (const plan of pose.rig.solver.physics) {
        const o = plan.state;

        s[o + UX] = Number(s[o + UX]) - x;
        s[o + UY] = Number(s[o + UY]) - y;
        s[o + CX] = Number(s[o + CX]) - x;
        s[o + CY] = Number(s[o + CY]) - y;
    }
}

/** The official `Skeleton.physicsRotate`: every physics constraint sees the skeleton turn around `x`, `y`. */
export function physicsRotate(pose: Pose43, x: number, y: number, degrees: number): void {
    const s = pose.solve.physics;
    const r = degrees * DEG_RAD;
    const cos = Math.cos(r);
    const sin = Math.sin(r);

    for (const plan of pose.rig.solver.physics) {
        const o = plan.state;
        const dx = Number(s[o + CX]) - x;
        const dy = Number(s[o + CY]) - y;
        const tx = dx * cos - dy * sin - dx;
        const ty = dx * sin + dy * cos - dy;

        s[o + UX] = Number(s[o + UX]) - tx;
        s[o + UY] = Number(s[o + UY]) - ty;
        s[o + CX] = Number(s[o + CX]) - tx;
        s[o + CY] = Number(s[o + CY]) - ty;
    }
}

/** Sets the damping, the mass and the strength of one step from the applied pose, as the official code does once per update. */
function setStep(applied: Float64Array, plan: PhysicsPlan): void {
    const { at } = plan;
    const t = plan.step;

    W[D] = Number(applied[at + PHYSICS_DAMPING]) ** (60 * t);
    W[M] = t * Number(applied[at + PHYSICS_MASS_INVERSE]);
    W[E] = Number(applied[at + PHYSICS_STRENGTH]);
}

/**
 * The translation part of the official update: the bone lags behind where it was, then springs
 * back in steps of `t` seconds. `x` and `y` say which axes the constraint moves.
 */
function translate(pose: Pose43, plan: PhysicsPlan, x: boolean, y: boolean): void {
    const { state } = pose;
    const { world } = state;
    const { applied, physics: s } = pose.solve;
    const { at } = plan;
    const o = plan.state;
    const b = plan.bone * WORLD_STRIDE;
    const t = plan.step;
    const mix = Number(W[MIX]);
    const i = Number(applied[at + PHYSICS_INERTIA]);
    const f = pose.rig.model.referenceScale;
    const bx = Number(world[b + 4]);
    const by = Number(world[b + 5]);
    let a = Number(s[o + REMAINING]);

    if (x) {
        const qx = Number(W[QX]);
        const u = (Number(s[o + UX]) - bx) * i;

        s[o + X_OFFSET] = Number(s[o + X_OFFSET]) + (u > qx ? qx : u < -qx ? -qx : u);
        s[o + UX] = bx;
    }
    if (y) {
        const qy = Number(W[QY]);
        const u = (Number(s[o + UY]) - by) * i;

        s[o + Y_OFFSET] = Number(s[o + Y_OFFSET]) + (u > qy ? qy : u < -qy ? -qy : u);
        s[o + UY] = by;
    }
    if (a >= t) {
        const xs = Number(s[o + X_OFFSET]);
        const ys = Number(s[o + Y_OFFSET]);

        setStep(applied, plan);
        const d = Number(W[D]);
        const m = Number(W[M]);
        const e = Number(W[E]);
        const w = f * Number(applied[at + PHYSICS_WIND]);
        const g = f * Number(applied[at + PHYSICS_GRAVITY]);
        const ax = (w * state.windX + g * state.gravityX) * state.scaleX;
        const ay = (w * state.windY + g * state.gravityY) * state.scaleY;
        let xOffset = xs;
        let xVelocity = Number(s[o + X_VELOCITY]);
        let yOffset = ys;
        let yVelocity = Number(s[o + Y_VELOCITY]);

        do {
            if (x) {
                xVelocity += (ax - xOffset * e) * m;
                xOffset += xVelocity * t;
                xVelocity *= d;
            }
            if (y) {
                yVelocity -= (ay + yOffset * e) * m;
                yOffset += yVelocity * t;
                yVelocity *= d;
            }
            a -= t;
        } while (a >= t);
        s[o + X_OFFSET] = xOffset;
        s[o + X_VELOCITY] = xVelocity;
        s[o + Y_OFFSET] = yOffset;
        s[o + Y_VELOCITY] = yVelocity;
        s[o + X_LAG] = xOffset - xs;
        s[o + Y_LAG] = yOffset - ys;
    }
    const z = Math.max(0, 1 - a / t);

    W[A] = a;
    W[Z] = z;
    if (x) world[b + 4] = bx + (Number(s[o + X_OFFSET]) - Number(s[o + X_LAG]) * z) * mix * plan.x;
    if (y) world[b + 5] = by + (Number(s[o + Y_OFFSET]) - Number(s[o + Y_LAG]) * z) * mix * plan.y;
}

/**
 * The rotation and scale part of the official update: the bone swings toward where its tip was
 * and stretches along itself, then springs back in steps of `t` seconds. `turns` is the official
 * `rotateOrShearX` and `scales` the official `scaleX`.
 */
function swing(pose: Pose43, plan: PhysicsPlan, turns: boolean, scales: boolean): void {
    const { state } = pose;
    const { world } = state;
    const { applied, physics: s } = pose.solve;
    const { at } = plan;
    const o = plan.state;
    const b = plan.bone * WORLD_STRIDE;
    const t = plan.step;
    const l = Number(pose.rig.model.bones.lengths[plan.bone]);
    const mix = Number(W[MIX]);
    const aa = Number(W[AA]);
    const qx = Number(W[QX]);
    const qy = Number(W[QY]);
    const i = Number(applied[at + PHYSICS_INERTIA]);
    const f = pose.rig.model.referenceScale;
    const boneA = Number(world[b]);
    const boneC = Number(world[b + 2]);
    const ca = Math.atan2(boneC, boneA);
    let c = 0;
    let sn = 0;
    let mr = 0;
    let dx = Number(s[o + CX]) - Number(world[b + 4]);
    let dy = Number(s[o + CY]) - Number(world[b + 5]);
    let rotateOffset = Number(s[o + ROTATE_OFFSET]);
    let scaleOffset = Number(s[o + SCALE_OFFSET]);

    if (dx > qx) dx = qx;
    else if (dx < -qx) dx = -qx;
    if (dy > qy) dy = qy;
    else if (dy < -qy) dy = -qy;
    let a = Number(s[o + REMAINING]);

    if (turns) {
        mr = (plan.rotate + plan.shearX) * mix;
        const z = Number(s[o + ROTATE_LAG]) * Math.max(0, 1 - aa / t);
        let r = Math.atan2(dy + Number(s[o + TY]), dx + Number(s[o + TX])) - ca - (rotateOffset - z) * mr;

        rotateOffset += (r - Math.ceil(r * INV_PI2 - 0.5) * PI2) * i;
        r = (rotateOffset - z) * mr + ca;
        c = Math.cos(r);
        sn = Math.sin(r);
        if (scales) {
            r = l * Math.sqrt(boneA * boneA + boneC * boneC);
            if (r > 0) scaleOffset += ((dx * c + dy * sn) * i) / r;
        }
    } else {
        c = Math.cos(ca);
        sn = Math.sin(ca);
        const r = l * Math.sqrt(boneA * boneA + boneC * boneC) - Number(s[o + SCALE_LAG]) * Math.max(0, 1 - aa / t);

        if (r > 0) scaleOffset += ((dx * c + dy * sn) * i) / r;
    }
    if (a >= t) {
        if (W[D] === -1) setStep(applied, plan);
        const d = Number(W[D]);
        const m = Number(W[M]);
        const e = Number(W[E]);
        const wind = Number(applied[at + PHYSICS_WIND]);
        const gravity = Number(applied[at + PHYSICS_GRAVITY]);
        const ax = wind * state.windX + gravity * state.gravityX;
        // the official Skeleton.yDir
        const ay = (wind * state.windY + gravity * state.gravityY) * (state.yDown ? -1 : 1);
        const rs = rotateOffset;
        const ss = scaleOffset;
        const h = l / f;
        let rotateVelocity = Number(s[o + ROTATE_VELOCITY]);
        let scaleVelocity = Number(s[o + SCALE_VELOCITY]);

        while (true) {
            a -= t;
            if (scales) {
                scaleVelocity += (ax * c - ay * sn - scaleOffset * e) * m;
                scaleOffset += scaleVelocity * t;
                scaleVelocity *= d;
            }
            if (turns) {
                rotateVelocity -= ((ax * sn + ay * c) * h + rotateOffset * e) * m;
                rotateOffset += rotateVelocity * t;
                rotateVelocity *= d;
                if (a < t) break;
                const r = rotateOffset * mr + ca;

                c = Math.cos(r);
                sn = Math.sin(r);
            } else if (a < t) break;
        }
        s[o + ROTATE_VELOCITY] = rotateVelocity;
        s[o + SCALE_VELOCITY] = scaleVelocity;
        s[o + ROTATE_LAG] = rotateOffset - rs;
        s[o + SCALE_LAG] = scaleOffset - ss;
    }
    s[o + ROTATE_OFFSET] = rotateOffset;
    s[o + SCALE_OFFSET] = scaleOffset;
    W[A] = a;
    W[Z] = Math.max(0, 1 - a / t);
}

/**
 * The official `Physics.update` case: advances the constraint by the time that passed since its
 * last update and moves the bone. Writes the official `z` to `W`.
 */
function simulate(pose: Pose43, plan: PhysicsPlan): void {
    const { state } = pose;
    const { world } = state;
    const s = pose.solve.physics;
    const o = plan.state;
    const b = plan.bone * WORLD_STRIDE;
    const delta = Math.max(state.time - Number(s[o + LAST_TIME]), 0);
    const x = plan.x > 0;
    const y = plan.y > 0;
    const turns = plan.rotate > 0 || plan.shearX > 0;
    const scales = plan.scaleX > 0;

    W[AA] = Number(s[o + REMAINING]);
    s[o + REMAINING] = Number(s[o + REMAINING]) + delta;
    s[o + LAST_TIME] = state.time;
    if (s[o + FRESH] === 1) {
        s[o + FRESH] = 0;
        s[o + UX] = Number(world[b + 4]);
        s[o + UY] = Number(world[b + 5]);
    } else {
        const q = plan.limit * delta;

        W[A] = Number(s[o + REMAINING]);
        W[D] = -1;
        W[QY] = q * Math.abs(state.scaleY);
        W[QX] = q * Math.abs(state.scaleX);
        if (x || y) translate(pose, plan, x, y);
        if (turns || scales) swing(pose, plan, turns, scales);
        s[o + REMAINING] = Number(W[A]);
    }
    s[o + CX] = Number(world[b + 4]);
    s[o + CY] = Number(world[b + 5]);
}

/** Turns the axes of the bone by what the constraint has swung: the rotation and shear part of the official update. */
function turnBone(pose: Pose43, plan: PhysicsPlan): void {
    const { world } = pose.state;
    const s = pose.solve.physics;
    const o = plan.state;
    const b = plan.bone * WORLD_STRIDE;
    let offset = (Number(s[o + ROTATE_OFFSET]) - Number(s[o + ROTATE_LAG]) * Number(W[Z])) * Number(W[MIX]);
    let sin = 0;
    let cos = 0;
    let a = 0;

    if (plan.shearX > 0) {
        let r = 0;

        if (plan.rotate > 0) {
            r = offset * plan.rotate;
            sin = Math.sin(r);
            cos = Math.cos(r);
            a = Number(world[b + 1]);
            world[b + 1] = cos * a - sin * Number(world[b + 3]);
            world[b + 3] = sin * a + cos * Number(world[b + 3]);
        }
        r += offset * plan.shearX;
        sin = Math.sin(r);
        cos = Math.cos(r);
        a = Number(world[b]);
        world[b] = cos * a - sin * Number(world[b + 2]);
        world[b + 2] = sin * a + cos * Number(world[b + 2]);
    } else {
        offset *= plan.rotate;
        sin = Math.sin(offset);
        cos = Math.cos(offset);
        a = Number(world[b]);
        world[b] = cos * a - sin * Number(world[b + 2]);
        world[b + 2] = sin * a + cos * Number(world[b + 2]);
        a = Number(world[b + 1]);
        world[b + 1] = cos * a - sin * Number(world[b + 3]);
        world[b + 3] = sin * a + cos * Number(world[b + 3]);
    }
}

/** Scales the bone along itself by what the constraint has stretched: the scale part of the official update. */
function scaleBone(pose: Pose43, plan: PhysicsPlan): void {
    const { world } = pose.state;
    const s = pose.solve.physics;
    const o = plan.state;
    const b = plan.bone * WORLD_STRIDE;
    let scale =
        1 + (Number(s[o + SCALE_OFFSET]) - Number(s[o + SCALE_LAG]) * Number(W[Z])) * Number(W[MIX]) * plan.scaleX;

    world[b] = Number(world[b]) * scale;
    world[b + 2] = Number(world[b + 2]) * scale;
    if (plan.scaleYMode === SCALE_Y_VOLUME) {
        scale = Math.abs(scale);
        scale = scale >= 0.7 ? 1 / scale : 4 - 3.67347 * scale;
    }
    if (plan.scaleYMode === SCALE_Y_UNIFORM || plan.scaleYMode === SCALE_Y_VOLUME) {
        world[b + 1] = Number(world[b + 1]) * scale;
        world[b + 3] = Number(world[b + 3]) * scale;
    }
}

/** The official `Physics.pose` case: moves the bone to where the constraint is, without advancing it. */
function poseOnly(pose: Pose43, plan: PhysicsPlan): void {
    const { world } = pose.state;
    const s = pose.solve.physics;
    const o = plan.state;
    const b = plan.bone * WORLD_STRIDE;
    const mix = Number(W[MIX]);
    const z = Math.max(0, 1 - Number(s[o + REMAINING]) / plan.step);

    W[Z] = z;
    if (plan.x > 0) {
        world[b + 4] = Number(world[b + 4]) + (Number(s[o + X_OFFSET]) - Number(s[o + X_LAG]) * z) * mix * plan.x;
    }
    if (plan.y > 0) {
        world[b + 5] = Number(world[b + 5]) + (Number(s[o + Y_OFFSET]) - Number(s[o + Y_LAG]) * z) * mix * plan.y;
    }
}

/**
 * The official `PhysicsConstraint.update` from where it has marked its bone: moves, turns and
 * scales the bone in the world and advances the state of the constraint, by the mode in
 * `Solve43.physicsMode`. The constraint has a mix and the mode is not `none`.
 */
export function stepPhysics(pose: Pose43, plan: PhysicsPlan): void {
    const { solve } = pose;
    const mode = solve.physicsMode;

    W[MIX] = Number(solve.applied[plan.at + PHYSICS_MIX]);
    W[Z] = 0;
    if (mode === PHYSICS_POSE) poseOnly(pose, plan);
    else {
        if (mode === PHYSICS_RESET) resetPhysics(pose, plan);
        simulate(pose, plan);
    }
    if (plan.rotate > 0 || plan.shearX > 0) turnBone(pose, plan);
    if (plan.scaleX > 0) scaleBone(pose, plan);
    if (mode !== PHYSICS_POSE) {
        const { world } = pose.state;
        const b = plan.bone * WORLD_STRIDE;
        const l = Number(pose.rig.model.bones.lengths[plan.bone]);

        solve.physics[plan.state + TX] = l * Number(world[b]);
        solve.physics[plan.state + TY] = l * Number(world[b + 2]);
    }
}

/**
 * The official `PhysicsConstraint.update`: moves, turns and scales the bone of the constraint in
 * the world, by the mode in `Solve43.physicsMode`. While an update is probed for physics that
 * rest, it notes the world transform the bone had before.
 */
export function solvePhysics(pose: Pose43, plan: PhysicsPlan): void {
    const { solve } = pose;

    if (Number(solve.applied[plan.at + PHYSICS_MIX]) === 0 || solve.physicsMode === PHYSICS_NONE) return;
    modifyWorld(pose, plan.bone);
    if (solve.probing) {
        const { world } = pose.state;
        const { seen } = pose.rig.solver.scratch;
        const b = plan.bone * WORLD_STRIDE;
        const k = (plan.state / PHYSICS_STATE) * WORLD_STRIDE;

        for (let i = 0; i < WORLD_STRIDE; i++) seen[k + i] = Number(world[b + i]);
    }
    stepPhysics(pose, plan);
}
