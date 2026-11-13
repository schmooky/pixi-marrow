import { WORLD_STRIDE } from '../pose/state';
import type { BakedClip } from './clip';
import type { Recording } from './record';

/** What a clip says about itself besides its frames. */
interface ClipHead {
    animation: string;
    skins: string[];
    fps: number;
    duration: number;
    placement: Float64Array;
}

/** The frames of a recording, from 1 on: index 0 holds the pose before the animation. */
const framesOf = (recording: Recording): number[] => Array.from({ length: recording.frames }, (_, i) => i + 1);

/**
 * Per item: the bits of the parts whose value in some frame differs from the pose before the
 * animation. `parts` numbers per item, `count` items, read from `values` at `stride` per pose.
 */
function changedParts(recording: Recording, values: Float32Array, count: number, parts: number): Uint8Array {
    const masks = new Uint8Array(count);
    const stride = count * parts;

    for (const frame of framesOf(recording)) {
        for (let item = 0; item < count; item++) {
            for (let part = 0; part < parts; part++) {
                const at = item * parts + part;

                if (values[frame * stride + at] !== values[at]) masks[item] = Number(masks[item]) | (1 << part);
            }
        }
    }

    return masks;
}

/** The items whose mask is not 0. */
function changedItems(masks: Uint8Array, keep: (item: number) => boolean = () => true): number[] {
    const items: number[] = [];

    for (let item = 0; item < masks.length; item++) if (masks[item] !== 0 && keep(item)) items.push(item);

    return items;
}

/** The values of the kept items in every frame, `parts` numbers each. */
function framesOfItems(
    recording: Recording,
    values: Float32Array,
    items: readonly number[],
    count: number,
    parts: number,
): Float32Array {
    const out = new Float32Array(recording.frames * items.length * parts);
    let at = 0;

    for (const frame of framesOf(recording)) {
        for (const item of items) {
            const from = (frame * count + item) * parts;

            out.set(values.subarray(from, from + parts), at);
            at += parts;
        }
    }

    return out;
}

/** True when two deforms hold the same numbers. Null is no deform. */
function sameDeform(a: Float32Array | null, b: Float32Array | null): boolean {
    if (a === null || b === null) return a === b;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;

    return true;
}

/** The slots for which some frame differs from the pose before the animation, by `differs`. */
function slotsWhere(recording: Recording, differs: (frame: number, slot: number) => boolean): number[] {
    const slots = recording.model.slots.count;
    const found: number[] = [];

    for (let slot = 0; slot < slots; slot++) {
        if (framesOf(recording).some((frame) => differs(frame * slots + slot, slot))) found.push(slot);
    }

    return found;
}

/** The deforms of the kept slots, with the frames that repeat the frame before sharing its numbers. */
function packDeforms(recording: Recording, deformSlots: readonly number[]) {
    const slots = recording.model.slots.count;
    const starts = new Int32Array(recording.frames * deformSlots.length);
    const lengths = new Int32Array(recording.frames * deformSlots.length);
    const parts: Float32Array[] = [];
    let size = 0;

    deformSlots.forEach((slot, j) => {
        let before: Float32Array | null = null;
        let start = 0;

        for (const frame of framesOf(recording)) {
            const deform = recording.deforms[frame * slots + slot] ?? null;
            const at = (frame - 1) * deformSlots.length + j;

            if (deform !== null && (before === null || !sameDeform(deform, before))) {
                start = size;
                parts.push(deform);
                size += deform.length;
            }
            starts[at] = deform === null ? 0 : start;
            lengths[at] = deform?.length ?? 0;
            before = deform;
        }
    });
    const deforms = new Float32Array(size);
    let at = 0;

    for (const part of parts) {
        deforms.set(part, at);
        at += part.length;
    }

    return { starts, lengths, deforms };
}

/** The draw orders the frames show, each once, and the order of each frame. */
function packDrawOrders(recording: Recording) {
    const slots = recording.model.slots.count;
    const base = recording.drawOrders.subarray(0, slots);
    const moves = framesOf(recording).some((frame) =>
        recording.drawOrders.subarray(frame * slots, (frame + 1) * slots).some((slot, i) => slot !== base[i]),
    );

    if (!moves) return { drawOrders: new Int16Array(0), drawOrderFrames: new Uint16Array(0) };
    const known = new Map<string, number>();
    const orders: Int16Array[] = [];
    const drawOrderFrames = new Uint16Array(recording.frames);

    for (const frame of framesOf(recording)) {
        const order = recording.drawOrders.subarray(frame * slots, (frame + 1) * slots);
        const key = order.join(',');
        let index = known.get(key);

        if (index === undefined) {
            index = orders.length;
            known.set(key, index);
            orders.push(order);
        }
        drawOrderFrames[frame - 1] = index;
    }
    const drawOrders = new Int16Array(orders.length * slots);

    orders.forEach((order, i) => drawOrders.set(order, i * slots));

    return { drawOrders, drawOrderFrames };
}

