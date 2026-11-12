import { WORLD_STRIDE } from '../state';
import { updateAppliedTransform } from './applied';
import {
    type LegacyConstraint,
    PHYSICS_DATA_STRIDE,
    PHYSICS_LENGTH,
    PHYSICS_LIMIT,
    PHYSICS_ROTATE,
    PHYSICS_SCALE_X,
    PHYSICS_SHEAR_X,
    PHYSICS_STEP,
    PHYSICS_X,
    PHYSICS_Y,
} from './constraints';
import { INV_PI2, PI2 } from './math';
import {
    CX,
    CY,
    DAMPING,
    GRAVITY,
    INERTIA,
    LAST_TIME,
    MASS_INVERSE,
    MIX,
    PHYSICS_NONE,
    PHYSICS_POSE,
    PHYSICS_RESET,
    PHYSICS_STRIDE,
    REMAINING,
    RESET,
    ROTATE_OFFSET,
    ROTATE_VELOCITY,
    resetPhysics,
    SCALE_OFFSET,
    SCALE_VELOCITY,
    STRENGTH,
    TX,
    TY,
    UX,
    UY,
    WIND,
    X_OFFSET,
    X_VELOCITY,
    Y_OFFSET,
    Y_VELOCITY,
} from './physics-state';
import type { Solver } from './solver';

/*
 * The official `PhysicsConstraint.update`, cut into steps. The arithmetic and its order are the
 * official ones. In every function `s` is the index of the state of the constraint, `k` the index
 * of its data and `w` the index of the world transform of its bone. The numbers one step hands to
 * the next live in `q`: a number that is passed to a call or returned from one can cost an allocation.
 */

/**
 * Scratch of one physics constraint. After a constraint ran, physics-rest.ts reads from it what
 * the next update of that constraint would start from.
 */
export const PHYSICS_SCRATCH: Float64Array = new Float64Array(9);
const q = PHYSICS_SCRATCH;
/** The most the bone may have moved along x since the last update, for the simulation: the official `qx`. */
const QX = 0;
/** The official `qy`. */
const QY = 1;
/** The official `d`: the damping of one step, or -1 while it is not computed. */
const DAMP = 2;
/** The official `a`: the seconds that are left after the steps of this update. */
const LEFT = 3;
/** Scratch offset: the official `ca`, the angle of the x axis of the bone before the constraint turns it. */
export const ANGLE = 4;
/** The official `c`: the cosine of the angle the simulation has turned the bone to. */
const COS = 5;
/** The official `s`: the sine of that angle. */
const SIN = 6;
/** Scratch offset: the official `mr`, how far the bone follows the rotation of the simulation. */
export const TURN = 7;
/** Scratch offset: the length of the bone in the world before the constraint stretches it. */
export const REACH = 8;

/**
 * The part of the official update that moves the bone: the offsets follow the bone with inertia,
 * then the steps of the simulation pull them back. Writes `LEFT`, and `DAMP` when a step ran.
 */
