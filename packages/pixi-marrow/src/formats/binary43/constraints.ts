import type {
    ConstraintData,
    IkConstraintData,
    PathConstraintData,
    PhysicsConstraintData,
    ScaleYMode,
    SliderConstraintData,
    TransformConstraintData,
    TransformFrom,
    TransformProperty,
    TransformTo,
} from '../../model/constraints';
import type { BinaryInput } from '../shared/binary-input';
import { type ImportState, invalid, pick, readIndex, readName } from './reader';

const CONSTRAINT_IK = 0;
const CONSTRAINT_PATH = 1;
const CONSTRAINT_TRANSFORM = 2;
const CONSTRAINT_PHYSICS = 3;
const CONSTRAINT_SLIDER = 4;

const PROPERTIES: readonly TransformProperty[] = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
const SCALE_Y_MODES: readonly ScaleYMode[] = ['none', 'uniform', 'volume'];
const POSITION_MODES: readonly PathConstraintData['positionMode'][] = ['fixed', 'percent'];
const SPACING_MODES: readonly PathConstraintData['spacingMode'][] = ['length', 'fixed', 'percent', 'proportional'];
const ROTATE_MODES: readonly PathConstraintData['rotateMode'][] = ['tangent', 'chain', 'chainScale'];

function readBoneList(input: BinaryInput, boneCount: number): Int16Array {
    const bones = new Int16Array(input.readInt(true));

    for (let i = 0; i < bones.length; i++) bones[i] = readIndex(input, boneCount, 'bone');

    return bones;
}

const readProperty = (input: BinaryInput): TransformProperty => pick(PROPERTIES, input.readByte(), 'bone property');

/** Reads up to six floats. Bit `i` of a flags byte tells whether value `i` is stored. */
function readFlagged(input: BinaryInput, out: { [index: number]: number }): void {
    const flags = input.readByte();

    for (let i = 0; i < 6; i++) {
        if ((flags & (1 << i)) !== 0) out[i] = input.readFloat();
    }
}

function readIk(input: BinaryInput, name: string, boneCount: number): IkConstraintData {
    const bones = readBoneList(input, boneCount);
    const target = readIndex(input, boneCount, 'bone');
    const flags = input.readByte();
    const scaleYMode = (flags & 2) !== 0 ? pick(SCALE_Y_MODES, input.readUnsignedByte(), 'scale Y mode') : 'none';
    let mix = 0;

    if ((flags & 32) !== 0) mix = (flags & 64) !== 0 ? input.readFloat() : 1;
    const softness = (flags & 128) !== 0 ? input.readFloat() : 0;

    return {
        type: 'ik',
        name,
        skinRequired: (flags & 1) !== 0,
        bones,
        target,
        mix,
        softness,
        bendDirection: (flags & 4) !== 0 ? -1 : 1,
        compress: (flags & 8) !== 0,
        stretch: (flags & 16) !== 0,
        scaleYMode,
    };
}

function readTransformTo(input: BinaryInput): TransformTo {
    const property = readProperty(input);
    const offset = input.readFloat();
    const max = input.readFloat();
    const scale = input.readFloat();

    return { property, offset, max, scale };
}

function readTransformFrom(input: BinaryInput): TransformFrom {
    const property = readProperty(input);
    const offset = input.readFloat();
    const to: TransformTo[] = [];

    for (let i = 0, n = input.readByte(); i < n; i++) to.push(readTransformTo(input));

    return { property, offset, to };
}

function readTransform(input: BinaryInput, name: string, boneCount: number): TransformConstraintData {
    const bones = readBoneList(input, boneCount);
    const source = readIndex(input, boneCount, 'bone');
    const flags = input.readUnsignedByte();
    const properties: TransformFrom[] = [];
    const offsets = new Float32Array(6);
    const mixes = [0, 0, 0, 0, 0, 0];

    for (let i = 0, n = flags >> 5; i < n; i++) properties.push(readTransformFrom(input));
    readFlagged(input, offsets);
    readFlagged(input, mixes);
    const [mixRotate = 0, mixX = 0, mixY = 0, mixScaleX = 0, mixScaleY = 0, mixShearY = 0] = mixes;

    return {
        type: 'transform',
        name,
        skinRequired: (flags & 1) !== 0,
        bones,
        source,
        mixRotate,
        mixX,
        mixY,
        mixScaleX,
        mixScaleY,
        mixShearY,
        offsets,
        localSource: (flags & 2) !== 0,
        localTarget: (flags & 4) !== 0,
        additive: (flags & 8) !== 0,
        clamp: (flags & 16) !== 0,
        properties,
    };
}

function readPath(input: BinaryInput, name: string, state: ImportState): PathConstraintData {
    const bones = readBoneList(input, state.boneCount);
    const slot = readIndex(input, state.slotCount, 'slot');
    const flags = input.readByte();
    const offsetRotation = (flags & 128) !== 0 ? input.readFloat() : 0;
    const position = input.readFloat();
    const spacing = input.readFloat();
    const mixRotate = input.readFloat();
    const mixX = input.readFloat();
    const mixY = input.readFloat();

    return {
        type: 'path',
        name,
        skinRequired: (flags & 1) !== 0,
        bones,
        slot,
        positionMode: pick(POSITION_MODES, (flags >> 1) & 1, 'position mode'),
        spacingMode: pick(SPACING_MODES, (flags >> 2) & 3, 'spacing mode'),
        rotateMode: pick(ROTATE_MODES, (flags >> 4) & 3, 'rotate mode'),
        offsetRotation,
        position,
        spacing,
        mixRotate,
        mixX,
        mixY,
    };
}

