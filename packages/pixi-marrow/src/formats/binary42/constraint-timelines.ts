import type { BinaryInput } from '../shared/binary-input';
import type { TimelineWriter } from '../shared/timeline-writer';
import {
    addTimeline,
    CURVE_BEZIER,
    CURVE_STEPPED,
    curveTimeline,
    curveWriter,
    readBezier,
    type TimelineList,
} from './curves';
import { type KindRow, readKeyedTimeline } from './pose-timelines';
import { type ImportState, invalid, readCount, readIndex } from './state';

const IK_ENTRIES = 6;
const TRANSFORM_ROW: KindRow = ['transformConstraint', 6];
/** The path constraint timeline types from 0 up. */
const PATH_KINDS: readonly KindRow[] = [
    ['pathConstraintPosition', 1],
    ['pathConstraintSpacing', 1],
    ['pathConstraintMix', 3],
];
/** The physics constraint timeline types from 0 up. The format has no type 3. */
const PHYSICS_KINDS: readonly (KindRow | null)[] = [
    ['physicsConstraintInertia', 1],
    ['physicsConstraintStrength', 1],
    ['physicsConstraintDamping', 1],
    null,
    ['physicsConstraintMass', 1],
    ['physicsConstraintWind', 1],
    ['physicsConstraintGravity', 1],
    ['physicsConstraintMix', 1],
];
const PHYSICS_RESET = 8;

function setIkFrame(
    writer: TimelineWriter,
    frame: number,
    time: number,
    mix: number,
    softness: number,
    bendDirection: number,
    compress: boolean,
    stretch: boolean,
): void {
    writer.frames.set([time, mix, softness, bendDirection, compress ? 1 : 0, stretch ? 1 : 0], frame * IK_ENTRIES);
}

function readIkBeziers(
    input: BinaryInput,
    writer: TimelineWriter,
    bezier: number,
    frame: number,
    from: readonly [time: number, mix: number, softness: number],
    to: readonly [time: number, mix: number, softness: number],
): void {
    readBezier(input, writer, bezier, frame, 0, from[0], to[0], from[1], to[1]);
    readBezier(input, writer, bezier + 1, frame, 1, from[0], to[0], from[2], to[2]);
}

/** 4.1 stores mix and softness for every key, then the bend direction and two booleans. */
function readIkKeys41(input: BinaryInput, writer: TimelineWriter): void {
    const frameLast = writer.frameCount - 1;
    let key: [number, number, number] = [input.readFloat(), input.readFloat(), input.readFloat()];

    for (let frame = 0, bezier = 0; ; frame++) {
        const bendDirection = input.readByte();
        const compress = input.readBoolean();
        const stretch = input.readBoolean();

        setIkFrame(writer, frame, key[0], key[1], key[2], bendDirection, compress, stretch);
        if (frame === frameLast) break;
        const next: [number, number, number] = [input.readFloat(), input.readFloat(), input.readFloat()];

        switch (input.readByte()) {
            case CURVE_STEPPED:
                writer.setStepped(frame);
                break;
            case CURVE_BEZIER:
                readIkBeziers(input, writer, bezier, frame, key, next);
                bezier += 2;
        }
        key = next;
    }
}

/** Reads the time, mix and softness of a 4.2 key. Its flag byte says which of the two values the file stores. */
function readIkKey42(input: BinaryInput, flags: number): [number, number, number] {
    const time = input.readFloat();
    let mix = 0;

    if ((flags & 1) !== 0) mix = (flags & 2) !== 0 ? input.readFloat() : 1;
    const softness = (flags & 4) !== 0 ? input.readFloat() : 0;

    return [time, mix, softness];
}

