import { MarrowError } from '../../base/errors';
import type { AttachmentData } from '../../model/attachments';
import { ALPHA, curveValue, SHARED, sampleValues, search, TIME, towardSetup, VALUES } from './curves';
import { findAttachment, setSlotAttachment, setupAttachment, stampSlot } from './slots';
import { CURRENT, FIRST, type Pose43, SETUP, type Timeline43 } from './types';

/*
 * The timelines that animate the color and the attachment of a slot. Each reads its time and its
 * alpha from `SHARED`, for the reasons given in curves.ts.
 */

/** The official `Color.clamp` for `count` channels. Returns true when it changed one. */
function clampChannels(values: Float64Array, index: number, count: number): boolean {
    let changed = false;

    for (let i = index; i < index + count; i++) {
        const value = Number(values[i]);

        if (!(value < 0 || value > 1)) continue;
        values[i] = value < 0 ? 0 : 1;
        changed = true;
    }

    return changed;
}

/**
 * Mixes `count` sampled channels into a color, like the official color timelines. The channels
 * are read from `SHARED` at `sampleIndex`. At full alpha they replace the color. Otherwise they
 * are mixed from the setup color or from the current color. The result is clamped to the range
 * from 0 to 1. Returns true when a channel is not what it was.
 */
function mixChannels(
    values: Float64Array,
    setup: Float64Array,
    index: number,
    count: number,
    sampleIndex: number,
    from: number,
): boolean {
    const alpha = Number(SHARED[ALPHA]);
    let changed = false;

    for (let k = 0; k < count; k++) {
        const old = Number(values[index + k]);
        let value = Number(SHARED[sampleIndex + k]);

        if (alpha !== 1) {
            const base = from === SETUP ? Number(setup[index + k]) : old;

            value = base + (value - base) * alpha;
        }
        value = value < 0 ? 0 : value > 1 ? 1 : value;
        if (Object.is(value, old)) continue;
        values[index + k] = value;
        changed = true;
    }

    return changed;
}

/**
 * The official rgba, rgb, rgba2 and rgb2 timelines. `offset` is the number of light channels and
 * `dark` says whether the keys hold a dark color after them.
 */
export function applyColor(pose: Pose43, timeline: Timeline43, from: number): void {
    const slot = timeline.target;

    if (pose.state.active[timeline.bone] !== 1) return;
    const { colors, darkColors } = pose;
    const setup = pose.rig.model.slots;
    const light = slot * 4;
    const dark = slot * 3;
    const count = timeline.offset;

    if (Number(SHARED[TIME]) < Number(timeline.frames[0])) {
        let changed = towardSetup(colors, setup.colors, light, count, from);

        // a full color is mixed with the official Color.add, which clamps
        if (count === 4 && from === FIRST && clampChannels(colors, light, 4)) changed = true;
        if (timeline.dark && towardSetup(darkColors, setup.darkColors, dark, 3, from)) changed = true;
        if (changed) stampSlot(pose, slot);

        return;
    }
    sampleValues(timeline, timeline.entries - 1);
    let changed = mixChannels(colors, setup.colors, light, count, VALUES, from);

    if (timeline.dark && mixChannels(darkColors, setup.darkColors, dark, 3, VALUES + count, from)) changed = true;
    if (changed) stampSlot(pose, slot);
}

/** The official alpha timeline: the alpha of a slot color. */
export function applyAlpha(pose: Pose43, timeline: Timeline43, from: number): void {
    if (pose.state.active[timeline.bone] !== 1) return;
    const colors = pose.colors;
    const setup = pose.rig.model.slots.colors;
    const i = timeline.target * 4 + 3;
    const frames = timeline.frames;

    if (Number(SHARED[TIME]) < Number(frames[0])) {
        if (towardSetup(colors, setup, i, 1, from)) stampSlot(pose, timeline.target);

        return;
    }
    curveValue(frames, timeline.curves);
    if (mixChannels(colors, setup, i, 1, VALUES, from)) stampSlot(pose, timeline.target);
}

/**
 * Stands in for a two color timeline on a slot that has no dark color. The official runtime
 * fails there with a TypeError. This throws an error that names the slot.
 */
export function applyColorWithoutDark(pose: Pose43, timeline: Timeline43): void {
    if (pose.state.active[timeline.bone] !== 1) return;
    const name = pose.rig.model.slots.names[timeline.target];

    throw new MarrowError(
        'invalid-data',
        `A ${timeline.kind} timeline animates the slot "${name}", which has no dark color.`,
        {
            fix: 'Turn on the tint black option of the slot in Spine, or remove the timeline, and export again.',
        },
    );
}

/** The attachment a slot shows for the name of an attachment key. Null clears the slot. */
export function keyAttachment(pose: Pose43, slot: number, name: string | null): AttachmentData | null {
    if (name === null) return null;
    if (name === '') {
        const slotName = pose.rig.model.slots.names[slot];

        throw new MarrowError('invalid-data', `The slot "${slotName}" is given an attachment with an empty name.`, {
            fix: 'Name the attachment in Spine and export again.',
        });
    }

    return findAttachment(pose, slot, name);
}

/**
 * The attachment the slot of an attachment timeline shows at key `index`, with the active skin.
 * Null clears the slot. The answer depends on the model and the skin only, so it is looked up
 * once per skin and key, and every engine of the model shares it.
 */
export function shownAttachment(pose: Pose43, timeline: Timeline43, index: number): AttachmentData | null {
    const skin = pose.state.skin + 1;
    let row = timeline.shown[skin];

    if (row === undefined) {
        row = new Array<AttachmentData | null | undefined>(timeline.names.length).fill(undefined);
        timeline.shown[skin] = row;
    }
    let attachment = row[index];

    if (attachment === undefined) {
        attachment = keyAttachment(pose, timeline.target, timeline.names[index] ?? null);
        if (index >= 0 && index < row.length) row[index] = attachment;
    }

    return attachment;
}

/**
 * The official `AttachmentTimeline.apply`. The player does not use it: it applies attachment
 * timelines with its own retain rules.
 */
export function applyAttachment(pose: Pose43, timeline: Timeline43, from: number, out: boolean): void {
    const slot = timeline.target;
    const frames = timeline.frames;

    if (pose.state.active[timeline.bone] !== 1) return;
    if (out || Number(SHARED[TIME]) < Number(frames[0])) {
        if (from !== CURRENT) setSlotAttachment(pose, slot, setupAttachment(pose, slot));

        return;
    }
    const name = timeline.names[search(frames, 1)] ?? null;

    // the official timeline treats an empty name like null here
    setSlotAttachment(pose, slot, name ? keyAttachment(pose, slot, name) : null);
}
