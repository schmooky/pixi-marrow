import type { PoseState } from '../state';
import { type ConstraintPlan, PHYSICS_DATA_STRIDE, PHYSICS_SETUP, PHYSICS_VALUES } from './constraints';
import { DEG_RAD } from './math';

/*
 * What one instance keeps for each physics constraint: the fields of the official
 * `PhysicsConstraint`, in one array. First the values that timelines animate, then the state of
 * the simulation. An offset below is added to the place of the constraint times `PHYSICS_STRIDE`.
 */

/** Numbers per physics constraint in the physics state of an instance. */
export const PHYSICS_STRIDE = 24;
/** Physics state offset: inertia, the first animated value. The others follow it in the order of the setup values. */
export const INERTIA = 0;
/** Physics state offset: strength. */
export const STRENGTH = 1;
/** Physics state offset: damping. */
export const DAMPING = 2;
/** Physics state offset: the inverse of the mass. */
export const MASS_INVERSE = 3;
/** Physics state offset: wind. */
export const WIND = 4;
/** Physics state offset: gravity. */
export const GRAVITY = 5;
/** Physics state offset: mix. */
export const MIX = 6;
/** Physics state offset: 1 while the next simulation starts from the pose of the bone, the official `_reset`. */
export const RESET = 7;
/** Physics state offset: the official `ux`, where the bone was when the offset along x last followed it. `uy` follows it. */
export const UX = 8;
/** Physics state offset: the official `uy`. */
export const UY = 9;
/** Physics state offset: the official `cx`, where the bone was after the last simulation. `cy` follows it. */
export const CX = 10;
/** Physics state offset: the official `cy`. */
export const CY = 11;
/** Physics state offset: the official `tx`, the tip of the bone relative to its origin. `ty` follows it. */
export const TX = 12;
/** Physics state offset: the official `ty`. */
export const TY = 13;
/** Physics state offset: the official `xOffset`. The other offsets and the velocities follow it. */
export const X_OFFSET = 14;
/** Physics state offset: the official `xVelocity`. */
export const X_VELOCITY = 15;
/** Physics state offset: the official `yOffset`. */
export const Y_OFFSET = 16;
/** Physics state offset: the official `yVelocity`. */
export const Y_VELOCITY = 17;
/** Physics state offset: the official `rotateOffset`. */
export const ROTATE_OFFSET = 18;
/** Physics state offset: the official `rotateVelocity`. */
export const ROTATE_VELOCITY = 19;
/** Physics state offset: the official `scaleOffset`. */
export const SCALE_OFFSET = 20;
/** Physics state offset: the official `scaleVelocity`, the last of the offsets and velocities. */
export const SCALE_VELOCITY = 21;
/** Physics state offset: the official `remaining`, the seconds that are not simulated yet. */
export const REMAINING = 22;
/** Physics state offset: the official `lastTime`, the skeleton time of the last simulation. */
export const LAST_TIME = 23;

/** The number of the official `Physics.none`. */
export const PHYSICS_NONE = 0;
/** The number of the official `Physics.reset`. */
export const PHYSICS_RESET = 1;
/** The number of the official `Physics.update`. */
export const PHYSICS_UPDATE = 2;
/** The number of the official `Physics.pose`. */
export const PHYSICS_POSE = 3;

/** The physics state of every instance of a model without physics constraints. It has no bytes. */
const NO_PHYSICS = new Float64Array(0);

/** Sets the animated values of every physics constraint to the setup values: the official `setToSetupPose`. */
export function setPhysicsToSetupPose(plan: ConstraintPlan, state: Float64Array): void {
    const data = plan.physicsData;

    for (let p = 0, n = plan.physics.length; p < n; p++) {
        const k = p * PHYSICS_DATA_STRIDE + PHYSICS_SETUP;

        state.set(data.subarray(k, k + PHYSICS_VALUES), p * PHYSICS_STRIDE);
    }
}

/**
 * The physics state of a new instance, as the official constructor leaves it: the setup values,
 * no movement, and a simulation that starts from the pose of the bone. A model without physics
 * constraints gets an array without bytes.
 */
export function createPhysicsState(plan: ConstraintPlan): Float64Array {
    const count = plan.physics.length;

    if (count === 0) return NO_PHYSICS;
    const state = new Float64Array(count * PHYSICS_STRIDE);

    for (let p = 0; p < count; p++) state[p * PHYSICS_STRIDE + RESET] = 1;
    setPhysicsToSetupPose(plan, state);

    return state;
}

/**
 * The official `PhysicsConstraint.reset` for the constraint whose state starts at `s`: no offsets,
 * no velocities, and the next simulation starts from the pose of the bone at the skeleton time.
 */
export function resetPhysics(pose: PoseState, state: Float64Array, s: number): void {
    state[s + REMAINING] = 0;
    state[s + LAST_TIME] = pose.time;
    state[s + RESET] = 1;
    state.fill(0, s + X_OFFSET, s + SCALE_VELOCITY + 1);
}

/** The official `Skeleton.physicsTranslate`: every physics constraint sees its bone moved by `x`, `y`. */
export function translatePhysics(state: Float64Array, x: number, y: number): void {
    for (let s = 0; s < state.length; s += PHYSICS_STRIDE) {
        state[s + UX] = Number(state[s + UX]) - x;
        state[s + UY] = Number(state[s + UY]) - y;
        state[s + CX] = Number(state[s + CX]) - x;
        state[s + CY] = Number(state[s + CY]) - y;
    }
}

/**
 * The official `Skeleton.physicsRotate`: every physics constraint sees its bone turned by
 * `degrees` around the point `x`, `y`.
 */
export function rotatePhysics(state: Float64Array, x: number, y: number, degrees: number): void {
    const r = degrees * DEG_RAD;
    const cos = Math.cos(r);
    const sin = Math.sin(r);

    for (let s = 0; s < state.length; s += PHYSICS_STRIDE) {
        const dx = Number(state[s + CX]) - x;
        const dy = Number(state[s + CY]) - y;
        const tx = dx * cos - dy * sin - dx;
        const ty = dx * sin + dy * cos - dy;

        state[s + UX] = Number(state[s + UX]) - tx;
        state[s + UY] = Number(state[s + UY]) - ty;
        state[s + CX] = Number(state[s + CX]) - tx;
        state[s + CY] = Number(state[s + CY]) - ty;
    }
}