/** The attachments of the kept slots in every frame, as indices into a table of names. */
function packAttachments(recording: Recording, attachmentSlots: readonly number[]) {
    const slots = recording.model.slots.count;
    const names: (string | null)[] = [];
    const indexOf = new Map<string | null, number>();
    const attachments = new Int16Array(recording.frames * attachmentSlots.length);
    let at = 0;

    for (const frame of framesOf(recording)) {
        for (const slot of attachmentSlots) {
            const attachment = recording.attachments[frame * slots + slot] ?? null;
            const name = attachment === null ? null : (recording.names[slot]?.get(attachment) ?? null);
            let index = indexOf.get(name);

            if (index === undefined) {
                index = names.length;
                indexOf.set(name, index);
                names.push(name);
            }
            attachments[at++] = index;
        }
    }

    return { attachmentNames: names, attachments };
}

/**
 * Keeps of a recording what moves. A bone is kept when its world transform differs from the
 * pose before the animation in some frame. So is a channel of a color, an attachment, a sequence
 * index, a deform or the draw order. A slot whose deform or sequence index is kept
 * keeps its attachment too: those timelines key one attachment, and playback checks it.
 */
export function packClip(recording: Recording, head: ClipHead): BakedClip {
    const { model, frames } = recording;
    const bones = model.bones.count;
    const slots = model.slots.count;
    const boneMasks = changedParts(recording, recording.world, bones, WORLD_STRIDE);
    const keptBones = changedItems(boneMasks, (bone) => recording.active[bone] === 1);
    const colorMasks = changedParts(recording, recording.colors, slots, 4);
    const darkMasks = changedParts(recording, recording.darkColors, slots, 3);
    const colorSlots = changedItems(colorMasks);
    const darkSlots = changedItems(darkMasks, (slot) => model.slots.hasDark[slot] === 1);
    const sequenceSlots = slotsWhere(recording, (at, slot) => recording.sequences[at] !== recording.sequences[slot]);
    const deformSlots = slotsWhere(
        recording,
        (at, slot) => !sameDeform(recording.deforms[at] ?? null, recording.deforms[slot] ?? null),
    );
    const shown = slotsWhere(recording, (at, slot) => recording.attachments[at] !== recording.attachments[slot]);
    const attachmentSlots = [...new Set([...shown, ...deformSlots, ...sequenceSlots])].sort((a, b) => a - b);
    const sequences = new Int32Array(frames * sequenceSlots.length);
    let at = 0;

    for (const frame of framesOf(recording)) {
        for (const slot of sequenceSlots) sequences[at++] = Number(recording.sequences[frame * slots + slot]);
    }
    const deforms = packDeforms(recording, deformSlots);

    return {
        ...head,
        frames,
        hash: model.hash,
        boneCount: bones,
        slotCount: slots,
        bones: Int16Array.from(keptBones),
        world: framesOfItems(recording, recording.world, keptBones, bones, WORLD_STRIDE),
        colorSlots: Int16Array.from(colorSlots),
        colorMasks: Uint8Array.from(colorSlots, (slot) => Number(colorMasks[slot])),
        colors: framesOfItems(recording, recording.colors, colorSlots, slots, 4),
        darkSlots: Int16Array.from(darkSlots),
        darkMasks: Uint8Array.from(darkSlots, (slot) => Number(darkMasks[slot])),
        darkColors: framesOfItems(recording, recording.darkColors, darkSlots, slots, 3),
        attachmentSlots: Int16Array.from(attachmentSlots),
        ...packAttachments(recording, attachmentSlots),
        sequenceSlots: Int16Array.from(sequenceSlots),
        sequences,
        deformSlots: Int16Array.from(deformSlots),
        deformStarts: deforms.starts,
        deformLengths: deforms.lengths,
        deforms: deforms.deforms,
        ...packDrawOrders(recording),
    };
}
