import type { PoseState } from '../state';
import type { Pose43 } from './types';

/** The pose of every slot: the part of a pose that a slot timeline writes. */
export type SlotStore = Pick<
    PoseState,
    'colors' | 'darkColors' | 'attachments' | 'sequenceIndices' | 'deform' | 'deformLengths'
>;

/**
 * What the sliders of a model need, the same for every engine of the model. A slider applies its
 * animation to the applied pose. So what its timelines animate has two poses in an engine: the
 * animated one and the applied one.
 */
export interface SliderRig43 {
    /**
     * The slots a slider can give a pose of its own: the slot of every slot timeline of the
     * animation of a slider, each once. With one or more, an engine keeps the animated pose of
     * the slots apart from `PoseState`.
     */
    readonly slots: Int16Array;
    /** Per slot: its position in `slots`, or -1. Empty when `slots` is. */
    readonly ordinals: Int16Array;
    /**
     * The other slots that a deform or sequence timeline of a slider writes: the official
     * `timelineSlots`. `Slider.sort` gives them no pose of their own, so a slider can write their
     * animated pose.
     */
    readonly leaks: Int16Array;
    /** True when the animation of a slider has a draw order timeline or a draw order folder timeline. */
    readonly drawOrder: boolean;
    /** True when the animation of a slider has an inherit timeline. */
    readonly inherit: boolean;
    /** True when the animation of a slider animates the pose of a constraint. */
    readonly constraints: boolean;
    /** Which slots had a pose of their own before the update cache was built. No call keeps it across a return. */
    readonly previous: Uint8Array;
}

/**
 * What one engine keeps apart for sliders. The arrays are empty where no slider of the model
 * animates what they are for.
 */
export interface Split43 {
    /**
     * The pose the timelines of a slider write: the applied pose of every bone, slot and
     * constraint and the applied draw order.
     */
    readonly applied: Pose43;
    /** 1 for each slot whose applied pose is its official constrained pose. */
    readonly slotPosed: Uint8Array;
    /**
     * 1 for each slot whose pose in the pose state may not be its animated pose. The player wrote
     * the animated pose, or a slider wrote the pose of its own that the slot has. Such a slot is
     * carried over to the pose state, and stamped, at the start of the next update.
     */
    readonly touched: Uint8Array;
    /** True when the animated draw order changed since it was last carried over to the pose state. */
    orderTouched: boolean;
    /**
     * The official constrained pose of each slot of `SliderRig43.slots` while it is not the
     * applied pose. A slot shows it again when a slider gives it a pose of its own once more.
     * Null until a slot has lost its pose: until then each is that of a new official `SlotPose`.
     */
    dormant: SlotStore | null;
    /** True while the applied draw order is the official constrained draw order. */
    drawOrderPosed: boolean;
    /** The official constrained draw order while it is not the applied one. Null until it was that once. */
    dormantDrawOrder: Int16Array | null;
}
