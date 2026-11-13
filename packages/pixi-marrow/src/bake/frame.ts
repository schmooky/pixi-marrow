import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import { createAttachmentLookup } from '../pose/shared/lookup';
import { nextVersion, type PoseState } from '../pose/state';
import type { BakedClip } from './clip';
import type { PreparedClip } from './store';

/*
 * Writes one frame of a clip into a pose state. Only values that differ from what the state
 * holds are written, and only those get a stamp, so that a view uploads what changed. This runs
 * in every baked update. It takes indices and allocates nothing.
 */

/** The bones of a frame. Returns true when one changed. */
function writeBones(state: PoseState, clip: BakedClip, frame: number, version: number): boolean {
    const { bones, world } = clip;
    const out = state.world;
    let changed = false;
    let at = frame * bones.length * 6;

    for (let j = 0; j < bones.length; j++, at += 6) {
        const bone = Number(bones[j]);
        const to = bone * 6;

        if (
            out[to] === world[at] &&
            out[to + 1] === world[at + 1] &&
            out[to + 2] === world[at + 2] &&
            out[to + 3] === world[at + 3] &&
            out[to + 4] === world[at + 4] &&
            out[to + 5] === world[at + 5]
        ) {
            continue;
        }
        for (let i = 0; i < 6; i++) out[to + i] = Number(world[at + i]);
        state.boneStamps[bone] = version;
        changed = true;
    }

    return changed;
}

/** The channels of one color group of a frame: `parts` per slot, the ones a mask bit names. Returns true when one changed. */
function writeColors(
    out: Float64Array,
    stamps: Uint32Array,
    slots: Int16Array,
    masks: Uint8Array,
    values: Float32Array,
    parts: number,
    frame: number,
    version: number,
): boolean {
    let changed = false;
    let at = frame * slots.length * parts;

    for (let j = 0; j < slots.length; j++, at += parts) {
        const slot = Number(slots[j]);
        const mask = Number(masks[j]);
        const to = slot * parts;
        let wrote = false;

        for (let part = 0; part < parts; part++) {
            if ((mask & (1 << part)) === 0 || out[to + part] === values[at + part]) continue;
            out[to + part] = Number(values[at + part]);
            wrote = true;
        }
        if (wrote) {
            stamps[slot] = version;
            changed = true;
        }
    }

    return changed;
}

/** What the deform of an attachment belongs to, as the engines tell it, once per attachment. */
const DEFORM_KEYS = new WeakMap<AttachmentData, AttachmentData | null>();

/**
 * The attachment whose deform timelines move an attachment: itself, the mesh a linked mesh names,
 * or null for one without vertices. Two attachments with the same key share a deform.
 */
function deformKey(model: SkeletonModel, attachment: AttachmentData | null): AttachmentData | null {
    if (attachment === null) return null;
    let key = DEFORM_KEYS.get(attachment);

    if (key === undefined) {
        if (attachment.type === 'region' || attachment.type === 'point') key = null;
        else if (attachment.type !== 'mesh' || attachment.timelineAttachment === null) key = attachment;
        else {
            const { skin, slot, name } = attachment.timelineAttachment;

            key = createAttachmentLookup(model).find(skin, slot, name) ?? attachment;
        }
        DEFORM_KEYS.set(attachment, key);
    }

    return key;
}

/**
 * The attachments and sequence indices of a frame. Returns true when one changed. A changed
 * attachment does what the official `Slot.setAttachment` does: it resets the sequence index,
 * and the deform unless both attachments share it. The deforms and sequences of the frame
 * are written after it.
 */
function writeShown(state: PoseState, prepared: PreparedClip, frame: number, version: number): boolean {
    const { clip, attachments: found } = prepared;
    const { attachmentSlots, attachments, attachmentNames, sequenceSlots, sequences } = clip;
    let changed = false;

    for (let j = 0; j < attachmentSlots.length; j++) {
        const slot = Number(attachmentSlots[j]);
        const attachment = found[j * attachmentNames.length + Number(attachments[frame * attachmentSlots.length + j])];

        const shown = state.attachments[slot] ?? null;

        if (attachment === undefined || shown === attachment) continue;
        const key = deformKey(state.model, attachment);

        if (key === null || key !== deformKey(state.model, shown)) state.deformLengths[slot] = 0;
        state.attachments[slot] = attachment;
        state.sequenceIndices[slot] = -1;
        state.slotStamps[slot] = version;
        changed = true;
    }
    for (let j = 0; j < sequenceSlots.length; j++) {
        const slot = Number(sequenceSlots[j]);
        const index = Number(sequences[frame * sequenceSlots.length + j]);

        if (state.sequenceIndices[slot] === index) continue;
        state.sequenceIndices[slot] = index;
        state.slotStamps[slot] = version;
        changed = true;
    }

    return changed;
}