/** Reads the scale X of a physics constraint. The file folds the scale Y mode into its sign. */
function readPhysicsScale(input: BinaryInput, data: PhysicsConstraintData): void {
    let scaleX = input.readFloat();

    if (scaleX < -2) {
        data.scaleYMode = 'volume';
        scaleX = -2 - scaleX;
    } else if (scaleX < 0) {
        data.scaleYMode = 'uniform';
        scaleX = -1 - scaleX;
    }
    data.scaleX = scaleX;
}

function readPhysics(input: BinaryInput, name: string, boneCount: number): PhysicsConstraintData {
    const bone = readIndex(input, boneCount, 'bone');
    const flags = input.readByte();
    const data: PhysicsConstraintData = {
        type: 'physics',
        name,
        skinRequired: (flags & 1) !== 0,
        bone,
        x: 0,
        y: 0,
        rotate: 0,
        scaleX: 0,
        shearX: 0,
        limit: 0,
        step: 0,
        inertia: 0,
        strength: 0,
        damping: 0,
        massInverse: 0,
        wind: 0,
        gravity: 0,
        mix: 0,
        inertiaGlobal: false,
        strengthGlobal: false,
        dampingGlobal: false,
        massGlobal: false,
        windGlobal: false,
        gravityGlobal: false,
        mixGlobal: false,
        scaleYMode: 'none',
    };

    if ((flags & 2) !== 0) data.x = input.readFloat();
    if ((flags & 4) !== 0) data.y = input.readFloat();
    if ((flags & 8) !== 0) data.rotate = input.readFloat();
    if ((flags & 16) !== 0) readPhysicsScale(input, data);
    if ((flags & 32) !== 0) data.shearX = input.readFloat();
    data.limit = (flags & 64) !== 0 ? input.readFloat() : 5000;
    data.step = 1 / input.readUnsignedByte();
    data.inertia = input.readFloat();
    data.strength = input.readFloat();
    data.damping = input.readFloat();
    data.massInverse = (flags & 128) !== 0 ? input.readFloat() : 1;
    data.wind = input.readFloat();
    data.gravity = input.readFloat();
    const globals = input.readByte();

    data.inertiaGlobal = (globals & 1) !== 0;
    data.strengthGlobal = (globals & 2) !== 0;
    data.dampingGlobal = (globals & 4) !== 0;
    data.massGlobal = (globals & 8) !== 0;
    data.windGlobal = (globals & 16) !== 0;
    data.gravityGlobal = (globals & 32) !== 0;
    data.mixGlobal = (globals & 64) !== 0;
    data.mix = (globals & 128) !== 0 ? input.readFloat() : 1;

    return data;
}

function readSlider(input: BinaryInput, name: string, state: ImportState): SliderConstraintData {
    const flags = input.readByte();
    const data: SliderConstraintData = {
        type: 'slider',
        name,
        skinRequired: (flags & 1) !== 0,
        // the file names the animation after the animations, see resolveSliders
        animation: -1,
        additive: (flags & 4) !== 0,
        loop: (flags & 2) !== 0,
        mix: 0,
        time: 0,
        bone: -1,
        property: null,
        propertyOffset: 0,
        offset: 0,
        scale: 0,
        max: 0,
        local: false,
    };

    if ((flags & 8) !== 0) {
        const value = input.readFloat();

        // with a bone, a file with editor data stores the maximum here and no time
        if (state.nonessential && (flags & 64) !== 0) data.max = value;
        else data.time = value;
    }
    if ((flags & 16) !== 0) data.mix = (flags & 32) !== 0 ? input.readFloat() : 1;
    if ((flags & 64) !== 0) {
        data.local = (flags & 128) !== 0;
        data.bone = readIndex(input, state.boneCount, 'bone');
        data.propertyOffset = input.readFloat();
        data.property = readProperty(input);
        data.offset = input.readFloat();
        data.scale = input.readFloat();
    }

    return data;
}

function readConstraint(state: ImportState): ConstraintData {
    const input = state.input;
    const name = readName(input, 'A constraint');
    const type = input.readByte();

    switch (type) {
        case CONSTRAINT_IK:
            return readIk(input, name, state.boneCount);
        case CONSTRAINT_TRANSFORM:
            return readTransform(input, name, state.boneCount);
        case CONSTRAINT_PATH:
            return readPath(input, name, state);
        case CONSTRAINT_PHYSICS:
            return readPhysics(input, name, state.boneCount);
        case CONSTRAINT_SLIDER:
            return readSlider(input, name, state);
        default:
            throw invalid(`Constraint "${name}" has type ${type}, which Spine 4.3 does not have.`);
    }
}

/** Reads every constraint, in the order the file stores them. */
export function readConstraints(state: ImportState): ConstraintData[] {
    const constraints: ConstraintData[] = [];

    for (let i = 0, n = state.input.readInt(true); i < n; i++) constraints.push(readConstraint(state));

    return constraints;
}

/** Reads the animation of every slider. The file stores these after the animations. */
export function resolveSliders(state: ImportState, animationCount: number): void {
    for (const constraint of state.constraints) {
        if (constraint.type === 'slider') constraint.animation = readIndex(state.input, animationCount, 'animation');
    }
}
