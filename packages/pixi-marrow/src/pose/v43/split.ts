import type { AttachmentData } from '../../model/attachments';
import type { SlotStore, Split43 } from './slider-types';
import type { Pose43 } from './types';

/*
 * What an engine with sliders does to keep two poses. The player writes the animated pose and a
 * slider applies its animation to the applied pose: the official `pose` and `appliedPose`.
 *
 * Bones and constraints have their applied pose in the constraint state. It is the animated pose
 * again at the start of every update. Slots and the draw order have their applied pose in
 * `PoseState`, because that is what is drawn. Where a slider animates them, their animated pose
 * is in arrays of its own, and the functions here carry it over as the official runtime does:
 *
 * - A slot with a pose of its own, the official constrained pose, gets its animated pose at the
 *   start of every update and keeps what it has in between, also after a setup pose call.
 * - A slot without one has one pose. `PoseState` follows the animated arrays after every call
 *   that writes them.
 * - A slot shows the constrained pose it had last when a slider gives it one again.
 */

/** Makes the deform of slot `j` of `to` the deform of slot `i` of `from`, in an array of its own. */
function copyDeform(from: SlotStore, i: number, to: SlotStore, j: number): void {
    const length = from.deformLengths[i] ?? 0;
    const source = from.deform[i];
    let target = to.deform[j];

    to.deformLengths[j] = length;
    if (length === 0 || source === undefined) return;
    if (target === undefined || target.length < length || target === source) {
        target = new Float64Array(length);
        to.deform[j] = target;
    }
    for (let k = 0; k < length; k++) target[k] = Number(source[k]);
}

/**
 * The official `SlotPose.set`: gives slot `j` of `to` the pose of slot `i` of `from`.
 *
 * @param share True for a slot that no slider animates: both poses use one deform array.
 */
function copySlot(from: SlotStore, i: number, to: SlotStore, j: number, share: boolean): void {
    const fc = i * 4;
    const tc = j * 4;
    const fd = i * 3;
    const td = j * 3;

    to.colors[tc] = Number(from.colors[fc]);
    to.colors[tc + 1] = Number(from.colors[fc + 1]);
    to.colors[tc + 2] = Number(from.colors[fc + 2]);
    to.colors[tc + 3] = Number(from.colors[fc + 3]);
    to.darkColors[td] = Number(from.darkColors[fd]);
    to.darkColors[td + 1] = Number(from.darkColors[fd + 1]);
    to.darkColors[td + 2] = Number(from.darkColors[fd + 2]);
    to.attachments[j] = from.attachments[i] ?? null;
    to.sequenceIndices[j] = from.sequenceIndices[i] ?? 0;
    if (share) {
        const deform = from.deform[i];

        if (deform !== undefined) to.deform[j] = deform;
        to.deformLengths[j] = from.deformLengths[i] ?? 0;
    } else copyDeform(from, i, to, j);
}

/**
 * The start of the official `updateWorldTransform`, for an engine with sliders: every applied
 * pose becomes the animated pose again. The official code resets the constrained poses. The
 * others are the animated pose itself, so they are carried over too.
 */
export function resetApplied(pose: Pose43): void {
    const { state, solve } = pose;
    const ordinals = pose.rig.solver.sliders?.ordinals;

    if (solve.applied !== solve.values) solve.applied.set(solve.values);
    if (solve.inherit !== state.inherit) solve.inherit.set(state.inherit);
    if (pose.drawOrder !== state.drawOrder) state.drawOrder.set(pose.drawOrder);
    if (pose.colors === state.colors || ordinals === undefined) return;
    state.colors.set(pose.colors);
    state.darkColors.set(pose.darkColors);
    state.sequenceIndices.set(pose.sequenceIndices);
    state.deformLengths.set(pose.deformLengths);
    for (let slot = 0; slot < ordinals.length; slot++) {
        const attachment = pose.attachments[slot] ?? null;
        const deform = pose.deform[slot];

        // most slots keep what they have: a write to a list of objects is not free
        if (state.attachments[slot] !== attachment) state.attachments[slot] = attachment;
        if (Number(ordinals[slot]) >= 0) {
            if (Number(pose.deformLengths[slot]) > 0) copyDeform(pose, slot, state, slot);
        } else if (deform !== undefined && state.deform[slot] !== deform) state.deform[slot] = deform;
    }
}

/**
 * The end of an update, for an engine with sliders. A deform or sequence timeline of a slider
 * also writes the slots that follow its attachment from other slots. `Slider.sort` gives those no
 * pose of their own, so the slider wrote their one pose: the animated pose keeps it.
 */
