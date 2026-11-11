import type { MarrowError } from '../../base/errors';
import type { TimelineData, TimelineKind } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import { invalid } from './context';
import type { JsonCurve, JsonKey, JsonValueKey } from './schema';

/** Collects the timelines of one animation and tracks its duration. */
export interface TimelineSink {
    /** The animation, as the start of an error sentence. */
    user: string;
    timelines: TimelineData[];
    duration: number;
}

/**
 * Adds a timeline to an animation. The duration grows to the time of the last key, like the
 * official `getDuration`.
 *
 * @param entries floats per key in `frames`
 */
export function addTimeline(sink: TimelineSink, timeline: TimelineData, entries: number): void {
    const last = timeline.frames[timeline.frames.length - entries];

    // the official parser builds such a timeline and ends up with a duration that is not a number
    if (last === undefined) throw invalid(`${sink.user} has a timeline of the type "${timeline.kind}" without keys.`);
    sink.duration = Math.max(sink.duration, last);
    sink.timelines.push(timeline);
}

/** Builds the error for a timeline name this importer does not know. */
export function unknownTimeline(name: string, user: string): MarrowError {
    return invalid(`${user} has a timeline of the unknown type "${name}".`);
}

/** Writes the time of a key and then its values into `out`. */
export type KeyReader<K> = (key: K, out: number[]) => void;

/** One number of a curve. Throws when the curve is too short for the values of its timeline. */
function curveNumber(curve: readonly number[], index: number, user: string): number {
    const value = curve[index];

    if (typeof value !== 'number') throw invalid(`${user} has a curve with too few numbers.`);

    return value;
}

/**
 * Stores the curve of one key for the first `curved` values, like the official `readCurve`.
 * `from` and `to` hold the time and the values of the key and of the key after it.
 *
 * @returns the number of Bezier curves the timeline holds now
 */
function writeCurve(
    curve: JsonCurve,
    writer: TimelineWriter,
    bezier: number,
    frame: number,
    curved: number,
    from: readonly number[],
    to: readonly number[],
    user: string,
): number {
    if (curve === 'stepped') {
        writer.setStepped(frame);

        return bezier;
    }
    if (typeof curve === 'string') throw invalid(`${user} has the unknown curve "${curve}".`);
    const [time1 = 0] = from;
    const [time2 = 0] = to;

    for (let value = 0; value < curved; value++) {
        const i = value << 2;
        const cx1 = curveNumber(curve, i, user);
        const cy1 = curveNumber(curve, i + 1, user);
        const cx2 = curveNumber(curve, i + 2, user);
        const cy2 = curveNumber(curve, i + 3, user);

        writer.setBezier(
            bezier + value,
            frame,
            value,
            time1,
            from[value + 1] ?? 0,
            cx1,
            cy1,
            cx2,
            cy2,
            time2,
            to[value + 1] ?? 0,
        );
    }

    return bezier + curved;
}

/**
 * Reads a timeline that interpolates, the way the official parser walks its keys.
 *
 * @param entries floats per key in `frames`: the time plus the values
 * @param curved how many values have a curve. They come first, right after the time.
 * @param read writes the time and the values of one key
 */
export function readCurveTimeline<K extends JsonKey>(
    sink: TimelineSink,
    kind: TimelineKind,
    target: number,
    keys: readonly K[],
    entries: number,
    curved: number,
    read: KeyReader<K>,
): void {
    let key = keys[0];

    if (!key) throw invalid(`${sink.user} has a timeline of the type "${kind}" without keys.`);
    const writer = new TimelineWriter(keys.length, entries, keys.length * curved);
    let current = new Array<number>(entries).fill(0);
    let next = new Array<number>(entries).fill(0);

    read(key, current);
    for (let frame = 0, bezier = 0; ; frame++) {
        writer.frames.set(current, frame * entries);
        const nextKey = keys[frame + 1];

        if (!nextKey) {
            writer.shrink(bezier);
            break;
        }
        read(nextKey, next);
        if (key.curve) bezier = writeCurve(key.curve, writer, bezier, frame, curved, current, next, sink.user);
        key = nextKey;
        [current, next] = [next, current];
    }
    addTimeline(sink, { kind, target, frames: writer.frames, curves: writer.curves }, entries);
}

/**
 * Reads a timeline with one value per key, like the official `readTimeline1`.
 *
 * @param fallback the value of a key that stores none
 */
export function readValueTimeline(
    sink: TimelineSink,
    kind: TimelineKind,
    target: number,
    keys: readonly JsonValueKey[],
    fallback: number,
): void {
    readCurveTimeline(sink, kind, target, keys, 2, 1, (key, out) => {
        out[0] = key.time ?? 0;
        out[1] = key.value ?? fallback;
    });
}
