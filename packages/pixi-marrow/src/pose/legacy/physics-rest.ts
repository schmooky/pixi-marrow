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
import { ANGLE, PHYSICS_SCRATCH, REACH, TURN } from './physics';
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
    PHYSICS_UPDATE,
    REMAINING,
    RESET,
    ROTATE_OFFSET,
    ROTATE_VELOCITY,
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
 * A physics constraint at rest. The official update of a constraint does two things to its state
 * when the bone did not move: the offsets follow the bone, which adds nothing, and the simulation
 * makes steps. When neither changes a bit of the state, no number of steps will: a step is a
 * function of the state and of values that stay. Then the update can be left out, for any time
 * that passed, and only the two numbers that count time go on.
 *
 * Whether a step changes the state is not guessed from the last update, which may have made
 * none, or two that cancel. `physicsRests` makes the follow and one step again on the state as it
 * is, with the official arithmetic, and compares. The comparisons are by bits: a zero that
 * changes its sign is a change.
 */

/** Scratch: the follow and the step are made on these numbers, the state stays as it is. */
const p = new Float64Array(4);
/** The cosine of the angle of the bone after the follow. */
const COS = 0;
/** The sine of that angle. */
const SIN = 1;
/** The official `dx`: how far the bone is from where the simulation left it, which is zero at rest. */
const DX = 2;
/** The official `dy`. */
const DY = 3;

/** True when adding `scratch[add]` to `state[at]` gives other bits than `state[at]` has. */
function adds(state: Float64Array, at: number, scratch: Float64Array, add: number): boolean {
    const now = Number(state[at]);
    const next = now + Number(scratch[add]);

    return next !== now || (next === 0 && 1 / next !== 1 / now);
}

/**
 * One step of a value and its velocity: true when it changes either. `scratch[0]` is the force,
 * `scratch[1]` the mass factor, `scratch[2]` the step and `scratch[3]` the damping. `sign` is 1
 * for the steps that add the force and -1 for those that take it away.
 */
function steps(state: Float64Array, offset: number, velocity: number, scratch: Float64Array, sign: number): boolean {
    const o = Number(state[offset]);
    const v = Number(state[velocity]);
    let next = v;

    if (sign > 0) next += Number(scratch[0]) * Number(scratch[1]);
    else next -= Number(scratch[0]) * Number(scratch[1]);
    const moved = o + next * Number(scratch[2]);

    next *= Number(scratch[3]);

    return moved !== o || (moved === 0 && 1 / moved !== 1 / o) || next !== v || (next === 0 && 1 / next !== 1 / v);
}

/** Scratch of the steps: the force, the mass factor, the step and the damping, then a number to add. */
const f = new Float64Array(5);

/** The part of the rest check for a constraint that moves the bone along x or y. `s` is as in physics.ts. */
function moveRests(solver: Solver, s: number, x: boolean, y: boolean): boolean {
    const { pose, physics: state, rig } = solver;
    const scale = rig.model.referenceScale;
    const i = Number(state[s + INERTIA]);
    const e = Number(state[s + STRENGTH]);

    if (x) {
        // the bone is where the last update saw it, so the offset follows it by nothing
        f[4] = (Number(state[s + UX]) - Number(state[s + UX])) * i;
        if (adds(state, s + X_OFFSET, f, 4)) return false;
        f[0] = Number(state[s + WIND]) * scale * pose.scaleX - Number(state[s + X_OFFSET]) * e;
        if (steps(state, s + X_OFFSET, s + X_VELOCITY, f, 1)) return false;
    }
    if (y) {
        f[4] = (Number(state[s + UY]) - Number(state[s + UY])) * i;
        if (adds(state, s + Y_OFFSET, f, 4)) return false;
        f[0] = Number(state[s + GRAVITY]) * scale * pose.scaleY + Number(state[s + Y_OFFSET]) * e;
        if (steps(state, s + Y_OFFSET, s + Y_VELOCITY, f, -1)) return false;
    }

    return true;
}

/**
 * The follow of the part that turns and stretches the bone, on the state as it is. Writes the
 * cosine and the sine the first step would use. Returns false when the follow changes the state.
 */
