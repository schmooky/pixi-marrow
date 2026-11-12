import type { AttachmentData } from '../../model/attachments';
import { createPoseState, LOCAL_STRIDE, type PoseState, WORLD_STRIDE } from '../state';
import { createPhysicsState } from './physics';
import type { SliderRig43, SlotStore, Split43 } from './slider-types';
import { PHYSICS_UPDATE, type Solve43 } from './solver-types';
import type { Pose43, Rig43 } from './types';

/** One pose of an engine. Every pose is made here, so that all of them have one shape. */
function poseOf(
    rig: Rig43,
    state: PoseState,
    solve: Solve43,
    local: Float64Array,
    inherit: Uint8Array,
    slots: SlotStore,
    drawOrder: Int16Array,
    values: Float64Array,
): Pose43 {
    return {
        rig,
        state,
        solve,
        local,
        inherit,
        colors: slots.colors,
        darkColors: slots.darkColors,
        attachments: slots.attachments,
        sequenceIndices: slots.sequenceIndices,
        deform: slots.deform,
        deformLengths: slots.deformLengths,
        drawOrder,
        values,
    };
}

/**
 * The animated pose of every slot of an engine whose sliders animate slots. A slot that no slider
 * animates shares its deform array with `PoseState`. The other numbers are copied when they change.
 */
function animatedSlots(state: PoseState, sliders: SliderRig43): SlotStore {
    const slots = state.model.slots.count;

    return {
        colors: new Float64Array(slots * 4),
        darkColors: new Float64Array(slots * 3),
        attachments: new Array<AttachmentData | null>(slots).fill(null),
        sequenceIndices: new Int32Array(slots),
        deform: state.deform.map((deform, slot) => ((sliders.ordinals[slot] ?? -1) < 0 ? deform : new Float64Array(0))),
        deformLengths: new Int32Array(slots),
    };
}

/** The constraint state of a new engine: every constraint in its setup pose, and no update order yet. */
function createSolve(rig: Rig43, state: PoseState): Solve43 {
    const { solver } = rig;
    const { sliders } = solver;
    const bones = solver.plans.length > 0 ? rig.model.bones.count : 0;
    const values = Float64Array.from(solver.setup);

    return {
        values,
        applied: sliders?.constraints ? Float64Array.from(values) : values,
        active: new Uint8Array(solver.plans.length),
        local: new Float64Array(bones * LOCAL_STRIDE),
        inherit: sliders?.inherit ? new Uint8Array(rig.model.bones.count) : state.inherit,
        constrained: new Uint8Array(bones),
        spare: new Float64Array(bones * WORLD_STRIDE),
        stamp: 0,
        worldStamps: new Uint8Array(bones),
        localStamps: new Uint8Array(bones),
        cache: new Int32Array(0),
        cacheLength: 0,
        solved: 0,
        physics: createPhysicsState(solver.physics),
        physicsMode: PHYSICS_UPDATE,
        split: null,
    };
}

/** What a new engine keeps apart for the sliders of its model, with the pose the sliders write. */
function createSplit(pose: Pose43, sliders: SliderRig43): Split43 {
    const { state, solve } = pose;
    const slots = state.model.slots.count;

    return {
        applied: poseOf(pose.rig, state, solve, solve.local, solve.inherit, state, state.drawOrder, solve.applied),
        slotPosed: new Uint8Array(sliders.slots.length > 0 ? slots : 0),
        dormant: null,
        drawOrderPosed: false,
        dormantDrawOrder: null,
    };
}

/**
 * Creates the pose of a new engine: its public pose state, its constraint state and the pose its
 * player writes. That pose is the animated one. For a model without sliders its arrays are those
 * of the pose state. For a model with sliders the engine keeps the applied pose apart where a
 * slider animates it. All values are zero, not the setup pose.
 */
export function createPose(rig: Rig43): Pose43 {
    const state = createPoseState(rig.model);
    const solve = createSolve(rig, state);
    const { sliders } = rig.solver;
    const slots = sliders !== null && sliders.slots.length > 0 ? animatedSlots(state, sliders) : state;
    const drawOrder = sliders?.drawOrder ? new Int16Array(state.drawOrder.length) : state.drawOrder;
    const pose = poseOf(rig, state, solve, state.local, state.inherit, slots, drawOrder, solve.values);

    if (sliders !== null) solve.split = createSplit(pose, sliders);

    return pose;
}

/** Adds the arrays of the pose of every slot to a set. */
function addSlots(arrays: Set<ArrayBufferView>, slots: SlotStore): void {
    arrays.add(slots.colors).add(slots.darkColors).add(slots.sequenceIndices).add(slots.deformLengths);
    for (const deform of slots.deform) arrays.add(deform);
}

/**
 * The bytes of the typed arrays an engine holds for its pose: the pose state, the constraint
 * state and what it keeps apart for sliders. An array that two poses share counts once.
 */
export function poseBytes(pose: Pose43): number {
    const { state, solve } = pose;
    const { split } = solve;
    const arrays = new Set<ArrayBufferView>([state.local, state.inherit, state.active, state.world, state.drawOrder]);
    let bytes = 0;

    addSlots(arrays, state);
    addSlots(arrays, pose);
    arrays.add(pose.drawOrder).add(solve.values).add(solve.applied).add(solve.active).add(solve.local);
    arrays.add(solve.inherit).add(solve.constrained).add(solve.spare).add(solve.worldStamps);
    arrays.add(solve.localStamps).add(solve.cache).add(solve.physics);
    if (split !== null) arrays.add(split.slotPosed);
    if (split?.dormant) addSlots(arrays, split.dormant);
    if (split?.dormantDrawOrder) arrays.add(split.dormantDrawOrder);
    for (const array of arrays) bytes += array.byteLength;

    return bytes;
}
