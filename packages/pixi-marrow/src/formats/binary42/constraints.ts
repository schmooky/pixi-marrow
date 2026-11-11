import type {
    ConstraintData,
    IkConstraintData,
    PathConstraintData,
    PhysicsConstraintData,
    TransformConstraintData,
} from '../../model/constraints';
import type { BinaryInput } from '../shared/binary-input';
import { type ImportState, invalid, readCount, readIndex, requireName } from './state';

const POSITION_MODES = ['fixed', 'percent'] as const;
const SPACING_MODES = ['length', 'fixed', 'percent', 'proportional'] as const;
const ROTATE_MODES = ['tangent', 'chain', 'chainScale'] as const;

/** The entry of a mode list the file selects. */
function mode<T extends string>(modes: readonly T[], value: number, what: string): T {
    const name = modes[value];

    if (name === undefined) throw invalid(`The file holds the unknown ${what} ${value}.`);

    return name;
}

/** Reads a float the file stores only when a flag is set. */
const optional = (input: BinaryInput, present: boolean, fallback: number): number =>
    present ? input.readFloat() : fallback;

function readBoneList(state: ImportState): Int16Array {
    const bones = new Int16Array(readCount(state, 'constraint bones'));

    for (let i = 0; i < bones.length; i++) bones[i] = readIndex(state, state.boneCount, 'bone');

    return bones;
}

function readIk41(state: ImportState, name: string): IkConstraintData {
    const { input } = state;
    const order = input.readInt(true);
    const skinRequired = input.readBoolean();
    const bones = readBoneList(state);
    const target = readIndex(state, state.boneCount, 'bone');
    const mix = input.readFloat();
    const softness = input.readFloat();
    const bendDirection = input.readByte();
    const compress = input.readBoolean();
    const stretch = input.readBoolean();
    const uniform = input.readBoolean();

    return {
        type: 'ik',
        name,
        skinRequired,
        order,
        bones,
        target,
        mix,
        softness,
        bendDirection,
        compress,
        stretch,
        uniform,
    };
}

/** 4.2 packs the booleans into one byte, and stores mix and softness only when they are not the default. */
function readIk42(state: ImportState, name: string): IkConstraintData {
    const { input } = state;
    const order = input.readInt(true);
    const bones = readBoneList(state);
    const target = readIndex(state, state.boneCount, 'bone');
    const flags = input.readByte();
    const mix = (flags & 32) !== 0 ? optional(input, (flags & 64) !== 0, 1) : 0;
    const softness = optional(input, (flags & 128) !== 0, 0);

    return {
        type: 'ik',
        name,
        skinRequired: (flags & 1) !== 0,
        order,
        bones,
        target,
        mix,
        softness,
        bendDirection: (flags & 2) !== 0 ? 1 : -1,
        compress: (flags & 4) !== 0,
        stretch: (flags & 8) !== 0,
        uniform: (flags & 16) !== 0,
    };
}

function readTransform41(state: ImportState, name: string): TransformConstraintData {
    const { input } = state;
    const order = input.readInt(true);
    const skinRequired = input.readBoolean();
    const bones = readBoneList(state);
    const source = readIndex(state, state.boneCount, 'bone');
    const local = input.readBoolean();
    const relative = input.readBoolean();
    const offsets = new Float32Array(6);

    for (let i = 0; i < 6; i++) offsets[i] = input.readFloat();
    const mixRotate = input.readFloat();
    const mixX = input.readFloat();
    const mixY = input.readFloat();
    const mixScaleX = input.readFloat();
    const mixScaleY = input.readFloat();
    const mixShearY = input.readFloat();

    return {
        type: 'transform',
        name,
        skinRequired,
        order,
        bones,
        source,
        mixRotate,
        mixX,
        mixY,
        mixScaleX,
        mixScaleY,
        mixShearY,
        offsets,
        relative,
        local,
    };
}

/** 4.2 stores an offset or a mix only when its flag is set. The flags fill two bytes. */
function readTransform42(state: ImportState, name: string): TransformConstraintData {
    const { input } = state;
    const order = input.readInt(true);
    const bones = readBoneList(state);
    const source = readIndex(state, state.boneCount, 'bone');
    const flags = input.readByte();
    const offsets = new Float32Array(6);

    // rotation, x, y, scaleX and scaleY sit behind bits 8 to 128 of the first byte
    for (let i = 0; i < 5; i++) offsets[i] = optional(input, (flags & (8 << i)) !== 0, 0);
    const more = input.readByte();

    offsets[5] = optional(input, (more & 1) !== 0, 0);
    const mixRotate = optional(input, (more & 2) !== 0, 0);
    const mixX = optional(input, (more & 4) !== 0, 0);
    const mixY = optional(input, (more & 8) !== 0, 0);
    const mixScaleX = optional(input, (more & 16) !== 0, 0);
    const mixScaleY = optional(input, (more & 32) !== 0, 0);
    const mixShearY = optional(input, (more & 64) !== 0, 0);

    return {
        type: 'transform',
        name,
        skinRequired: (flags & 1) !== 0,
        order,
        bones,
        source,
        mixRotate,
        mixX,
        mixY,
        mixScaleX,
        mixScaleY,
        mixShearY,
        offsets,
        relative: (flags & 4) !== 0,
        local: (flags & 2) !== 0,
    };
}