function followRests(solver: Solver, s: number, turn: boolean, stretch: boolean): boolean {
    const state = solver.physics;
    const i = Number(state[s + INERTIA]);
    const ca = Number(PHYSICS_SCRATCH[ANGLE]);
    let angle = ca;

    // the bone is where the simulation left it
    p[DX] = Number(state[s + CX]) - Number(state[s + CX]);
    p[DY] = Number(state[s + CY]) - Number(state[s + CY]);
    if (turn) {
        const mr = Number(PHYSICS_SCRATCH[TURN]);
        const rotateOffset = Number(state[s + ROTATE_OFFSET]);
        const r =
            Math.atan2(Number(p[DY]) + Number(state[s + TY]), Number(p[DX]) + Number(state[s + TX])) -
            ca -
            rotateOffset * mr;

        f[4] = (r - Math.ceil(r * INV_PI2 - 0.5) * PI2) * i;
        if (adds(state, s + ROTATE_OFFSET, f, 4)) return false;
        angle = rotateOffset * mr + ca;
    }
    p[COS] = Math.cos(angle);
    p[SIN] = Math.sin(angle);
    if (stretch && Number(PHYSICS_SCRATCH[REACH]) > 0) {
        f[4] = ((Number(p[DX]) * Number(p[COS]) + Number(p[DY]) * Number(p[SIN])) * i) / Number(PHYSICS_SCRATCH[REACH]);
        if (adds(state, s + SCALE_OFFSET, f, 4)) return false;
    }

    return true;
}

/** The part of the rest check for a constraint that turns or stretches the bone. */
function swingRests(solver: Solver, s: number, k: number, turn: boolean, stretch: boolean): boolean {
    const { pose, physics: state, rig } = solver;
    const data = rig.plan.physicsData;
    const e = Number(state[s + STRENGTH]);
    const wind = Number(state[s + WIND]);
    const g = pose.yDown ? -Number(state[s + GRAVITY]) : Number(state[s + GRAVITY]);
    const h = Number(data[k + PHYSICS_LENGTH]) / rig.model.referenceScale;

    if (!followRests(solver, s, turn, stretch)) return false;
    const c = Number(p[COS]);
    const sin = Number(p[SIN]);

    if (stretch) {
        f[0] = wind * c - g * sin - Number(state[s + SCALE_OFFSET]) * e;
        if (steps(state, s + SCALE_OFFSET, s + SCALE_VELOCITY, f, 1)) return false;
    }
    if (turn) {
        f[0] = (wind * sin + g * c) * h + Number(state[s + ROTATE_OFFSET]) * e;
        if (steps(state, s + ROTATE_OFFSET, s + ROTATE_VELOCITY, f, -1)) return false;
    }

    return true;
}

/**
 * True when the next update of a physics constraint leaves its state and its bone as they are,
 * whatever time passes, as long as nothing the constraint reads changes. The constraint has run
 * in this pass. `wasReset` says that the run only noted where the bone is: then the next one is
 * the first that simulates.
 */
function physicsRests(solver: Solver, constraint: LegacyConstraint, wasReset: boolean): boolean {
    const { physics: state, rig } = solver;
    const data = rig.plan.physicsData;
    const s = constraint.physics * PHYSICS_STRIDE;
    const k = constraint.physics * PHYSICS_DATA_STRIDE;
    const x = Number(data[k + PHYSICS_X]) > 0;
    const y = Number(data[k + PHYSICS_Y]) > 0;
    const turn = Number(data[k + PHYSICS_ROTATE]) > 0 || Number(data[k + PHYSICS_SHEAR_X]) > 0;
    const stretch = Number(data[k + PHYSICS_SCALE_X]) > 0;
    const t = Number(data[k + PHYSICS_STEP]);

    // a constraint without mix does nothing, and only the mode `update` moves with time
    if (Number(state[s + MIX]) === 0 || solver.mode !== PHYSICS_UPDATE) return true;
    if (wasReset || !(Number(data[k + PHYSICS_LIMIT]) >= 0)) return false;
    f[1] = Number(state[s + MASS_INVERSE]) * t;
    f[2] = t;
    // biome-ignore lint/style/useExponentiationOperator: the official code calls Math.pow
    f[3] = Math.pow(Number(state[s + DAMPING]), 60 * t);
    if ((x || y) && !moveRests(solver, s, x, y)) return false;

    return !(turn || stretch) || swingRests(solver, s, k, turn, stretch);
}