/** The deforms of a frame. A deform that needs more room gets a longer array, as an engine does. Returns true when one changed. */
function writeDeforms(state: PoseState, clip: BakedClip, frame: number, version: number): boolean {
    const { deformSlots, deformStarts, deformLengths, deforms } = clip;
    let changed = false;

    for (let j = 0; j < deformSlots.length; j++) {
        const slot = Number(deformSlots[j]);
        const at = frame * deformSlots.length + j;
        const start = Number(deformStarts[at]);
        const length = Number(deformLengths[at]);
        let out = state.deform[slot] ?? new Float64Array(0);
        let same = state.deformLengths[slot] === length;

        for (let i = 0; same && i < length; i++) same = out[i] === deforms[start + i];
        if (same) continue;
        if (out.length < length) {
            out = new Float64Array(length);
            state.deform[slot] = out;
        }
        for (let i = 0; i < length; i++) out[i] = Number(deforms[start + i]);
        state.deformLengths[slot] = length;
        state.slotStamps[slot] = version;
        changed = true;
    }

    return changed;
}

/** The draw order of a frame. Returns true when it changed. */
function writeDrawOrder(state: PoseState, clip: BakedClip, frame: number, version: number): boolean {
    const { drawOrders, drawOrderFrames } = clip;

    if (drawOrderFrames.length === 0) return false;
    const slots = state.drawOrder.length;
    const from = Number(drawOrderFrames[frame]) * slots;
    let same = true;

    for (let i = 0; same && i < slots; i++) same = state.drawOrder[i] === drawOrders[from + i];
    if (same) return false;
    for (let i = 0; i < slots; i++) state.drawOrder[i] = Number(drawOrders[from + i]);
    state.drawOrderStamp = version;

    return true;
}

/**
 * Writes frame `frame` of a prepared clip into a pose state: the world transforms of the bones
 * that move and the slot values that change. What it writes gets the next version as its stamp,
 * and the state that version. A frame that leaves everything as it was changes no stamp.
 *
 * @example
 * writeFrame(engine.state, prepared, frameAt(prepared.clip, time));
 */
export function writeFrame(state: PoseState, prepared: PreparedClip, frame: number): void {
    const { clip } = prepared;
    const version = nextVersion(state.version);
    const bones = writeBones(state, clip, frame, version);
    const colors = writeColors(
        state.colors,
        state.slotStamps,
        clip.colorSlots,
        clip.colorMasks,
        clip.colors,
        4,
        frame,
        version,
    );
    const darks = writeColors(
        state.darkColors,
        state.slotStamps,
        clip.darkSlots,
        clip.darkMasks,
        clip.darkColors,
        3,
        frame,
        version,
    );
    const shown = writeShown(state, prepared, frame, version);
    const deforms = writeDeforms(state, clip, frame, version);
    const order = writeDrawOrder(state, clip, frame, version);

    if (bones || colors || darks || shown || deforms || order) state.version = version;
}

/**
 * True when a slot whose deform or sequence index a clip keeps shows the attachment the clip
 * shows there in this frame. Those timelines key one attachment, so a slot that shows another
 * one would not follow them.
 */
export function showsClipAttachments(state: PoseState, prepared: PreparedClip, frame: number): boolean {
    const { clip, attachments: found } = prepared;
    const { attachmentSlots, attachments, attachmentNames, deformSlots, sequenceSlots } = clip;

    for (let j = 0; j < attachmentSlots.length; j++) {
        const slot = attachmentSlots[j] ?? -1;

        if (!deformSlots.includes(slot) && !sequenceSlots.includes(slot)) continue;
        const attachment = found[j * attachmentNames.length + Number(attachments[frame * attachmentSlots.length + j])];

        if (state.attachments[slot] !== attachment) return false;
    }

    return true;
}