export function keepLeaks(pose: Pose43): void {
    const { state, solve } = pose;
    const sliders = pose.rig.solver.sliders;
    const split = solve.split;

    if (sliders === null || split === null || pose.colors === state.colors) return;
    const { leaks, ordinals } = sliders;

    for (let i = 0; i < leaks.length; i++) {
        const slot = Number(leaks[i]);

        if (split.slotPosed[slot] === 0) copySlot(state, slot, pose, slot, Number(ordinals[slot]) < 0);
    }
}

/**
 * Carries the animated pose over to `PoseState` for what has one pose only: every slot without a
 * pose of its own, and the draw order unless a slider has given it one. Call it after the
 * animated pose was written outside an update, as a setup pose call does.
 */
export function showUnposed(pose: Pose43): void {
    const { state } = pose;
    const { split } = pose.solve;
    const sliders = pose.rig.solver.sliders;

    if (split === null || sliders === null) return;
    if (pose.drawOrder !== state.drawOrder && !split.drawOrderPosed) state.drawOrder.set(pose.drawOrder);
    if (pose.colors === state.colors) return;
    const { ordinals } = sliders;

    for (let slot = 0; slot < ordinals.length; slot++) {
        if (split.slotPosed[slot] === 0) copySlot(pose, slot, state, slot, Number(ordinals[slot]) < 0);
    }
}

/**
 * The start of the official `updateCache`, for an engine with sliders: nothing has a pose of its
 * own until a slider gives it one. Returns whether the draw order had one.
 */
export function beginPosed(pose: Pose43): boolean {
    const { split } = pose.solve;
    const sliders = pose.rig.solver.sliders;

    if (split === null || sliders === null) return false;
    const had = split.drawOrderPosed;

    sliders.previous.set(split.slotPosed);
    split.slotPosed.fill(0);
    split.drawOrderPosed = false;

    return had;
}

/**
 * Room for the official constrained pose of `count` slots, each as a new official `SlotPose`
 * holds it: a white color, a dark color of zeros, no attachment and no deform.
 */
function dormantSlots(count: number): SlotStore {
    return {
        colors: new Float64Array(count * 4).fill(1),
        darkColors: new Float64Array(count * 3),
        attachments: new Array<AttachmentData | null>(count).fill(null),
        sequenceIndices: new Int32Array(count),
        deform: Array.from({ length: count }, () => new Float64Array(0)),
        deformLengths: new Int32Array(count),
    };
}

/**
 * One slot gets or loses its pose of its own. The constrained pose of a slot that lost it is
 * kept. A slot that got one shows the constrained pose it had last.
 */
function switchSlot(pose: Pose43, split: Split43, slot: number, ordinal: number, count: number): void {
    const { state } = pose;

    if (split.slotPosed[slot] === 0) {
        split.dormant ??= dormantSlots(count);
        copySlot(state, slot, split.dormant, ordinal, false);
    } else if (split.dormant !== null) copySlot(split.dormant, ordinal, state, slot, false);
    else {
        // the constrained pose was never used: it is that of a new official SlotPose
        state.colors.fill(1, slot * 4, slot * 4 + 4);
        state.darkColors.fill(0, slot * 3, slot * 3 + 3);
        state.attachments[slot] = null;
        state.sequenceIndices[slot] = 0;
        state.deformLengths[slot] = 0;
    }
}

/**
 * The draw order gets or loses its pose of its own, like a slot. The official constrained draw
 * order is empty until its first update. A pose state cannot hold that, so the draw order stays
 * as it is then.
 */
function switchDrawOrder(pose: Pose43, split: Split43): void {
    const { state } = pose;

    if (!split.drawOrderPosed) {
        split.dormantDrawOrder ??= new Int16Array(state.drawOrder.length);
        split.dormantDrawOrder.set(state.drawOrder);
    } else if (split.dormantDrawOrder !== null) state.drawOrder.set(split.dormantDrawOrder);
}

/**
 * The end of the official `updateCache`, for an engine with sliders: what got or lost a pose of
 * its own changes over. Then what has one pose shows the animated pose.
 *
 * @param hadDrawOrder What `beginPosed` returned.
 */
export function endPosed(pose: Pose43, hadDrawOrder: boolean): void {
    const { split } = pose.solve;
    const sliders = pose.rig.solver.sliders;

    if (split === null || sliders === null) return;
    const { slots, previous } = sliders;

    for (let ordinal = 0; ordinal < slots.length; ordinal++) {
        const slot = Number(slots[ordinal]);

        if (split.slotPosed[slot] !== previous[slot]) switchSlot(pose, split, slot, ordinal, slots.length);
    }
    if (split.drawOrderPosed !== hadDrawOrder && pose.drawOrder !== pose.state.drawOrder) {
        switchDrawOrder(pose, split);
    }
    showUnposed(pose);
}
