import type { TimelineData, TimelineKind } from '../../model/timelines';
import type { BinaryInput } from '../shared/binary-input';
import { BEZIER_SIZE, TimelineWriter } from '../shared/timeline-writer';
import { invalid } from './reader';

/** The byte after a key that says how the key blends into the next one. */
const CURVE_LINEAR = 0;
const CURVE_STEPPED = 1;
const CURVE_BEZIER = 2;

/** The timelines of one animation while it is read, with the time of the last key so far. */
export interface TimelineSink {
    timelines: TimelineData[];
    duration: number;
}

/**
 * Adds a timeline to an animation and extends the duration to its last key, like the official reader.
 *
 * @param entries floats per key in `frames`
 */
export function pushTimeline(sink: TimelineSink, timeline: TimelineData, entries: number): void {
    sink.timelines.push(timeline);
    sink.duration = Math.max(sink.duration, timeline.frames[timeline.frames.length - entries] ?? Number.NaN);
}

/**
 * Reads the number of keys of a timeline. A timeline without keys is an error: the official
 * reader runs past the data on it, or ends with a duration that is not a number.
 */
export function readFrameCount(input: BinaryInput): number {
    const frameCount = input.readInt(true);

    if (frameCount < 1) throw invalid('A timeline has no keys.');

    return frameCount;
}

/**
 * Reads how the key at `frame` blends into the next one and marks a stepped key.
 * Returns true for a Bezier key, whose curves follow in the file.
 */
export function readCurveType(input: BinaryInput, writer: TimelineWriter, frame: number): boolean {
    const type = input.readByte();

    if (type < CURVE_LINEAR || type > CURVE_BEZIER)
        throw invalid(`A key has curve type ${type}, which Spine 4.3 does not have.`);
    if (type === CURVE_STEPPED) writer.setStepped(frame);

    return type === CURVE_BEZIER;
}

/** Checks that a timeline has room for curve number `bezier`. The file declares the number of curves up front. */
export function checkBezierRoom(writer: TimelineWriter, bezier: number): void {
    if (writer.frameCount + (bezier + 1) * BEZIER_SIZE > (writer.curves?.length ?? 0)) {
        throw invalid('A timeline holds more Bezier curves than it declares.');
    }
}

/** Reads the two handles of one Bezier curve and stores its samples. */
export function readBezier(
    input: BinaryInput,
    writer: TimelineWriter,
    bezier: number,
    frame: number,
    value: number,
    time1: number,
    time2: number,
    value1: number,
    value2: number,
): void {
    checkBezierRoom(writer, bezier);
    const cx1 = input.readFloat();
    const cy1 = input.readFloat();
    const cx2 = input.readFloat();
    const cy2 = input.readFloat();

    writer.setBezier(bezier, frame, value, time1, value1, cx1, cy1, cx2, cy2, time2, value2);
}

/** How one value of a key is stored. */
export type ValueReader = (input: BinaryInput) => number;

/** A value stored as a float. */
export const readFloatValue: ValueReader = (input) => input.readFloat();

/** A color channel stored as a byte. The division stays in double precision, as in the official reader. */
export const readColorValue: ValueReader = (input) => input.readUnsignedByte() / 255;

function readValues(input: BinaryInput, out: Float64Array, readValue: ValueReader): void {
    for (let i = 0; i < out.length; i++) out[i] = readValue(input);
}

/**
 * Reads the keys of a curve timeline whose keys hold a time and `valueCount` values.
 * A Bezier key stores one curve per value.
 */
function readCurveKeys(input: BinaryInput, writer: TimelineWriter, valueCount: number, readValue: ValueReader): void {
    const entries = valueCount + 1;
    const frameLast = writer.frameCount - 1;
    let values = new Float64Array(valueCount);
    let next = new Float64Array(valueCount);
    let time = input.readFloat();

    readValues(input, values, readValue);
    for (let frame = 0, bezier = 0; ; frame++) {
        writer.frames[frame * entries] = time;
        writer.frames.set(values, frame * entries + 1);
        if (frame === frameLast) break;
        const time2 = input.readFloat();

        readValues(input, next, readValue);
        if (readCurveType(input, writer, frame)) {
            for (let i = 0; i < valueCount; i++) {
                readBezier(input, writer, bezier++, frame, i, time, time2, values[i] ?? 0, next[i] ?? 0);
            }
        }
        time = time2;
        [values, next] = [next, values];
    }
}

/**
 * Reads a whole curve timeline: the Bezier count, then the keys.
 *
 * @param valueCount values per key, not counting the time
 */
export function readCurveTimeline(
    input: BinaryInput,
    kind: TimelineKind,
    target: number,
    frameCount: number,
    valueCount: number,
    readValue: ValueReader,
): TimelineData {
    const writer = new TimelineWriter(frameCount, valueCount + 1, input.readInt(true));

    readCurveKeys(input, writer, valueCount, readValue);

    return { kind, target, frames: writer.frames, curves: writer.curves };
}