function move(solver: Solver, s: number, k: number, w: number, x: boolean, y: boolean): void {
    const { pose, physics: state, rig } = solver;
    const data = rig.plan.physicsData;
    const world = pose.world;
    const i = Number(state[s + INERTIA]);
    const t = Number(data[k + PHYSICS_STEP]);
    const mix = Number(state[s + MIX]);
    let a = Number(state[s + REMAINING]);
    let xOffset = Number(state[s + X_OFFSET]);
    let yOffset = Number(state[s + Y_OFFSET]);

    if (x) {
        const qx = Number(q[QX]);
        const bx = Number(world[w + 4]);
        const u = (Number(state[s + UX]) - bx) * i;

        xOffset += u > qx ? qx : u < -qx ? -qx : u;
        state[s + UX] = bx;
    }
    if (y) {
        const qy = Number(q[QY]);
        const by = Number(world[w + 5]);
        const u = (Number(state[s + UY]) - by) * i;

        yOffset += u > qy ? qy : u < -qy ? -qy : u;
        state[s + UY] = by;
    }
    if (a >= t) {
        // biome-ignore lint/style/useExponentiationOperator: the official code calls Math.pow
        const d = Math.pow(Number(state[s + DAMPING]), 60 * t);
        const m = Number(state[s + MASS_INVERSE]) * t;
        const e = Number(state[s + STRENGTH]);
        const f = rig.model.referenceScale;
        const wind = Number(state[s + WIND]) * f * pose.scaleX;
        const g = Number(state[s + GRAVITY]) * f * pose.scaleY;
        let xVelocity = Number(state[s + X_VELOCITY]);
        let yVelocity = Number(state[s + Y_VELOCITY]);

        do {
            if (x) {
                xVelocity += (wind - xOffset * e) * m;
                xOffset += xVelocity * t;
                xVelocity *= d;
            }
            if (y) {
                yVelocity -= (g + yOffset * e) * m;
                yOffset += yVelocity * t;
                yVelocity *= d;
            }
            a -= t;
        } while (a >= t);
        state[s + X_VELOCITY] = xVelocity;
        state[s + Y_VELOCITY] = yVelocity;
        q[DAMP] = d;
    }
    state[s + X_OFFSET] = xOffset;
    state[s + Y_OFFSET] = yOffset;
    q[LEFT] = a;
    if (x) world[w + 4] = Number(world[w + 4]) + xOffset * mix * Number(data[k + PHYSICS_X]);
    if (y) world[w + 5] = Number(world[w + 5]) + yOffset * mix * Number(data[k + PHYSICS_Y]);
}

/**
 * The start of the part of the official update that turns and stretches the bone: the rotation
 * and the scale offset follow the movement of the bone with inertia. Writes `ANGLE`, `COS`, `SIN`
 * and `TURN`.
 */
function follow(solver: Solver, s: number, k: number, w: number, turn: boolean, stretch: boolean): void {
    const { pose, physics: state, rig } = solver;
    const data = rig.plan.physicsData;
    const world = pose.world;
    const i = Number(state[s + INERTIA]);
    const qx = Number(q[QX]);
    const qy = Number(q[QY]);
    const ba = Number(world[w]);
    const bc = Number(world[w + 2]);
    const ca = Math.atan2(bc, ba);
    let c = 0;
    let sin = 0;
    let mr = 0;
    let dx = Number(state[s + CX]) - Number(world[w + 4]);
    let dy = Number(state[s + CY]) - Number(world[w + 5]);

    if (dx > qx) dx = qx;
    else if (dx < -qx) dx = -qx;
    if (dy > qy) dy = qy;
    else if (dy < -qy) dy = -qy;
    if (turn) {
        mr = (Number(data[k + PHYSICS_ROTATE]) + Number(data[k + PHYSICS_SHEAR_X])) * Number(state[s + MIX]);
        let rotateOffset = Number(state[s + ROTATE_OFFSET]);
        const r = Math.atan2(dy + Number(state[s + TY]), dx + Number(state[s + TX])) - ca - rotateOffset * mr;

        rotateOffset += (r - Math.ceil(r * INV_PI2 - 0.5) * PI2) * i;
        state[s + ROTATE_OFFSET] = rotateOffset;
        const turned = rotateOffset * mr + ca;

        c = Math.cos(turned);
        sin = Math.sin(turned);
    } else {
        c = Math.cos(ca);
        sin = Math.sin(ca);
    }
    if (stretch) {
        // the length of the bone in the world: the official `getWorldScaleX` times its setup length
        const r = Number(data[k + PHYSICS_LENGTH]) * Math.sqrt(ba * ba + bc * bc);

        if (r > 0) state[s + SCALE_OFFSET] = Number(state[s + SCALE_OFFSET]) + ((dx * c + dy * sin) * i) / r;
        q[REACH] = r;
    }
    q[ANGLE] = ca;
    q[COS] = c;
    q[SIN] = sin;
    q[TURN] = mr;
}

/**
 * The steps of the simulation that turn and stretch the bone, when at least one step of time has
 * passed. Reads what {@link follow} wrote and `DAMP`. Writes `LEFT`.
 */