/** Scratch: what {@link watchPhysics} saw before a constraint ran. First the reset flag, then the four velocities. */
const seen = new Float64Array(5);
/** The four velocities of a constraint, as offsets into its state. */
const VELOCITIES: readonly number[] = [X_VELOCITY, Y_VELOCITY, ROTATE_VELOCITY, SCALE_VELOCITY];

/** Notes the state of a physics constraint before it runs, for {@link physicsStays}. */
export function watchPhysics(solver: Solver, constraint: LegacyConstraint): void {
    const state = solver.physics;
    const s = constraint.physics * PHYSICS_STRIDE;

    seen[0] = Number(state[s + RESET]);
    seen[1] = Number(state[s + X_VELOCITY]);
    seen[2] = Number(state[s + Y_VELOCITY]);
    seen[3] = Number(state[s + ROTATE_VELOCITY]);
    seen[4] = Number(state[s + SCALE_VELOCITY]);
}

/**
 * True when a physics constraint is at rest after its run in this pass: see {@link restPhysics}.
 * A constraint whose run still changed a velocity is not, which costs four comparisons to see.
 * Only one that kept them is looked at in full.
 */
export function physicsStays(solver: Solver, constraint: LegacyConstraint): boolean {
    const state = solver.physics;
    const s = constraint.physics * PHYSICS_STRIDE;

    if (Number(state[s + MIX]) === 0 || solver.mode !== PHYSICS_UPDATE) return true;
    for (let i = 0; i < 4; i++) {
        const now = Number(state[s + Number(VELOCITIES[i])]);
        const before = Number(seen[i + 1]);

        if (now !== before || (now === 0 && 1 / now !== 1 / before)) return false;
    }

    return physicsRests(solver, constraint, Number(seen[0]) !== 0);
}

/**
 * What the official update does to a physics constraint at rest: nothing but counting the time.
 * The skeleton time of the update becomes the last time, and the time that passed is used up in
 * whole steps.
 */
export function restPhysics(solver: Solver, constraint: LegacyConstraint): void {
    const { pose, physics: state, rig } = solver;
    const data = rig.plan.physicsData;
    const s = constraint.physics * PHYSICS_STRIDE;
    const k = constraint.physics * PHYSICS_DATA_STRIDE;
    const time = pose.time;

    if (Number(state[s + MIX]) === 0 || solver.mode === PHYSICS_NONE || solver.mode === PHYSICS_POSE) return;
    if (solver.mode === PHYSICS_RESET) {
        // every update of this mode starts the time again, and leaves nothing to simulate
        state[s + LAST_TIME] = time;

        return;
    }
    let a = Number(state[s + REMAINING]) + Math.max(time - Number(state[s + LAST_TIME]), 0);
    const t = Number(data[k + PHYSICS_STEP]);
    // a constraint that moves nothing makes no steps
    const moves =
        Number(data[k + PHYSICS_X]) > 0 ||
        Number(data[k + PHYSICS_Y]) > 0 ||
        Number(data[k + PHYSICS_ROTATE]) > 0 ||
        Number(data[k + PHYSICS_SHEAR_X]) > 0 ||
        Number(data[k + PHYSICS_SCALE_X]) > 0;

    if (moves && a >= t) {
        do {
            a -= t;
        } while (a >= t);
    }
    state[s + REMAINING] = a;
    state[s + LAST_TIME] = time;
}

/** Counts the time of every physics constraint in an update that computes nothing. */
export function restEveryPhysics(solver: Solver): void {
    const physics = solver.cache.groups.physics;
    const constraints = solver.rig.plan.constraints;

    for (let at = 0, n = physics.length; at < n; at++) {
        const constraint = constraints[Number(physics[at])];

        if (constraint !== undefined) restPhysics(solver, constraint);
    }
}