/** 4.1 stores the three modes as integers. 4.2 packs them into one byte with the rotation flag. */
function readPath(state: ImportState, name: string): PathConstraintData {
    const { input, version } = state;
    const order = input.readInt(true);
    const skinRequired = input.readBoolean();
    const bones = readBoneList(state);
    const slot = readIndex(state, state.slotCount, 'slot');
    let position = 0;
    let spacing = 0;
    let rotate = 0;
    let offsetRotation = 0;

    if (version === '4.2') {
        const flags = input.readByte();

        position = flags & 1;
        spacing = (flags >> 1) & 3;
        rotate = (flags >> 3) & 3;
        offsetRotation = optional(input, (flags & 128) !== 0, 0);
    } else {
        position = input.readInt(true);
        spacing = input.readInt(true);
        rotate = input.readInt(true);
        offsetRotation = input.readFloat();
    }
    const positionValue = input.readFloat();
    const spacingValue = input.readFloat();
    const mixRotate = input.readFloat();
    const mixX = input.readFloat();
    const mixY = input.readFloat();

    return {
        type: 'path',
        name,
        skinRequired,
        order,
        bones,
        slot,
        positionMode: mode(POSITION_MODES, position, 'position mode'),
        spacingMode: mode(SPACING_MODES, spacing, 'spacing mode'),
        rotateMode: mode(ROTATE_MODES, rotate, 'rotate mode'),
        offsetRotation,
        position: positionValue,
        spacing: spacingValue,
        mixRotate,
        mixX,
        mixY,
    };
}

/** 4.2 only. The step is stored as steps per second, and the mass as its inverse. */
function readPhysics(state: ImportState, name: string): PhysicsConstraintData {
    const { input } = state;
    const order = input.readInt(true);
    const bone = readIndex(state, state.boneCount, 'bone');
    const flags = input.readByte();
    const x = optional(input, (flags & 2) !== 0, 0);
    const y = optional(input, (flags & 4) !== 0, 0);
    const rotate = optional(input, (flags & 8) !== 0, 0);
    const scaleX = optional(input, (flags & 16) !== 0, 0);
    const shearX = optional(input, (flags & 32) !== 0, 0);
    const limit = optional(input, (flags & 64) !== 0, 5000);
    const step = 1 / input.readUnsignedByte();
    const inertia = input.readFloat();
    const strength = input.readFloat();
    const damping = input.readFloat();
    const massInverse = optional(input, (flags & 128) !== 0, 1);
    const wind = input.readFloat();
    const gravity = input.readFloat();
    const globals = input.readByte();
    const mix = optional(input, (globals & 128) !== 0, 1);

    return {
        type: 'physics',
        name,
        skinRequired: (flags & 1) !== 0,
        order,
        bone,
        x,
        y,
        rotate,
        scaleX,
        shearX,
        limit,
        step,
        inertia,
        strength,
        damping,
        massInverse,
        wind,
        gravity,
        mix,
        inertiaGlobal: (globals & 1) !== 0,
        strengthGlobal: (globals & 2) !== 0,
        dampingGlobal: (globals & 4) !== 0,
        massGlobal: (globals & 8) !== 0,
        windGlobal: (globals & 16) !== 0,
        gravityGlobal: (globals & 32) !== 0,
        mixGlobal: (globals & 64) !== 0,
    };
}

function readGroup<T>(state: ImportState, what: string, read: (state: ImportState, name: string) => T): T[] {
    const group: T[] = [];

    for (let i = 0, n = readCount(state, `${what}s`); i < n; i++) {
        group.push(read(state, requireName(state.input.readString(), `a ${what}`)));
    }

    return group;
}

/**
 * Reads every constraint into one list: IK, then transform, then path, then physics constraints.
 * The counts of the groups go into the state, because timelines and skins index each group on its own.
 */
export function readConstraints(state: ImportState): ConstraintData[] {
    const modern = state.version === '4.2';
    const ik = readGroup(state, 'IK constraint', modern ? readIk42 : readIk41);
    const transform = readGroup(state, 'transform constraint', modern ? readTransform42 : readTransform41);
    const path = readGroup(state, 'path constraint', readPath);
    const physics = modern ? readGroup(state, 'physics constraint', readPhysics) : [];

    state.ikCount = ik.length;
    state.transformCount = transform.length;
    state.pathCount = path.length;
    state.physicsCount = physics.length;

    return [...ik, ...transform, ...path, ...physics];
}