function swing(solver: Solver, s: number, k: number, turn: boolean, stretch: boolean): void {
    const { physics: state, rig } = solver;
    const data = rig.plan.physicsData;
    const t = Number(data[k + PHYSICS_STEP]);
    let a = Number(state[s + REMAINING]);

    if (!(a >= t)) {
        q[LEFT] = a;

        return;
    }
    // biome-ignore lint/style/useExponentiationOperator: the official code calls Math.pow
    const d = Number(q[DAMP]) === -1 ? Math.pow(Number(state[s + DAMPING]), 60 * t) : Number(q[DAMP]);
    const m = Number(state[s + MASS_INVERSE]) * t;
    const e = Number(state[s + STRENGTH]);
    const wind = Number(state[s + WIND]);
    const g = solver.pose.yDown ? -Number(state[s + GRAVITY]) : Number(state[s + GRAVITY]);
    const h = Number(data[k + PHYSICS_LENGTH]) / rig.model.referenceScale;
    const ca = Number(q[ANGLE]);
    const mr = Number(q[TURN]);
    let c = Number(q[COS]);
    let sin = Number(q[SIN]);
    let rotateOffset = Number(state[s + ROTATE_OFFSET]);
    let rotateVelocity = Number(state[s + ROTATE_VELOCITY]);
    let scaleOffset = Number(state[s + SCALE_OFFSET]);
    let scaleVelocity = Number(state[s + SCALE_VELOCITY]);

    while (true) {
        a -= t;
        if (stretch) {
            scaleVelocity += (wind * c - g * sin - scaleOffset * e) * m;
            scaleOffset += scaleVelocity * t;
            scaleVelocity *= d;
        }
        if (turn) {
            rotateVelocity -= ((wind * sin + g * c) * h + rotateOffset * e) * m;
            rotateOffset += rotateVelocity * t;
            rotateVelocity *= d;
            if (a < t) break;
            const r = rotateOffset * mr + ca;

            c = Math.cos(r);
            sin = Math.sin(r);
        } else if (a < t) break;
    }
    state[s + ROTATE_OFFSET] = rotateOffset;
    state[s + ROTATE_VELOCITY] = rotateVelocity;
    state[s + SCALE_OFFSET] = scaleOffset;
    state[s + SCALE_VELOCITY] = scaleVelocity;
    q[LEFT] = a;
}

/**
 * The official update for `Physics.update`, and for `Physics.reset` after the reset: advances the
 * simulation by the skeleton time that passed and moves the bone. The first run after a reset
 * only notes where the bone is.
 */
function simulate(solver: Solver, s: number, k: number, w: number): void {
    const { pose, physics: state } = solver;
    const data = solver.rig.plan.physicsData;
    const world = pose.world;
    const time = pose.time;
    const delta = Math.max(time - Number(state[s + LAST_TIME]), 0);
    const remaining = Number(state[s + REMAINING]) + delta;

    state[s + REMAINING] = remaining;
    state[s + LAST_TIME] = time;
    if (Number(state[s + RESET]) !== 0) {
        state[s + RESET] = 0;
        state[s + UX] = Number(world[w + 4]);
        state[s + UY] = Number(world[w + 5]);
    } else {
        const x = Number(data[k + PHYSICS_X]) > 0;
        const y = Number(data[k + PHYSICS_Y]) > 0;
        const turn = Number(data[k + PHYSICS_ROTATE]) > 0 || Number(data[k + PHYSICS_SHEAR_X]) > 0;
        const stretch = Number(data[k + PHYSICS_SCALE_X]) > 0;
        const qx = Number(data[k + PHYSICS_LIMIT]) * delta;

        q[QY] = qx * Math.abs(pose.scaleY);
        q[QX] = qx * Math.abs(pose.scaleX);
        q[DAMP] = -1;
        q[LEFT] = remaining;
        if (x || y) move(solver, s, k, w, x, y);
        if (turn || stretch) {
            follow(solver, s, k, w, turn, stretch);
            swing(solver, s, k, turn, stretch);
        }
        state[s + REMAINING] = Number(q[LEFT]);
    }
    state[s + CX] = Number(world[w + 4]);
    state[s + CY] = Number(world[w + 5]);
}

