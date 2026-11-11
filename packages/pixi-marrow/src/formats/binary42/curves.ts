import type { TimelineData, TimelineKind } from '../../model/timelines';
import type { BinaryInput } from '../shared/binary-input';
import { TimelineWriter } from '../shared/timeline-writer';
import { type ImportState, invalid, readCount } from './state';

/** The curve type byte after a key: the key holds its value until the next key. */
export const CURVE_STEPPED = 1;
/** The curve type byte after a key: four floats of Bezier handles follow for each value. */
export const CURVE_BEZIER = 2;

/** The timelines of one animation while they are read, with the duration so far. */
export interface TimelineList {
    timelines: TimelineData[];
    duration: number;
}

/**
 * Adds a timeline and extends the duration to the time of its last key, like the official
 * `Animation`. A timeline without keys has no last time, and the duration becomes NaN there too.
 *
 * @param entries floats per key in `frames`
 */
export function addTimeline(list: TimelineList, timeline: TimelineData, entries: number): void {
    const lastTime = timeline.frames[timeline.frames.length - entries];

    list.timelines.push(timeline);
    list.duration = Math.max(list.duration, lastTime ?? Number.NaN);
}

/**
 * Reads the Bezier count the file stores for a timeline and makes the writer for its arrays.
 * The official reader stores the first key before it looks at the key count, so a timeline that
 * interpolates needs at least one key.
 */
export function curveWriter(state: ImportState, frameCount: number, entries: number): TimelineWriter {
    if (frameCount === 0) throw invalid('The file holds a curve timeline without keys.');

    return new TimelineWriter(frameCount, entries, readCount(state, 'Bezier curves'));
}

/** The model form of a timeline that needs no extra payload. */
export function curveTimeline(kind: TimelineKind, target: number, writer: TimelineWriter): TimelineData {
    return { kind, target, frames: writer.frames, curves: writer.curves };
}

/** Reads the four handle floats of one Bezier curve and stores its samples. */
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
    const cx1 = input.readFloat();
    const cy1 = input.readFloat();
    const cx2 = input.readFloat();
    const cy2 = input.readFloat();

    writer.setBezier(bezier, frame, value, time1, value1, cx1, cy1, cx2, cy2, time2, value2);
}

function readValues(input: BinaryInput, out: Float64Array, colors: boolean): void {
    for (let i = 0; i < out.length; i++) out[i] = colors ? input.readUnsignedByte() / 255 : input.readFloat();
}

/**
 * Reads the keys of a timeline that stores a time and `valueCount` values per key, with a curve
 * type between two keys. This is the loop the official reader repeats for most timelines.
 *
 * @param colors true when the values are color channels, stored as one byte each
 */
export function readCurveKeys(input: BinaryInput, writer: TimelineWriter, valueCount: number, colors: boolean): void {
    const entries = valueCount + 1;
    const frameLast = writer.frameCount - 1;
    // the values stay doubles here, because the official reader builds the curves from doubles
    let values = new Float64Array(valueCount);
    let next = new Float64Array(valueCount);
    let time = input.readFloat();

    readValues(input, values, colors);
    for (let frame = 0, bezier = 0; ; frame++) {
        writer.frames[frame * entries] = time;
        writer.frames.set(values, frame * entries + 1);
        if (frame === frameLast) break;
        const time2 = input.readFloat();

        readValues(input, next, colors);
        switch (input.readByte()) {
            case CURVE_STEPPED:
                writer.setStepped(frame);
                break;
            case CURVE_BEZIER:
                for (let i = 0; i < valueCount; i++) {
                    readBezier(input, writer, bezier++, frame, i, time, time2, values[i] ?? 0, next[i] ?? 0);
                }
        }
        time = time2;
        [values, next] = [next, values];
    }
}

/**
 * Reads the handles of the Bezier curve of a deform key and stores its samples. A deform curve
 * always runs from 0 to 1, and the writer packs it with the arithmetic of the official `DeformTimeline`.
 */
export function readDeformBezier(
    input: BinaryInput,
    writer: TimelineWriter,
    bezier: number,
    frame: number,
    time1: number,
    time2: number,
): void {
    const cx1 = input.readFloat();
    const cy1 = input.readFloat();
    const cx2 = input.readFloat();
    const cy2 = input.readFloat();

    writer.setDeformBezier(bezier, frame, 0, time1, cx1, cy1, cx2, cy2, time2);
}
