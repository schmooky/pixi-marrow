import type { SlotTable } from '../../model/model';
import type { PoseState } from '../state';
import { ALPHA, curveValues, SHARED, TIME } from './curves';
import { stampSlot } from './stamps';
import { FIRST, type LegacyTimeline, SETUP } from './timelines';

/*
 * A color timeline stamps its slot only when a channel gets other bits than it had. Most color
 * keys hold one value for a long time, and a renderer leaves a slot without a new stamp alone.
 */

/**
 * Moves `count` channels from their current value to `values` by `alpha`. With `fromSetup` the
 * channels start at the setup color. `clamped` is true for the channels the official runtime
 * writes with `Color.set` and `Color.add`, which clamp to 0 and 1. Returns true when a channel changed.
 */
function mixChannels(
    color: Float64Array,
    setup: Float64Array,
    at: number,
    values: Float64Array,
    from: number,
    count: number,
    fromSetup: boolean,
    clamped: boolean,
): boolean {
    const alpha = Number(SHARED[ALPHA]);
    let changed = false;

    for (let c = 0; c < count; c++) {
        const value = Number(values[from + c]);
        const current = Number(color[at + c]);
        let mixed = value;

        if (alpha !== 1) {
            const start = fromSetup ? Number(setup[at + c]) : current;

            mixed = start + (value - start) * alpha;
        }
        // the official Color.clamp
        const next = clamped && mixed < 0 ? 0 : clamped && mixed > 1 ? 1 : mixed;

        if (next !== current || (next === 0 && 1 / next !== 1 / current)) changed = true;
        color[at + c] = next;
    }

    return changed;
}

/**
 * Sets `count` channels before the first key of a timeline: the setup color for blend `setup`,
 * a step toward it for blend `first`. The other blends change nothing. Returns true when a channel changed.
 */
function channelsBeforeFirstKey(
    color: Float64Array,
    setup: Float64Array,
    at: number,
    count: number,
    blend: number,
    clamped: boolean,
): boolean {
    const alpha = Number(SHARED[ALPHA]);
    let changed = false;

    if (blend !== SETUP && blend !== FIRST) return false;
    for (let c = 0; c < count; c++) {
        const target = Number(setup[at + c]);
        const current = Number(color[at + c]);
        let next = target;

        if (blend !== SETUP) {
            const mixed = current + (target - current) * alpha;

            // the official Color.clamp
            next = clamped && mixed < 0 ? 0 : clamped && mixed > 1 ? 1 : mixed;
        }
        if (next !== current || (next === 0 && 1 / next !== 1 / current)) changed = true;
        color[at + c] = next;
    }

    return changed;
}

/** The rgba timeline: the color of a slot. `values` is scratch space. */
export function applyRgba(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    blend: number,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const at = timeline.target * 4;

    if (time < Number(timeline.frames[0])) {
        if (channelsBeforeFirstKey(pose.colors, slots.colors, at, 4, blend, true)) stampSlot(pose, timeline.target);

        return;
    }
    curveValues(timeline.frames, timeline.curves, 5, values);
    if (mixChannels(pose.colors, slots.colors, at, values, 0, 4, blend === SETUP, true))
        stampSlot(pose, timeline.target);
}

/** The rgb timeline: the color of a slot without its alpha. `values` is scratch space. */
export function applyRgb(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    blend: number,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const at = timeline.target * 4;

    if (time < Number(timeline.frames[0])) {
        if (channelsBeforeFirstKey(pose.colors, slots.colors, at, 3, blend, false)) stampSlot(pose, timeline.target);

        return;
    }
    curveValues(timeline.frames, timeline.curves, 4, values);
    if (mixChannels(pose.colors, slots.colors, at, values, 0, 3, blend === SETUP, false))
        stampSlot(pose, timeline.target);
}

/** The alpha timeline: the alpha of a slot. */
export function applyAlpha(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    blend: number,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const at = timeline.target * 4 + 3;

    if (time < Number(timeline.frames[0])) {
        if (channelsBeforeFirstKey(pose.colors, slots.colors, at, 1, blend, false)) stampSlot(pose, timeline.target);

        return;
    }
    curveValues(timeline.frames, timeline.curves, 2, values);
    if (mixChannels(pose.colors, slots.colors, at, values, 0, 1, blend === SETUP, false))
        stampSlot(pose, timeline.target);
}

/** The rgba2 timeline: the color and the dark color of a slot. `values` is scratch space. */
export function applyRgba2(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    blend: number,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const light = timeline.target * 4;
    const dark = timeline.target * 3;

    if (time < Number(timeline.frames[0])) {
        const lit = channelsBeforeFirstKey(pose.colors, slots.colors, light, 4, blend, true);
        const darkened = channelsBeforeFirstKey(pose.darkColors, slots.darkColors, dark, 3, blend, false);

        if (lit || darkened) stampSlot(pose, timeline.target);

        return;
    }
    curveValues(timeline.frames, timeline.curves, 8, values);
    const lit = mixChannels(pose.colors, slots.colors, light, values, 0, 4, blend === SETUP, true);
    const darkened = mixChannels(pose.darkColors, slots.darkColors, dark, values, 4, 3, blend === SETUP, false);

    if (lit || darkened) stampSlot(pose, timeline.target);
}

/** The rgb2 timeline: the color without alpha and the dark color of a slot. `values` is scratch space. */
export function applyRgb2(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    blend: number,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const light = timeline.target * 4;
    const dark = timeline.target * 3;

    if (time < Number(timeline.frames[0])) {
        const lit = channelsBeforeFirstKey(pose.colors, slots.colors, light, 3, blend, false);
        const darkened = channelsBeforeFirstKey(pose.darkColors, slots.darkColors, dark, 3, blend, false);

        if (lit || darkened) stampSlot(pose, timeline.target);

        return;
    }
    curveValues(timeline.frames, timeline.curves, 7, values);
    const lit = mixChannels(pose.colors, slots.colors, light, values, 0, 3, blend === SETUP, false);
    const darkened = mixChannels(pose.darkColors, slots.darkColors, dark, values, 3, 3, blend === SETUP, false);

    if (lit || darkened) stampSlot(pose, timeline.target);
}
