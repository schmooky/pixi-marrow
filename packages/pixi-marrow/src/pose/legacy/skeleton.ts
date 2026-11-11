import { MarrowError } from '../../base/errors';
import type { AttachmentData } from '../../model/attachments';
import type { PoseState } from '../state';
import { factsOf, type Rig } from './rig';

/**
 * The official `Slot.setAttachment`. A changed attachment resets the sequence index. The deform
 * is kept only when the old and the new attachment share their timeline attachment.
 */
export function setSlotAttachment(rig: Rig, pose: PoseState, slot: number, attachment: AttachmentData | null): void {
    const current = pose.attachments[slot] ?? null;

    if (current === attachment) return;
    const next = attachment === null ? null : factsOf(rig, attachment).timeline;
    const last = current === null ? null : factsOf(rig, current).timeline;

    if (next === null || last === null || next !== last) pose.deformLengths[slot] = 0;
    pose.attachments[slot] = attachment;
    pose.sequenceIndices[slot] = -1;
}

/** The attachment a slot shows for a name: the official `Skeleton.getAttachment`. An empty name is none. */
export function findAttachment(rig: Rig, pose: PoseState, slot: number, name: string | null): AttachmentData | null {
    if (name === null || name === '') return null;

    return rig.lookup.find(pose.skin, slot, name) ?? null;
}

/** The official `Skeleton.setBonesToSetupPose`, without constraints. */
export function setBonesToSetupPose(rig: Rig, pose: PoseState): void {
    pose.local.set(rig.model.bones.setup);
    pose.inherit.set(rig.model.bones.inherit);
}

/** The official `Slot.setToSetupPose`. A slot without a setup attachment keeps its deform and sequence index. */
function setSlotToSetupPose(rig: Rig, pose: PoseState, slot: number): void {
    const { colors, darkColors, hasDark, attachments } = rig.model.slots;

    pose.colors.set(colors.subarray(slot * 4, slot * 4 + 4), slot * 4);
    if (hasDark[slot] === 1) pose.darkColors.set(darkColors.subarray(slot * 3, slot * 3 + 3), slot * 3);
    pose.attachments[slot] = null;
    setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, attachments[slot] ?? null));
}

/** The official `Skeleton.setSlotsToSetupPose`: the draw order, then every slot. */
export function setSlotsToSetupPose(rig: Rig, pose: PoseState): void {
    const count = rig.model.slots.count;

    for (let i = 0; i < count; i++) pose.drawOrder[i] = i;
    for (let i = 0; i < count; i++) setSlotToSetupPose(rig, pose, i);
}

/**
 * Marks the bones that are posed, as the official `Skeleton.updateCache` does. A bone that
 * needs a skin is active only while the active skin lists it or one of its descendants.
 */
function updateActiveBones(rig: Rig, pose: PoseState): void {
    const { count, parents, skinRequired } = rig.model.bones;
    const active = pose.active;

    for (let i = 0; i < count; i++) active[i] = skinRequired[i] === 1 ? 0 : 1;
    const skin = rig.model.skins[pose.skin];

    if (skin === undefined) return;
    for (const skinBone of skin.bones) {
        // a parent index is below its bone, so the walk ends at a root
        for (let bone = skinBone; bone >= 0; bone = parents[bone] ?? -1) active[bone] = 1;
    }
}

/** The official `Skin.attachAll`: slots that show an attachment of the old skin get the one the new skin has under that name. */
function attachAll(rig: Rig, pose: PoseState, newSkin: number, oldSkin: number): void {
    const entries = rig.model.skins[oldSkin]?.attachments ?? [];
    let done = -1;

    // entries are sorted by slot. The first match of a slot wins, as in the official loop.
    for (const entry of entries) {
        if (entry.slot === done || pose.attachments[entry.slot] !== entry.attachment) continue;
        done = entry.slot;
        const attachment = rig.lookup.get(newSkin, entry.slot, entry.name);

        if (attachment !== undefined) setSlotAttachment(rig, pose, entry.slot, attachment);
    }
}

/** The official `Skeleton.setSkin`. -1 is no skin. */
export function setSkin(rig: Rig, pose: PoseState, skin: number): void {
    const { skins, slots } = rig.model;

    if (!Number.isInteger(skin) || skin < -1 || skin >= skins.length) {
        throw new MarrowError('invalid-data', `The skeleton has no skin ${skin}. It has ${skins.length} skins.`, {
            fix: 'Pass an index into the skin list of the model, or -1 for no skin.',
        });
    }
    if (skin === pose.skin) return;
    if (skin !== -1) {
        if (pose.skin !== -1) {
            attachAll(rig, pose, skin, pose.skin);
        } else {
            for (let i = 0; i < slots.count; i++) {
                const name = slots.attachments[i] ?? null;
                const attachment = name === null || name === '' ? undefined : rig.lookup.get(skin, i, name);

                if (attachment !== undefined) setSlotAttachment(rig, pose, i, attachment);
            }
        }
    }
    pose.skin = skin;
    updateActiveBones(rig, pose);
}

/** Puts a new pose into the state a new official `Skeleton` is in: setup pose, no skin, no world transforms. */
export function initPose(rig: Rig, pose: PoseState): void {
    pose.sequenceIndices.fill(-1);
    setBonesToSetupPose(rig, pose);
    setSlotsToSetupPose(rig, pose);
    updateActiveBones(rig, pose);
}
