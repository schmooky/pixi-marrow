import type { TimelineData, TimelineKind } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import type { JsonCurve, JsonCurveKey, JsonValueKey } from './schema';
import { invalid, numberAt, pick, requireList } from './values';

/** The most values a key can hold: a light and a dark color with four numbers each. */
const MAX_VALUES = 8;

/** How the keys of one kind of curve timeline are stored. */
export interface CurveLayout<K extends JsonCurveKey> {
    /** Floats per key in `frames`: the time plus the values. */
    entries: number;
    /** How many of the values can have a Bezier curve. They come first. */
    curved: number;
    /**
     * Writes the values of a key to `out` in double precision, in the order of the official `setFrame`.
     *
     * @param what the timeline, for error messages
     */
    read(key: K, out: Float64Array, what: string): void;
    /**
     * The index of a value that keeps the value of the first key on every key, or nothing.
     * The official 4.1 parser reads one value this way.
     */
    frozen?: number;
}

function handles(curve: JsonCurve, what: string): readonly number[] {
    return requireList(typeof curve === 'string' ? undefined : curve, `A curve of ${what}`);
}

/**
 * Applies the curve of a key to one of its values, like the official `readCurve`.
 *
 * @returns the number of Bezier curves written so far
 */
function readCurve(
    curve: JsonCurve,
    writer: TimelineWriter,
    bezier: number,
    frame: number,
    value: number,
    time1: number,
    time2: number,
    value1: number,
    value2: number,
    what: string,
): number {
    if (curve === 'stepped') {
        writer.setStepped(frame);

        return bezier;
    }
    const list = handles(curve, what);
    const i = value << 2;
    const cx1 = numberAt(list, i, `A curve of ${what}`);
    const cy1 = numberAt(list, i + 1, `A curve of ${what}`);
    const cx2 = numberAt(list, i + 2, `A curve of ${what}`);
    const cy2 = numberAt(list, i + 3, `A curve of ${what}`);

    writer.setBezier(bezier, frame, value, time1, value1, cx1, cy1, cx2, cy2, time2, value2);

    return bezier + 1;
}

/**
 * Applies the curve of a deform key. The curve runs from 0 to 1 between two keys, and the official
 * `DeformTimeline` samples it with its own arithmetic.
 *
 * @returns the number of Bezier curves written so far
 */
export function readDeformCurve(
    curve: JsonCurve,
    writer: TimelineWriter,
    bezier: number,
    frame: number,
    time1: number,
    time2: number,
    what: string,
): number {
    if (curve === 'stepped') {
        writer.setStepped(frame);

        return bezier;
    }
    const list = handles(curve, what);
    const cx1 = numberAt(list, 0, `A curve of ${what}`);
    const cy1 = numberAt(list, 1, `A curve of ${what}`);
    const cx2 = numberAt(list, 2, `A curve of ${what}`);
    const cy2 = numberAt(list, 3, `A curve of ${what}`);

    writer.setDeformBezier(bezier, frame, 0, time1, cx1, cy1, cx2, cy2, time2);

    return bezier + 1;
}

/**
 * Reads the keys of a curve timeline into the official `frames` and `curves` arrays.
 * Follows the loop every official curve timeline reader shares: write a key, then the curve to the next key.
 *
 * @param what the timeline, for error messages
 */
function readCurveKeys<K extends JsonCurveKey>(
    keys: readonly K[],
    layout: CurveLayout<K>,
    what: string,
): TimelineWriter {
    const { entries, curved, frozen } = layout;
    const first = keys[0];

    if (first === undefined) throw invalid(`${what} has no keys.`);
    const writer = new TimelineWriter(keys.length, entries, keys.length * curved);
    let values = new Float64Array(MAX_VALUES);
    let nextValues = new Float64Array(MAX_VALUES);
    let key = first;
    let time = pick(key.time, 0);
    let bezier = 0;

    layout.read(key, values, what);
    for (let frame = 0; ; frame++) {
        const at = frame * entries;
        const next = keys[frame + 1];

        writer.frames[at] = time;
        writer.frames.set(values.subarray(0, entries - 1), at + 1);
        if (!next) {
            writer.shrink(bezier);
            break;
        }
        const time2 = pick(next.time, 0);
        const curve = key.curve;

        layout.read(next, nextValues, what);
        for (let value = 0; curve && value < curved; value++) {
            const value1 = values[value] ?? 0;
            const value2 = nextValues[value] ?? 0;

            bezier = readCurve(curve, writer, bezier, frame, value, time, time2, value1, value2, what);
        }
        if (frozen !== undefined) nextValues[frozen] = values[frozen] ?? 0;
        time = time2;
        [values, nextValues] = [nextValues, values];
        key = next;
    }

    return writer;
}

/**
 * Reads a curve timeline of an animation.
 *
 * @param what the timeline, for error messages
 */
export function readCurveTimeline<K extends JsonCurveKey>(
    kind: TimelineKind,
    target: number,
    keys: readonly K[],
    layout: CurveLayout<K>,
    what: string,
): TimelineData {
    const writer = readCurveKeys(keys, layout, what);

    return { kind, target, frames: writer.frames, curves: writer.curves };
}

/** The layout of a timeline with one value per key, like the official `readTimeline1`. */
export function valueLayout(defaultValue: number): CurveLayout<JsonValueKey> {
    return {
        entries: 2,
        curved: 1,
        read(key, out) {
            out[0] = pick(key.value, defaultValue);
        },
    };
}

/** The layout of a timeline with an x and y pair per key, like the official `readTimeline2`. */
export function pairLayout(defaultValue: number): CurveLayout<JsonValueKey> {
    return {
        entries: 3,
        curved: 2,
        read(key, out) {
            out[0] = pick(key.x, defaultValue);
            out[1] = pick(key.y, defaultValue);
        },
    };
}
