import { MarrowError } from '../../base/errors';
import type { AttachmentData } from '../../model/attachments';
import { forgetDeform } from '../shared/deform-switch';
import type { AttachmentInfo, Pose43, Rig43, Timeline43 } from './types';

/** What the engine knows about an attachment. Throws for an attachment that is not from the model. */
function infoOf(rig: Rig43, attachment: AttachmentData): AttachmentInfo {
    const info = rig.info.get(attachment);

    if (info === undefined) {
        throw new MarrowError(
            'invalid-data',
            `The attachment "${attachment.name}" is not from a skin of the skeleton.`,
            {
                fix: 'Put only attachments of the model into the attachments of a pose.',
            },
        );
    }

    return info;
}

/** True when the bone of a slot is active. Timelines leave the slots of other bones alone. */
function slotActive(pose: Pose43, slot: number): boolean {
    const bone = pose.rig.model.slots.bones[slot] ?? -1;

    return pose.state.active[bone] === 1;
}

/**
 * The official `Skeleton.getAttachment`: the attachment a slot shows for a name, from the active
 * skin first and then from the default skin. Null when neither has it.
 */
export function findAttachment(pose: Pose43, slot: number, name: string): AttachmentData | null {
    return pose.rig.lookup.find(pose.state.skin, slot, name) ?? null;
}

/** The setup attachment of a slot, found like the official `Slot.setupPose` finds it. Null for none. */
export function setupAttachment(pose: Pose43, slot: number): AttachmentData | null {
    const name = pose.rig.model.slots.attachments[slot];

    return name ? findAttachment(pose, slot, name) : null;
}

/**
 * Notes that the color, the attachment, the sequence index or the deform of a slot changed in a
 * pose. When the pose is the one that is drawn, the slot gets the pending version as its stamp.
 * The animated pose of an engine whose sliders animate slots is not drawn. There the slot is
 * marked, and it is stamped when it is carried over to the pose state.
 */
export function stampSlot(pose: Pose43, slot: number): void {
    const { state, solve } = pose;
    const { split } = solve;

    if (pose.colors !== state.colors) {
        if (split !== null) split.touched[slot] = 1;

        return;
    }
    // a slot with a pose of its own no longer holds its animated pose: the next update resets it
    if (split !== null && split.slotPosed[slot] === 1) split.touched[slot] = 1;
    state.version = solve.pending;
    state.slotStamps[slot] = solve.pending;
}

/** Notes that the draw order changed in a pose, like {@link stampSlot} for a slot. */
export function stampDrawOrder(pose: Pose43): void {
    const { state, solve } = pose;

    solve.orderSerial++;
    if (pose.drawOrder !== state.drawOrder) {
        if (solve.split !== null) solve.split.orderTouched = true;

        return;
    }
    state.version = solve.pending;
    state.drawOrderStamp = solve.pending;
}

/**
 * The official `SlotPose.setAttachment`. A new attachment resets the sequence index. The deform
 * is kept only when both attachments have vertices and share their timeline attachment.
 */
export function setSlotAttachment(pose: Pose43, slot: number, attachment: AttachmentData | null): void {
    const current = pose.attachments[slot] ?? null;

    if (current === attachment) return;
    if (attachment === null || current === null || !sharesDeform(pose.rig, attachment, current)) {
        pose.deformLengths[slot] = 0;
        forgetDeform(pose.deformLengths, slot);
    }
    pose.attachments[slot] = attachment;
    pose.sequenceIndices[slot] = -1;
    stampSlot(pose, slot);
}

function sharesDeform(rig: Rig43, a: AttachmentData, b: AttachmentData): boolean {
    const first = infoOf(rig, a);
    const second = infoOf(rig, b);

    return first.vertex && second.vertex && first.timeline === second.timeline;
}

/**
 * The info of the attachment a slot shows, when the slot is active and the timeline attachment of
 * what it shows is the attachment of `timeline`. Null otherwise. Deform and sequence timelines
 * apply to such slots only.
 */
export function followerInfo(pose: Pose43, slot: number, timeline: Timeline43): AttachmentInfo | null {
    if (!slotActive(pose, slot)) return null;
    const shown = pose.attachments[slot];

    if (shown == null) return null;
    // most slots show the attachment of the timeline itself: its info is at hand
    const info = shown === timeline.attachment && timeline.info !== null ? timeline.info : infoOf(pose.rig, shown);

    return info.timeline === timeline.attachment ? info : null;
}

/**
 * The official `Attachment.isTimelineActive`: true when the slot of a deform or sequence timeline,
 * or one of its other slots, shows an attachment the timeline applies to.
 */
export function timelineActive(pose: Pose43, slot: number, timeline: Timeline43, others: Int16Array): boolean {
    if (followerInfo(pose, slot, timeline) !== null) return true;
    for (let i = 0; i < others.length; i++) {
        if (followerInfo(pose, others[i] ?? -1, timeline) !== null) return true;
    }

    return false;
}