/** 4.2 puts a flag byte in front of every key. It also holds the curve type that leads to the key. */
function readIkKeys42(input: BinaryInput, writer: TimelineWriter): void {
    const frameLast = writer.frameCount - 1;
    let flags = input.readByte();
    let key = readIkKey42(input, flags);

    for (let frame = 0, bezier = 0; ; frame++) {
        const bendDirection = (flags & 8) !== 0 ? 1 : -1;

        setIkFrame(writer, frame, key[0], key[1], key[2], bendDirection, (flags & 16) !== 0, (flags & 32) !== 0);
        if (frame === frameLast) break;
        flags = input.readByte();
        const next = readIkKey42(input, flags);

        if ((flags & 64) !== 0) writer.setStepped(frame);
        else if ((flags & 128) !== 0) {
            readIkBeziers(input, writer, bezier, frame, key, next);
            bezier += 2;
        }
        key = next;
    }
}

/** Reads the IK constraint timelines. The two versions store the keys in different layouts. */
export function readIkTimelines(state: ImportState, list: TimelineList): void {
    const { input, version } = state;

    for (let i = 0, n = readCount(state, 'IK timelines'); i < n; i++) {
        const index = readIndex(state, state.ikCount, 'IK constraint');
        const writer = curveWriter(state, readCount(state, 'timeline keys'), IK_ENTRIES);

        if (version === '4.2') readIkKeys42(input, writer);
        else readIkKeys41(input, writer);
        addTimeline(list, curveTimeline('ikConstraint', index, writer), IK_ENTRIES);
    }
}

/** Reads the transform constraint timelines. Each key holds the six mixes. */
export function readTransformTimelines(state: ImportState, list: TimelineList): void {
    for (let i = 0, n = readCount(state, 'transform timelines'); i < n; i++) {
        const index = readIndex(state, state.transformCount, 'transform constraint');
        const frameCount = readCount(state, 'timeline keys');

        readKeyedTimeline(state, list, TRANSFORM_ROW, state.ikCount + index, frameCount, false);
    }
}

/** Reads the position, spacing and mix timelines of every path constraint the animation changes. */
export function readPathTimelines(state: ImportState, list: TimelineList): void {
    const start = state.ikCount + state.transformCount;

    for (let i = 0, n = readCount(state, 'animated path constraints'); i < n; i++) {
        const index = readIndex(state, state.pathCount, 'path constraint');

        for (let ii = 0, nn = readCount(state, 'path timelines'); ii < nn; ii++) {
            const type = state.input.readByte();
            const row = PATH_KINDS[type];

            if (row === undefined) throw invalid(`A path constraint timeline has the unknown type ${type}.`);
            readKeyedTimeline(state, list, row, start + index, readCount(state, 'timeline keys'), false);
        }
    }
}

function readPhysicsTimeline(state: ImportState, list: TimelineList, target: number): void {
    const { input } = state;
    const type = input.readByte();
    const frameCount = readCount(state, 'timeline keys');

    if (type === PHYSICS_RESET) {
        const frames = new Float32Array(frameCount);

        for (let frame = 0; frame < frameCount; frame++) frames[frame] = input.readFloat();
        addTimeline(list, { kind: 'physicsConstraintReset', target, frames, curves: null }, 1);

        return;
    }
    const row = PHYSICS_KINDS[type];

    if (!row) throw invalid(`A physics constraint timeline has the unknown type ${type}.`);
    readKeyedTimeline(state, list, row, target, frameCount, false);
}

/**
 * Reads the physics constraint timelines. 4.2 only. The file stores the constraint index plus
 * one, and 0 stands for a timeline that applies to every physics constraint.
 */
export function readPhysicsTimelines(state: ImportState, list: TimelineList): void {
    const start = state.ikCount + state.transformCount + state.pathCount;

    for (let i = 0, n = readCount(state, 'animated physics constraints'); i < n; i++) {
        const index = state.input.readInt(true) - 1;

        if (index < -1 || index >= state.physicsCount) {
            throw invalid(`A timeline points at physics constraint ${index}, but the file has ${state.physicsCount}.`);
        }
        const target = index === -1 ? -1 : start + index;

        for (let ii = 0, nn = readCount(state, 'physics timelines'); ii < nn; ii++) {
            readPhysicsTimeline(state, list, target);
        }
    }
}