/** Turns the y axis of a bone by the angle whose sine and cosine are given at `SIN` and `COS`. */
function turnY(world: Float64Array, w: number): void {
    const c = Number(q[COS]);
    const sin = Number(q[SIN]);
    const b = Number(world[w + 1]);
    const d = Number(world[w + 3]);

    world[w + 1] = c * b - sin * d;
    world[w + 3] = sin * b + c * d;
}

/** Turns the x axis of a bone by the angle whose sine and cosine are given at `SIN` and `COS`. */
function turnX(world: Float64Array, w: number): void {
    const c = Number(q[COS]);
    const sin = Number(q[SIN]);
    const a = Number(world[w]);
    const bc = Number(world[w + 2]);

    world[w] = c * a - sin * bc;
    world[w + 2] = sin * a + c * bc;
}

/**
 * The part of the official update that turns the bone by the rotation offset. A constraint with
 * shear turns the x axis further than the y axis.
 */
function applyRotation(solver: Solver, s: number, k: number, w: number): void {
    const { physics: state } = solver;
    const data = solver.rig.plan.physicsData;
    const world = solver.pose.world;
    const rotate = Number(data[k + PHYSICS_ROTATE]);
    const shearX = Number(data[k + PHYSICS_SHEAR_X]);
    let o = Number(state[s + ROTATE_OFFSET]) * Number(state[s + MIX]);

    if (shearX > 0) {
        let r = 0;

        if (rotate > 0) {
            r = o * rotate;
            q[SIN] = Math.sin(r);
            q[COS] = Math.cos(r);
            turnY(world, w);
        }
        r += o * shearX;
        q[SIN] = Math.sin(r);
        q[COS] = Math.cos(r);
        turnX(world, w);
    } else {
        o *= rotate;
        q[SIN] = Math.sin(o);
        q[COS] = Math.cos(o);
        turnX(world, w);
        turnY(world, w);
    }
}

/**
 * The official `PhysicsConstraint.update` in the physics mode of the solver. A constraint without
 * mix and mode `none` change nothing. The other modes write the world transform of the bone.
 *
 * The official code then computes the applied pose of the bone from that transform. Here this
 * happens only when the update order has a reader for it, which the update cache knows.
 */
export function solvePhysics(solver: Solver, constraint: LegacyConstraint): void {
    const { pose, physics: state, rig, mode } = solver;
    const data = rig.plan.physicsData;
    const world = pose.world;
    const s = constraint.physics * PHYSICS_STRIDE;
    const k = constraint.physics * PHYSICS_DATA_STRIDE;
    const bone = constraint.targetBone;
    const w = bone * WORLD_STRIDE;
    const mix = Number(state[s + MIX]);

    if (mix === 0 || mode === PHYSICS_NONE) return;
    if (mode === PHYSICS_POSE) {
        const x = Number(data[k + PHYSICS_X]);
        const y = Number(data[k + PHYSICS_Y]);

        if (x > 0) world[w + 4] = Number(world[w + 4]) + Number(state[s + X_OFFSET]) * mix * x;
        if (y > 0) world[w + 5] = Number(world[w + 5]) + Number(state[s + Y_OFFSET]) * mix * y;
    } else {
        if (mode === PHYSICS_RESET) resetPhysics(pose, state, s);
        simulate(solver, s, k, w);
    }
    if (Number(data[k + PHYSICS_ROTATE]) > 0 || Number(data[k + PHYSICS_SHEAR_X]) > 0) applyRotation(solver, s, k, w);
    if (Number(data[k + PHYSICS_SCALE_X]) > 0) {
        const scale = 1 + Number(state[s + SCALE_OFFSET]) * mix * Number(data[k + PHYSICS_SCALE_X]);

        world[w] = Number(world[w]) * scale;
        world[w + 2] = Number(world[w + 2]) * scale;
    }
    if (mode !== PHYSICS_POSE) {
        const length = Number(data[k + PHYSICS_LENGTH]);

        state[s + TX] = length * Number(world[w]);
        state[s + TY] = length * Number(world[w + 2]);
    }
    if (solver.cache.appliedRead[constraint.index] === 1) {
        updateAppliedTransform(pose, solver.applied, rig.model.bones.parents, bone, rig.v41);
    }
}
