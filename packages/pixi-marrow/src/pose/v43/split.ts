import type { AttachmentData } from '../../model/attachments';
import type { SlotStore, Split43 } from './slider-types';
import type { ShownSlots } from './solver-types';
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

/** True when two stretches of numbers hold the same bits. */
function sameNumbers(a: ArrayLike<number>, at: number, b: ArrayLike<number>, from: number, count: number): boolean {
    for (let i = 0; i < count; i++) if (!Object.is(a[at + i], b[from + i])) return false;

    return true;
}

/** True when slot `i` of `a` and slot `j` of `b` hold the same pose. */
function sameSlot(a: SlotStore, i: number, b: SlotStore, j: number): boolean {
    const length = a.deformLengths[i] ?? 0;

    return (
        a.attachments[i] === b.attachments[j] &&
        a.sequenceIndices[i] === b.sequenceIndices[j] &&
        length === (b.deformLengths[j] ?? 0) &&
        sameNumbers(a.colors, i * 4, b.colors, j * 4, 4) &&
        sameNumbers(a.darkColors, i * 3, b.darkColors, j * 3, 3) &&
        sameNumbers(a.deform[i] ?? [], 0, b.deform[j] ?? [], 0, length)
    );
}

/** Gives a slot and the draw order of the pose state the pending version as their stamp. */
function stampState(pose: Pose43, slot: number): void {
    const { state, solve } = pose;

    state.version = solve.pending;
    if (slot >= 0) state.slotStamps[slot] = solve.pending;
    else {
        state.drawOrderStamp = solve.pending;
        solve.orderSerial++;
    }
}

/** True when the animated draw order is not the draw order of the pose state. */
function orderDiffers(pose: Pose43): boolean {
    const { drawOrder } = pose.state;

    for (let i = 0; i < drawOrder.length; i++) if (drawOrder[i] !== pose.drawOrder[i]) return true;

    return false;
}

/**
 * Carries the animated draw order over to the pose state when the two differ. With a pose of its
 * own the draw order is reset in every update. Without one it follows what the player changed.
 */
function carryOrder(pose: Pose43, split: Split43): void {
    if (pose.drawOrder === pose.state.drawOrder) return;
    if ((split.drawOrderPosed || split.orderTouched) && orderDiffers(pose)) {
        pose.state.drawOrder.set(pose.drawOrder);
        stampState(pose, -1);
    }
    split.orderTouched = false;
}

/**
 * The start of the official `updateWorldTransform`, for an engine with sliders: every applied
 * pose becomes the animated pose again. The official code resets the constrained poses. The
 * others are the animated pose itself, so they follow where the player changed it. A slot or a
 * draw order that is not what it was gets its stamp.
 */
export function resetApplied(pose: Pose43): void {
    const { state, solve } = pose;
    const { split } = solve;
    const sliders = pose.rig.solver.sliders;

    if (split === null || sliders === null) return;
    if (solve.applied !== solve.values) solve.applied.set(solve.values);
    if (solve.inherit !== state.inherit) solve.inherit.set(state.inherit);
    carryOrder(pose, split);
    if (pose.colors === state.colors) return;
    const { ordinals } = sliders;
    const { touched } = split;
    const { pending } = solve;
    let carried = false;

    for (let slot = 0; slot < ordinals.length; slot++) {
        // the player wrote the animated pose, or a slider wrote the pose of its own that the slot has
        if (touched[slot] !== 1) continue;
        touched[slot] = 0;
        copySlot(pose, slot, state, slot, Number(ordinals[slot]) < 0);
        state.slotStamps[slot] = pending;
        carried = true;
    }
    if (carried) state.version = pending;
}

/**
 * The end of an update, for an engine with sliders. A deform or sequence timeline of a slider
 * also writes the slots that follow its attachment from other slots. `Slider.sort` gives those no
 * pose of their own, so the slider wrote their one pose: the animated pose keeps it. Returns true
 * when there is such a slot. Then a slider may have changed the animated pose, and the engine
 * cannot take the next update for one that changes nothing.
 */
export function keepLeaks(pose: Pose43): boolean {
    const { state, solve } = pose;
    const sliders = pose.rig.solver.sliders;
    const split = solve.split;
    let open = false;

    if (sliders === null || split === null || pose.colors === state.colors) return false;
    const { leaks, ordinals } = sliders;

    for (let i = 0; i < leaks.length; i++) {
        const slot = Number(leaks[i]);

        if (split.slotPosed[slot] === 1) continue;
        copySlot(state, slot, pose, slot, Number(ordinals[slot]) < 0);
        open = true;
    }

    return open;
}

