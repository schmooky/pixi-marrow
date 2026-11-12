import {
    K_ATTACHMENT,
    K_DEFORM,
    K_DRAW_ORDER,
    K_EVENT,
    K_INHERIT,
    K_PHYSICS_RESET,
    K_SEQUENCE,
    type LegacyTimeline,
} from './timelines';

/*
 * A timeline that holds one value gives the same result at every time from its first key on. An
 * animation made of such timelines is a pose: once it is applied, applying it again changes
 * nothing, however far its time has moved. rest.ts uses that.
 */

/** The curve type of a key that interpolates in a straight line. */
const LINEAR = 0;
/** The curve type of a key that holds its value. */
const STEPPED = 1;

/**
 * True when every key of a timeline that interpolates holds the values of the first key, so
 * that every time from the first key on gives those values, to the bit.
 *
 * The keys must come at rising times, with straight or stepped curves and a stepped last key.
 * The values must be numbers and none a negative zero: between two keys the official code adds a
 * positive zero to the value, which a negative zero does not survive.
 */
function holdsOneValue(timeline: LegacyTimeline): boolean {
    const { frames, curves, entries, kind } = timeline;
    const keys = frames.length / entries;
    // the inherit timeline does not interpolate and has no curves
    const curved = kind !== K_INHERIT;

    for (let key = 0; key < keys; key++) {
        const at = key * entries;
        const curve = Number(curves[key]);

        if (key > 0 && !(Number(frames[at]) > Number(frames[at - entries]))) return false;
        if (curved && curve !== STEPPED && (curve !== LINEAR || key === keys - 1)) return false;
        for (let v = 1; v < entries; v++) {
            const value = Number(frames[at + v]);

            if (!Number.isFinite(value) || Object.is(value, -0) || value !== Number(frames[v])) return false;
        }
    }

    return keys >= 1;
}

/**
 * True when a timeline gives the same result at every time from its first key on. A timeline
 * that fires events, counts a sequence or resets physics never does.
 */
export function timelineIsStill(timeline: LegacyTimeline): boolean {
    const { kind, frames } = timeline;

    if (kind === K_EVENT || kind === K_SEQUENCE || kind === K_PHYSICS_RESET) return false;
    // one key: the deform and the draw order are those of that key at any time after it
    if (kind === K_DEFORM || kind === K_DRAW_ORDER) return frames.length === 1;
    if (kind === K_ATTACHMENT) return timeline.attachmentNames.every((name) => name === timeline.attachmentNames[0]);

    return holdsOneValue(timeline);
}
