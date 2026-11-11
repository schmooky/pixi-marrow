import { MarrowError } from '../../base/errors';
import type { AttachmentData } from '../../model/attachments';
import { curveValue, f32, f64, sampleKey, search, towardSetup } from './curves';
import { findAttachment, setSlotAttachment, setupAttachment, slotActive } from './slots';
import { CURRENT, FIRST, type Pose43, SETUP, type TimelineKernel } from './types';

/** The official `Color.clamp` for `count` channels. */
function clampChannels(values: Float64Array, index: number, count: number): void {
    for (let i = index; i < index + count; i++) {
        const value = f64(values, i);

        if (value < 0) values[i] = 0;
        else if (value > 1) values[i] = 1;
    }
}

/**
 * Mixes `count` sampled channels into a color, like the official color timelines. At full alpha
 * the sample replaces the color. Otherwise it is mixed from the setup color or from the current
 * color. The result is clamped to the range from 0 to 1.
 */
function mixChannels(
    values: Float64Array,
    setup: Float64Array,
    index: number,
    count: number,
    sample: Float64Array,
    sampleIndex: number,
    alpha: number,
    from: number,
): void {
    for (let k = 0; k < count; k++) {
        let value = f64(sample, sampleIndex + k);

        if (alpha !== 1) {
            const base = from === SETUP ? f64(setup, index + k) : f64(values, index + k);

            value = base + (value - base) * alpha;
        }
        values[index + k] = value < 0 ? 0 : value > 1 ? 1 : value;
    }
}

/**
 * The official rgba, rgb, rgba2 and rgb2 timelines. `offset` is the number of light channels and
 * `dark` says whether the keys hold a dark color after them.
 */
export const applyColor: TimelineKernel = (pose, timeline, _lastTime, time, _events, alpha, from) => {
    const slot = timeline.target;

    if (!slotActive(pose, slot)) return;
    const { colors, darkColors } = pose.state;
    const setup = pose.rig.model.slots;
    const light = slot * 4;
    const dark = slot * 3;
    const count = timeline.offset;

    if (time < f32(timeline.frames, 0)) {
        towardSetup(colors, setup.colors, light, count, from, alpha);
        // a full color is mixed with the official Color.add, which clamps
        if (count === 4 && from === FIRST) clampChannels(colors, light, 4);
        if (timeline.dark) towardSetup(darkColors, setup.darkColors, dark, 3, from, alpha);

        return;
    }
    const sample = pose.rig.scratch.sample;

    sampleKey(timeline, time, sample);
    mixChannels(colors, setup.colors, light, count, sample, 0, alpha, from);
    if (timeline.dark) mixChannels(darkColors, setup.darkColors, dark, 3, sample, count, alpha, from);
};

/** The official alpha timeline: the alpha of a slot color. */
export const applyAlpha: TimelineKernel = (pose, timeline, _lastTime, time, _events, alpha, from) => {
    const slot = timeline.target;

    if (!slotActive(pose, slot)) return;
    const { colors } = pose.state;
    const setup = pose.rig.model.slots.colors;
    const i = slot * 4 + 3;

    if (time < f32(timeline.frames, 0)) {
        towardSetup(colors, setup, i, 1, from, alpha);

        return;
    }
    const sample = pose.rig.scratch.sample;

    sample[0] = curveValue(timeline.frames, timeline.curves, time);
    mixChannels(colors, setup, i, 1, sample, 0, alpha, from);
};

/**
 * Stands in for a two color timeline on a slot that has no dark color. The official runtime
 * fails there with a TypeError. This throws an error that names the slot.
 */
export const applyColorWithoutDark: TimelineKernel = (pose, timeline) => {
    if (!slotActive(pose, timeline.target)) return;
    const name = pose.rig.model.slots.names[timeline.target];

    throw new MarrowError(
        'invalid-data',
        `A ${timeline.kind} timeline animates the slot "${name}", which has no dark color.`,
        {
            fix: 'Turn on the tint black option of the slot in Spine, or remove the timeline, and export again.',
        },
    );
};

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
 * The official `AttachmentTimeline.apply`. The player does not use it: it applies attachment
 * timelines with its own retain rules.
 */
export const applyAttachment: TimelineKernel = (pose, timeline, _lastTime, time, _events, _alpha, from, _add, out) => {
    const slot = timeline.target;

    if (!slotActive(pose, slot)) return;
    if (out || time < f32(timeline.frames, 0)) {
        if (from !== CURRENT) setSlotAttachment(pose, slot, setupAttachment(pose, slot));

        return;
    }
    const name = timeline.names[search(timeline.frames, time, 1)] ?? null;

    // the official timeline treats an empty name like null here
    setSlotAttachment(pose, slot, name ? keyAttachment(pose, slot, name) : null);
};
