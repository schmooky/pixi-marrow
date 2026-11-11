import type { SlotTable } from '../../model/model';
import type { PoseState } from '../state';
import { curveValues } from './curves';
import { FIRST, type LegacyTimeline, SETUP } from './timelines';

/** The official `Color.clamp` for one channel. */
const clamp = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Moves `count` channels from their current value to `values` by `alpha`. With `fromSetup` the
 * channels start at the setup color. `clamped` is true for the channels the official runtime
 * writes with `Color.set` and `Color.add`, which clamp to 0 and 1.
 */
function mixChannels(
    color: Float64Array,
    setup: Float64Array,
    at: number,
    values: Float64Array,
    from: number,
    count: number,
    alpha: number,
    fromSetup: boolean,
    clamped: boolean,
): void {
    for (let c = 0; c < count; c++) {
        const value = Number(values[from + c]);
        let mixed = value;

        if (alpha !== 1) {
            const start = fromSetup ? Number(setup[at + c]) : Number(color[at + c]);

            mixed = start + (value - start) * alpha;
        }
        color[at + c] = clamped ? clamp(mixed) : mixed;
    }
}

/**
 * Sets `count` channels before the first key of a timeline: the setup color for blend `setup`,
 * a step toward it for blend `first`. The other blends change nothing.
 */
function channelsBeforeFirstKey(
    color: Float64Array,
    setup: Float64Array,
    at: number,
    count: number,
    alpha: number,
    blend: number,
    clamped: boolean,
): void {
    if (blend !== SETUP && blend !== FIRST) return;
    for (let c = 0; c < count; c++) {
        const target = Number(setup[at + c]);

        if (blend === SETUP) {
            color[at + c] = target;
        } else {
            const current = Number(color[at + c]);
            const mixed = current + (target - current) * alpha;

            color[at + c] = clamped ? clamp(mixed) : mixed;
        }
    }
}

/** The rgba timeline: the color of a slot. `values` is scratch space. */
export function applyRgba(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    time: number,
    alpha: number,
    blend: number,
    values: Float64Array,
): void {
    const at = timeline.target * 4;

    if (time < Number(timeline.frames[0])) {
        channelsBeforeFirstKey(pose.colors, slots.colors, at, 4, alpha, blend, true);

        return;
    }
    curveValues(timeline.frames, timeline.curves, time, 5, values);
    mixChannels(pose.colors, slots.colors, at, values, 0, 4, alpha, blend === SETUP, true);
}

/** The rgb timeline: the color of a slot without its alpha. `values` is scratch space. */
export function applyRgb(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    time: number,
    alpha: number,
    blend: number,
    values: Float64Array,
): void {
    const at = timeline.target * 4;

    if (time < Number(timeline.frames[0])) {
        channelsBeforeFirstKey(pose.colors, slots.colors, at, 3, alpha, blend, false);

        return;
    }
    curveValues(timeline.frames, timeline.curves, time, 4, values);
    mixChannels(pose.colors, slots.colors, at, values, 0, 3, alpha, blend === SETUP, false);
}

/** The alpha timeline: the alpha of a slot. */
export function applyAlpha(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    time: number,
    alpha: number,
    blend: number,
    values: Float64Array,
): void {
    const at = timeline.target * 4 + 3;

    if (time < Number(timeline.frames[0])) {
        channelsBeforeFirstKey(pose.colors, slots.colors, at, 1, alpha, blend, false);

        return;
    }
    curveValues(timeline.frames, timeline.curves, time, 2, values);
    mixChannels(pose.colors, slots.colors, at, values, 0, 1, alpha, blend === SETUP, false);
}

/** The rgba2 timeline: the color and the dark color of a slot. `values` is scratch space. */
export function applyRgba2(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    time: number,
    alpha: number,
    blend: number,
    values: Float64Array,
): void {
    const light = timeline.target * 4;
    const dark = timeline.target * 3;

    if (time < Number(timeline.frames[0])) {
        channelsBeforeFirstKey(pose.colors, slots.colors, light, 4, alpha, blend, true);
        channelsBeforeFirstKey(pose.darkColors, slots.darkColors, dark, 3, alpha, blend, false);

        return;
    }
    curveValues(timeline.frames, timeline.curves, time, 8, values);
    mixChannels(pose.colors, slots.colors, light, values, 0, 4, alpha, blend === SETUP, true);
    mixChannels(pose.darkColors, slots.darkColors, dark, values, 4, 3, alpha, blend === SETUP, false);
}

/** The rgb2 timeline: the color without alpha and the dark color of a slot. `values` is scratch space. */
export function applyRgb2(
    timeline: LegacyTimeline,
    pose: PoseState,
    slots: SlotTable,
    time: number,
    alpha: number,
    blend: number,
    values: Float64Array,
): void {
    const light = timeline.target * 4;
    const dark = timeline.target * 3;

    if (time < Number(timeline.frames[0])) {
        channelsBeforeFirstKey(pose.colors, slots.colors, light, 3, alpha, blend, false);
        channelsBeforeFirstKey(pose.darkColors, slots.darkColors, dark, 3, alpha, blend, false);

        return;
    }
    curveValues(timeline.frames, timeline.curves, time, 7, values);
    mixChannels(pose.colors, slots.colors, light, values, 0, 3, alpha, blend === SETUP, false);
    mixChannels(pose.darkColors, slots.darkColors, dark, values, 3, 3, alpha, blend === SETUP, false);
}
