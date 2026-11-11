import type { ConstraintData } from '../../model/constraints';
import type { TimelineData, TimelineKind } from '../../model/timelines';
import type { BinaryInput } from '../shared/binary-input';
import { TimelineWriter } from '../shared/timeline-writer';
import { type ImportState, invalid, pick, readIndex } from './reader';
import {
    pushTimeline,
    readBezier,
    readCurveTimeline,
    readFloatValue,
    readFrameCount,
    type TimelineSink,
} from './timelines-curve';

/** A curve timeline type of the file: the kind it becomes and its values per key. */
type CurveType = readonly [kind: TimelineKind, valueCount: number];

const IK_ENTRIES = 6;
const TRANSFORM_VALUES = 6;
/** Path timeline types by their number in the file. */
const PATH_TIMELINES: readonly CurveType[] = [
    ['pathConstraintPosition', 1],
    ['pathConstraintSpacing', 1],
    ['pathConstraintMix', 3],
];
const PHYSICS_RESET = 8;
/** Physics timeline kinds by their number in the file. The file has no type 3, and type 8 is the reset timeline. */
const PHYSICS_TIMELINES: readonly (TimelineKind | undefined)[] = [
    'physicsConstraintInertia',
    'physicsConstraintStrength',
    'physicsConstraintDamping',
    undefined,
    'physicsConstraintMass',
    'physicsConstraintWind',
    'physicsConstraintGravity',
    'physicsConstraintMix',
];
/** Slider timeline kinds by their number in the file. */
const SLIDER_TIMELINES: readonly TimelineKind[] = ['slider', 'sliderMix'];

/** Reads a constraint index and checks that the constraint there has the type a timeline needs. */
function readConstraintIndex(state: ImportState, type: ConstraintData['type']): number {
    const index = readIndex(state.input, state.constraints.length, 'constraint');

    if (state.constraints[index]?.type !== type) {
        throw invalid(
            `A timeline for constraints of type ${type} points at constraint ${index}, which has another type.`,
        );
    }

    return index;
}

/** Reads the mix of an IK key. Bit 0 says it is not 0, bit 1 that it is stored. */
function readIkMix(input: BinaryInput, flags: number): number {
    if ((flags & 1) === 0) return 0;

    return (flags & 2) !== 0 ? input.readFloat() : 1;
}

/** Writes one IK key: time, mix, softness, bend direction, compress, stretch. */
function writeIkKey(
    frames: Float32Array,
    frame: number,
    time: number,
    mix: number,
    softness: number,
    flags: number,
): void {
    const at = frame * IK_ENTRIES;

    frames[at] = time;
    frames[at + 1] = mix;
    frames[at + 2] = softness;
    frames[at + 3] = (flags & 8) !== 0 ? 1 : -1;
    frames[at + 4] = (flags & 16) !== 0 ? 1 : 0;
    frames[at + 5] = (flags & 32) !== 0 ? 1 : 0;
}

/** Reads one IK timeline. Each key starts with a flags byte that also holds the curve type to reach it. */
function readIkTimeline(input: BinaryInput, target: number): TimelineData {
    const frameCount = readFrameCount(input);
    const writer = new TimelineWriter(frameCount, IK_ENTRIES, input.readInt(true));
    let flags = input.readByte();
    let time = input.readFloat();
    let mix = readIkMix(input, flags);
    let softness = (flags & 4) !== 0 ? input.readFloat() : 0;

    for (let frame = 0, bezier = 0; ; frame++) {
        writeIkKey(writer.frames, frame, time, mix, softness, flags);
        if (frame === frameCount - 1) break;
        flags = input.readByte();
        const time2 = input.readFloat();
        const mix2 = readIkMix(input, flags);
        const softness2 = (flags & 4) !== 0 ? input.readFloat() : 0;

        if ((flags & 64) !== 0) {
            writer.setStepped(frame);
        } else if ((flags & 128) !== 0) {
            readBezier(input, writer, bezier++, frame, 0, time, time2, mix, mix2);
            readBezier(input, writer, bezier++, frame, 1, time, time2, softness, softness2);
        }
        time = time2;
        mix = mix2;
        softness = softness2;
    }

    return { kind: 'ikConstraint', target, frames: writer.frames, curves: writer.curves };
}

/** Reads the IK constraint timelines and then the transform constraint timelines of an animation. */
export function readIkAndTransformTimelines(state: ImportState, sink: TimelineSink): void {
    const input = state.input;

    for (let i = 0, n = input.readInt(true); i < n; i++) {
        pushTimeline(sink, readIkTimeline(input, readConstraintIndex(state, 'ik')), IK_ENTRIES);
    }
    for (let i = 0, n = input.readInt(true); i < n; i++) {
        const target = readConstraintIndex(state, 'transform');
        const frameCount = readFrameCount(input);
        const timeline = readCurveTimeline(
            input,
            'transformConstraint',
            target,
            frameCount,
            TRANSFORM_VALUES,
            readFloatValue,
        );

        pushTimeline(sink, timeline, TRANSFORM_VALUES + 1);
    }
}

/** Reads the position, spacing and mix timelines of every path constraint an animation keys. */
export function readPathTimelines(state: ImportState, sink: TimelineSink): void {
    const input = state.input;

    for (let i = 0, n = input.readInt(true); i < n; i++) {
        const target = readConstraintIndex(state, 'path');

        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
            const [kind, valueCount] = pick(PATH_TIMELINES, input.readByte(), 'path timeline type');
            const frameCount = readFrameCount(input);

            pushTimeline(
                sink,
                readCurveTimeline(input, kind, target, frameCount, valueCount, readFloatValue),
                valueCount + 1,
            );
        }
    }
}

function readPhysicsReset(input: BinaryInput, target: number, frameCount: number): TimelineData {
    const writer = new TimelineWriter(frameCount, 1, null);

    for (let frame = 0; frame < frameCount; frame++) writer.frames[frame] = input.readFloat();

    return { kind: 'physicsConstraintReset', target, frames: writer.frames, curves: writer.curves };
}

/** Reads the physics timelines of an animation. The file stores the constraint index plus 1, and 0 for all. */
export function readPhysicsTimelines(state: ImportState, sink: TimelineSink): void {
    const input = state.input;

    for (let i = 0, n = input.readInt(true); i < n; i++) {
        const stored = input.readInt(true);
        const target = stored === 0 ? -1 : checkPhysics(state, stored - 1);

        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
            const type = input.readByte();
            const frameCount = readFrameCount(input);

            if (type === PHYSICS_RESET) {
                pushTimeline(sink, readPhysicsReset(input, target, frameCount), 1);
                continue;
            }
            const kind = pick(PHYSICS_TIMELINES, type, 'physics timeline type');

            pushTimeline(sink, readCurveTimeline(input, kind, target, frameCount, 1, readFloatValue), 2);
        }
    }
}

function checkPhysics(state: ImportState, index: number): number {
    if (state.constraints[index]?.type !== 'physics') {
        throw invalid(`A physics timeline points at constraint ${index}, which is not a physics constraint.`);
    }

    return index;
}

/** Reads the time and mix timelines of every slider an animation keys. */
export function readSliderTimelines(state: ImportState, sink: TimelineSink): void {
    const input = state.input;

    for (let i = 0, n = input.readInt(true); i < n; i++) {
        const target = readConstraintIndex(state, 'slider');

        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
            const kind = pick(SLIDER_TIMELINES, input.readByte(), 'slider timeline type');
            const frameCount = readFrameCount(input);

            pushTimeline(sink, readCurveTimeline(input, kind, target, frameCount, 1, readFloatValue), 2);
        }
    }
}
