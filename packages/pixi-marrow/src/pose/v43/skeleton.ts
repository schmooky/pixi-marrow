import { updateCache } from './cache';
import { setSlotAttachment, setupAttachment } from './slots';
import type { Pose43 } from './types';

/**
 * The official `Skeleton.setupPoseBones`: the local numbers and the inherit mode of every bone,
 * and the pose of every constraint.
 */
export function setupPoseBones(pose: Pose43): void {
    const { bones } = pose.rig.model;

    pose.state.local.set(bones.setup);
    pose.state.inherit.set(bones.inherit);
    pose.solve.values.set(pose.rig.solver.setup);
}

/** The official `Slot.setupPose`: the colors, the sequence index and the attachment of one slot. */
function setupPoseSlot(pose: Pose43, slot: number): void {
    const { state } = pose;
    const { slots } = pose.rig.model;

    for (let i = slot * 4; i < slot * 4 + 4; i++) state.colors[i] = slots.colors[i] ?? 0;
    if (slots.hasDark[slot] === 1) {
        for (let i = slot * 3; i < slot * 3 + 3; i++) state.darkColors[i] = slots.darkColors[i] ?? 0;
    }
    // the sequence index of the official setup pose of a slot is 0. A new attachment makes it -1
    state.sequenceIndices[slot] = 0;
    if (slots.attachments[slot]) {
        // the official code forgets the attachment here without a look at the deform
        state.attachments[slot] = null;
    }
    setSlotAttachment(pose, slot, setupAttachment(pose, slot));
}

/** The official `Skeleton.setupPoseSlots`: the draw order and every slot. */
export function setupPoseSlots(pose: Pose43): void {
    const { drawOrder } = pose.state;

    for (let i = 0; i < drawOrder.length; i++) drawOrder[i] = i;
    for (let slot = 0; slot < pose.rig.model.slots.count; slot++) setupPoseSlot(pose, slot);
}

/** The official `Skin.attachAll`: slots that show an attachment of the old skin show that of the new skin. */
function attachAll(pose: Pose43, newSkin: number, oldSkin: number): void {
    const { state, rig } = pose;
    let done = -1;

    for (const entry of rig.model.skins[oldSkin]?.attachments ?? []) {
        if (entry.slot === done || state.attachments[entry.slot] !== entry.attachment) continue;
        const attachment = rig.lookup.get(newSkin, entry.slot, entry.name);

        if (attachment) setSlotAttachment(pose, entry.slot, attachment);
        done = entry.slot;
    }
}

/**
 * The official `Skeleton.setSkin`. With no skin active before, slots take their setup attachment
 * from the new skin when it has one. Otherwise slots that show an attachment of the old skin
 * change to the one the new skin has under the same name.
 *
 * @param skin The index of the skin, or -1 for none.
 */
export function setSkin(pose: Pose43, skin: number): void {
    const { state, rig } = pose;

    if (skin === state.skin) return;
    if (skin !== -1 && state.skin !== -1) {
        attachAll(pose, skin, state.skin);
    } else if (skin !== -1) {
        rig.model.slots.attachments.forEach((name, slot) => {
            const attachment = name ? rig.lookup.get(skin, slot, name) : undefined;

            if (attachment) setSlotAttachment(pose, slot, attachment);
        });
    }
    state.skin = skin;
    updateCache(pose);
}
