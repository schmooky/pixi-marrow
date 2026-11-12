import {
    CONSTRAINT_STRIDE,
    IK_BEND,
    IK_COMPRESS,
    IK_MIX,
    IK_STRETCH,
    PATH_MIX,
    PATH_POSITION,
    PATH_SPACING,
    TRANSFORM_MIX,
} from './constraints';
import { ALPHA, leadingCurveValues, SHARED, search, TIME } from './curves';
import { constraintIsActive, noteConstraint, type Solver } from './solver';
import {
    FIRST,
    K_IK,
    K_PATH_MIX,
    K_PATH_POSITION,
    K_PATH_SPACING,
    K_TRANSFORM,
    type LegacyTimeline,
    MIX_IN,
    MIX_OUT,
    SETUP,
} from './timelines';

const IK_ENTRIES = 6;

/**
 * Mixes `count` values of a constraint, from `at` on, toward the keys of a timeline. This is
 * what the official `apply` of every constraint timeline does with the numbers it interpolates,
 * and the official `getAbsoluteValue` of the path position and spacing timelines.
 *
 * Before the first key the values go to the setup values, at once for blend `setup` and by
 * `alpha` for blend `first`. From the first key on they go to the key values by `alpha`, from the
 * setup values for blend `setup` and from the current values otherwise. `scratch` is scratch space.
 * Returns true when a value got other bits than it had.
 */
function mixValues(
    timeline: LegacyTimeline,
    values: Float64Array,
    setup: Float64Array,
    at: number,
    count: number,
    blend: number,
    scratch: Float64Array,
): boolean {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves, entries } = timeline;
    let changed = false;

    if (time < Number(frames[0])) {
        if (blend !== SETUP && blend !== FIRST) return false;
        for (let i = at, n = at + count; i < n; i++) {
            const current = Number(values[i]);
            const start = Number(setup[i]);
            const next = blend === SETUP ? start : current + (start - current) * alpha;

            if (next !== current || (next === 0 && 1 / next !== 1 / current)) changed = true;
            values[i] = next;
        }

        return changed;
    }
    leadingCurveValues(frames, curves, entries, count, scratch);
    for (let i = 0; i < count; i++) {
        const value = Number(scratch[i]);
        const current = Number(values[at + i]);
        const start = blend === SETUP ? Number(setup[at + i]) : current;
        const next = start + (value - start) * alpha;

        if (next !== current || (next === 0 && 1 / next !== 1 / current)) changed = true;
        values[at + i] = next;
    }

    return changed;
}

/**
 * The part of the official `IkConstraintTimeline.apply` that does not interpolate: the bend
 * direction and the compress and stretch flags come from the setup pose or from the key. Returns
 * true when one of them changed.
 */
function applyIkFlags(
    timeline: LegacyTimeline,
    values: Float64Array,
    setup: Float64Array,
    at: number,
    blend: number,
    direction: number,
): boolean {
    const time = Number(SHARED[TIME]);
    const frames = timeline.frames;
    const before = time < Number(frames[0]);
    const fromSetup = before ? blend === SETUP || blend === FIRST : blend === SETUP && direction === MIX_OUT;
    const fromKey = !before && (blend === SETUP ? direction !== MIX_OUT : direction === MIX_IN);
    const bend = Number(values[at + IK_BEND]);
    const compress = Number(values[at + IK_COMPRESS]);
    const stretch = Number(values[at + IK_STRETCH]);

    if (fromSetup) {
        values[at + IK_BEND] = Number(setup[at + IK_BEND]);
        values[at + IK_COMPRESS] = Number(setup[at + IK_COMPRESS]);
        values[at + IK_STRETCH] = Number(setup[at + IK_STRETCH]);
    } else if (fromKey) {
        const i = search(frames, IK_ENTRIES);

        values[at + IK_BEND] = Number(frames[i + 3]);
        values[at + IK_COMPRESS] = Number(frames[i + 4]) !== 0 ? 1 : 0;
        values[at + IK_STRETCH] = Number(frames[i + 5]) !== 0 ? 1 : 0;
    }

    // these three are whole numbers, or not numbers at all, which counts as a change
    return (
        bend !== Number(values[at + IK_BEND]) ||
        compress !== Number(values[at + IK_COMPRESS]) ||
        stretch !== Number(values[at + IK_STRETCH])
    );
}

/**
 * Applies a timeline that animates a constraint: the official `apply` of `IkConstraintTimeline`,
 * `TransformConstraintTimeline`, `PathConstraintPositionTimeline`, `PathConstraintSpacingTimeline`
 * and `PathConstraintMixTimeline`, which are the same in 4.1 and 4.2. A constraint that is not
 * active keeps its values. `scratch` is scratch space for the values of one key. A constraint
 * whose values changed is noted for the world transforms of this update.
 */
export function applyConstraintTimeline(
    solver: Solver,
    timeline: LegacyTimeline,
    blend: number,
    direction: number,
    scratch: Float64Array,
): void {
    const { kind, target } = timeline;
    const { values } = solver;
    const setup = solver.rig.plan.setup;
    const at = target * CONSTRAINT_STRIDE;

    let changed = false;

    if (!constraintIsActive(solver, target)) return;
    if (kind === K_IK) {
        const mixed = mixValues(timeline, values, setup, at + IK_MIX, 2, blend, scratch);

        changed = applyIkFlags(timeline, values, setup, at, blend, direction) || mixed;
    } else if (kind === K_TRANSFORM) {
        changed = mixValues(timeline, values, setup, at + TRANSFORM_MIX, 6, blend, scratch);
    } else if (kind === K_PATH_POSITION) {
        changed = mixValues(timeline, values, setup, at + PATH_POSITION, 1, blend, scratch);
    } else if (kind === K_PATH_SPACING) {
        changed = mixValues(timeline, values, setup, at + PATH_SPACING, 1, blend, scratch);
    } else if (kind === K_PATH_MIX) {
        changed = mixValues(timeline, values, setup, at + PATH_MIX, 3, blend, scratch);
    }
    if (changed) noteConstraint(solver, target);
}
