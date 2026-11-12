import { WORLD_STRIDE } from '../state';
import { PHYSICS_LAST_TIME, PHYSICS_REMAINING, stepPhysics } from './physics';
import {
    PHYSICS_MIX,
    PHYSICS_NONE,
    PHYSICS_RESET,
    PHYSICS_STATE,
    PHYSICS_UPDATE,
    type PhysicsPlan,
} from './solver-types';
import type { Pose43 } from './types';

/*
 * Physics that rest. A physics constraint keeps a state, so an update with the same inputs can
 * still change it. It rests when one more update provably changes nothing but its clock, with
 * any time step. Then an update that has nothing else to do can leave it out and only move the
 * clock on.
 *
 * The proof is a trial with the real code. An update first lets the bone lag by how far it was
 * moved, then runs the spring for a number of fixed steps that depends on the time step. The
 * trial runs the update twice from the state the constraint has, on the bone as the constraint
 * found it. The first run has a time step and no fixed step, the second has one fixed step. When
 * both leave every number of the state and the bone as they are, the lag part changes nothing and
 * one fixed step changes nothing. So any number of fixed steps changes nothing, and the lags are
 * zero, which makes the result the same for any time step.
 *
 * The official physics rarely gets there once it has moved: its velocities keep falling toward
 * zero for minutes. It rests when nothing ever moved it, or in the modes that keep no state.
 */

/** True when an update runs the constraint: it is active, it has a mix and the mode is not `none`. */
function runs(pose: Pose43, plan: PhysicsPlan): boolean {
    const { solve } = pose;

    return (
        solve.physicsMode !== PHYSICS_NONE &&
        solve.active[plan.index] === 1 &&
        Number(solve.applied[plan.at + PHYSICS_MIX]) !== 0
    );
}

/**
 * One trial update of a constraint from its kept state, on the bone as the constraint found it.
 * With `step` it runs one fixed step and no time passes. Without, a second passes and no fixed
 * step runs. Returns true when the state and the bone came out as they were kept.
 */
function trial(pose: Pose43, plan: PhysicsPlan, step: boolean): boolean {
    const { state, solve } = pose;
    const { world } = state;
    const s = solve.physics;
    const { seen, kept } = pose.rig.solver.scratch;
    const o = plan.state;
    const b = plan.bone * WORLD_STRIDE;
    const k = (o / PHYSICS_STATE) * WORLD_STRIDE;

    for (let i = 0; i < PHYSICS_STATE; i++) s[o + i] = Number(kept[i]);
    for (let i = 0; i < WORLD_STRIDE; i++) world[b + i] = Number(seen[k + i]);
    s[o + PHYSICS_REMAINING] = step ? plan.step : -1;
    s[o + PHYSICS_LAST_TIME] = step ? state.time : state.time - 1;
    stepPhysics(pose, plan);
    // every number before the clock: the official fields from `_reset` to `scaleVelocity`
    for (let i = 0; i < PHYSICS_REMAINING; i++) if (!Object.is(s[o + i], kept[i])) return false;
    for (let i = 0; i < WORLD_STRIDE; i++) if (!Object.is(world[b + i], kept[PHYSICS_STATE + i])) return false;

    return true;
}

/** True when one more update of a constraint changes nothing but its clock. The state and the bone stay as they are. */
function rests(pose: Pose43, plan: PhysicsPlan): boolean {
    const { world } = pose.state;
    const s = pose.solve.physics;
    const { kept } = pose.rig.solver.scratch;
    const o = plan.state;
    const b = plan.bone * WORLD_STRIDE;

    for (let i = 0; i < PHYSICS_STATE; i++) kept[i] = Number(s[o + i]);
    for (let i = 0; i < WORLD_STRIDE; i++) kept[PHYSICS_STATE + i] = Number(world[b + i]);
    const still = trial(pose, plan, false) && trial(pose, plan, true);

    for (let i = 0; i < PHYSICS_STATE; i++) s[o + i] = Number(kept[i]);
    for (let i = 0; i < WORLD_STRIDE; i++) world[b + i] = Number(kept[PHYSICS_STATE + i]);

    return still;
}

/**
 * True when no physics constraint changes anything while its inputs stay. Call it right after an
 * update that was probed, in which every constraint noted the bone it found.
 */
export function physicsRest(pose: Pose43): boolean {
    for (const plan of pose.rig.solver.physics) if (runs(pose, plan) && !rests(pose, plan)) return false;

    return true;
}

/**
 * What an update does to physics that rest: it moves the clock of every constraint on. The
 * official update adds the time that passed to the time no step has used, and takes whole steps
 * off again. In the mode `reset` it only notes the time.
 */
export function idlePhysics(pose: Pose43): void {
    const { time } = pose.state;
    const s = pose.solve.physics;
    const mode = pose.solve.physicsMode;

    if (mode !== PHYSICS_UPDATE && mode !== PHYSICS_RESET) return;
    for (const plan of pose.rig.solver.physics) {
        if (!runs(pose, plan)) continue;
        const o = plan.state;
        const t = plan.step;
        let a = Number(s[o + PHYSICS_REMAINING]) + Math.max(time - Number(s[o + PHYSICS_LAST_TIME]), 0);

        s[o + PHYSICS_LAST_TIME] = time;
        if (mode === PHYSICS_RESET) continue;
        // a constraint that moves nothing takes no steps: its time only adds up
        if ((plan.x > 0 || plan.y > 0 || plan.rotate > 0 || plan.shearX > 0 || plan.scaleX > 0) && a >= t) {
            do a -= t;
            while (a >= t);
        }
        s[o + PHYSICS_REMAINING] = a;
    }
}