/**
 * Carries the animated pose over to `PoseState` for what has one pose only and was changed. That
 * is a slot without a pose of its own, and the draw order unless a slider has given it one. Call
 * it after the animated pose was written outside an update, as a setup pose call does.
 */
export function showUnposed(pose: Pose43): void {
    const { state } = pose;
    const { split } = pose.solve;
    const sliders = pose.rig.solver.sliders;

    if (split === null || sliders === null) return;
    if (!split.drawOrderPosed) carryOrder(pose, split);
    if (pose.colors === state.colors) return;
    const { ordinals } = sliders;
    const { slotPosed, touched } = split;

    for (let slot = 0; slot < ordinals.length; slot++) {
        if (slotPosed[slot] === 1 || touched[slot] !== 1) continue;
        touched[slot] = 0;
        copySlot(pose, slot, state, slot, Number(ordinals[slot]) < 0);
        stampState(pose, slot);
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
        // the slot shows its animated pose from now on
        split.touched[slot] = 1;

        return;
    }
    // the slot shows the pose of its own until the next update resets it
    split.touched[slot] = 1;
    if (split.dormant !== null) copySlot(split.dormant, ordinal, state, slot, false);
    else {
        // the constrained pose was never used: it is that of a new official SlotPose
        state.colors.fill(1, slot * 4, slot * 4 + 4);
        state.darkColors.fill(0, slot * 3, slot * 3 + 3);
        state.attachments[slot] = null;
        state.sequenceIndices[slot] = 0;
        state.deformLengths[slot] = 0;
    }
    stampState(pose, slot);
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
        // the pose state shows the animated draw order from now on
        split.orderTouched = true;
    } else if (split.dormantDrawOrder !== null) {
        state.drawOrder.set(split.dormantDrawOrder);
        stampState(pose, -1);
    }
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

/** Room for a copy of the slots and the draw order of a pose state. */
function createShown(pose: Pose43): ShownSlots {
    const { state } = pose;

    return {
        colors: new Float64Array(state.colors.length),
        darkColors: new Float64Array(state.darkColors.length),
        attachments: new Array<AttachmentData | null>(state.attachments.length).fill(null),
        sequenceIndices: new Int32Array(state.sequenceIndices.length),
        deformLengths: new Int32Array(state.deformLengths.length),
        deform: state.deform.map(() => new Float64Array(0)),
        drawOrder: new Int16Array(state.drawOrder.length),
    };
}

/**
 * Keeps what the pose state holds for its slots and its draw order, before an update that may
 * show that the pose rests. Only an engine with sliders needs it: there an update can write the
 * slots, and their stamps do not tell whether they came out as they were.
 */
export function keepShown(pose: Pose43): void {
    const { state } = pose;
    const { scratch } = pose.rig.solver;

    if (pose.solve.split === null) return;
    scratch.shown ??= createShown(pose);
    const { shown } = scratch;

    shown.colors.set(state.colors);
    shown.darkColors.set(state.darkColors);
    shown.sequenceIndices.set(state.sequenceIndices);
    shown.deformLengths.set(state.deformLengths);
    shown.drawOrder.set(state.drawOrder);
    for (let slot = 0; slot < shown.attachments.length; slot++) {
        const length = state.deformLengths[slot] ?? 0;
        const deform = state.deform[slot];

        shown.attachments[slot] = state.attachments[slot] ?? null;
        if (deform === undefined || length === 0) continue;
        if ((shown.deform[slot]?.length ?? 0) < length) shown.deform[slot] = new Float64Array(length);
        shown.deform[slot]?.set(deform.subarray(0, length));
    }
}

/** True when the slots and the draw order of the pose state are what `keepShown` kept. Always true without sliders. */
export function shownSame(pose: Pose43): boolean {
    const { state } = pose;
    const { shown } = pose.rig.solver.scratch;

    if (pose.solve.split === null || shown === null) return true;
    for (let i = 0; i < state.drawOrder.length; i++) if (state.drawOrder[i] !== shown.drawOrder[i]) return false;
    for (let slot = 0; slot < shown.attachments.length; slot++) if (!sameSlot(state, slot, shown, slot)) return false;

    return true;
}
