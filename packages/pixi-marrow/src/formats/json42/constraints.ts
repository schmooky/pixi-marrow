import type {
    ConstraintData,
    IkConstraintData,
    PathConstraintData,
    PhysicsConstraintData,
    TransformConstraintData,
} from '../../model/constraints';
import type { ConstraintRefs, Json42Version } from './context';
import type {
    JsonConstraint,
    JsonIkConstraint,
    JsonPathConstraint,
    JsonPhysicsConstraint,
    JsonRoot,
    JsonTransformConstraint,
} from './schema';
import {
    enumName,
    indexNames,
    list,
    lowerFirst,
    type NameIndex,
    pick,
    requireList,
    requireName,
    resolve,
} from './values';

const POSITION_MODES = ['fixed', 'percent'] as const;
const SPACING_MODES = ['length', 'fixed', 'percent', 'proportional'] as const;
const ROTATE_MODES = ['tangent', 'chain', 'chainScale'] as const;

/** The constraints of a file in the order of the model, with the lookups from name to index. */
export interface ConstraintSet {
    list: ConstraintData[];
    refs: ConstraintRefs;
}

interface Base {
    name: string;
    skinRequired: boolean;
    order: number;
}

function readBase(map: JsonConstraint, what: string): Base {
    return { name: requireName(map.name, what), skinRequired: pick(map.skin, false), order: pick(map.order, 0) };
}

function boneList(boneNames: string[] | undefined, bones: NameIndex, user: string): Int16Array {
    return Int16Array.from(requireList(boneNames, `The "bones" list of ${user}`), (bone) =>
        resolve(bones, bone, 'bone', user),
    );
}

function readIk(map: JsonIkConstraint, i: number, bones: NameIndex): IkConstraintData {
    const base = readBase(map, `IK constraint ${i}`);
    const user = `The IK constraint "${base.name}"`;

    return {
        type: 'ik',
        ...base,
        bones: boneList(map.bones, bones, user),
        target: resolve(bones, map.target, 'bone', user),
        mix: pick(map.mix, 1),
        softness: pick(map.softness, 0),
        bendDirection: pick(map.bendPositive, true) ? 1 : -1,
        compress: pick(map.compress, false),
        stretch: pick(map.stretch, false),
        uniform: pick(map.uniform, false),
    };
}

function readTransform(map: JsonTransformConstraint, i: number, bones: NameIndex): TransformConstraintData {
    const base = readBase(map, `Transform constraint ${i}`);
    const user = `The transform constraint "${base.name}"`;
    const mixX = pick(map.mixX, 1);
    const mixScaleX = pick(map.mixScaleX, 1);

    return {
        type: 'transform',
        ...base,
        bones: boneList(map.bones, bones, user),
        source: resolve(bones, map.target, 'bone', user),
        local: pick(map.local, false),
        relative: pick(map.relative, false),
        offsets: Float32Array.of(
            pick(map.rotation, 0),
            pick(map.x, 0),
            pick(map.y, 0),
            pick(map.scaleX, 0),
            pick(map.scaleY, 0),
            pick(map.shearY, 0),
        ),
        mixRotate: pick(map.mixRotate, 1),
        mixX,
        mixY: pick(map.mixY, mixX),
        mixScaleX,
        mixScaleY: pick(map.mixScaleY, mixScaleX),
        mixShearY: pick(map.mixShearY, 1),
    };
}

function readPath(map: JsonPathConstraint, i: number, bones: NameIndex, slots: NameIndex): PathConstraintData {
    const base = readBase(map, `Path constraint ${i}`);
    const user = `The path constraint "${base.name}"`;
    const mixX = pick(map.mixX, 1);

    return {
        type: 'path',
        ...base,
        bones: boneList(map.bones, bones, user),
        slot: resolve(slots, map.target, 'slot', user),
        positionMode: enumName(
            POSITION_MODES,
            lowerFirst(pick(map.positionMode, 'percent')),
            `The position mode of ${user}`,
        ),
        spacingMode: enumName(
            SPACING_MODES,
            lowerFirst(pick(map.spacingMode, 'length')),
            `The spacing mode of ${user}`,
        ),
        rotateMode: enumName(ROTATE_MODES, lowerFirst(pick(map.rotateMode, 'tangent')), `The rotate mode of ${user}`),
        offsetRotation: pick(map.rotation, 0),
        position: pick(map.position, 0),
        spacing: pick(map.spacing, 0),
        mixRotate: pick(map.mixRotate, 1),
        mixX,
        mixY: pick(map.mixY, mixX),
    };
}

function readPhysics(map: JsonPhysicsConstraint, i: number, bones: NameIndex): PhysicsConstraintData {
    const base = readBase(map, `Physics constraint ${i}`);

    return {
        type: 'physics',
        ...base,
        bone: resolve(bones, map.bone, 'bone', `The physics constraint "${base.name}"`),
        x: pick(map.x, 0),
        y: pick(map.y, 0),
        rotate: pick(map.rotate, 0),
        scaleX: pick(map.scaleX, 0),
        shearX: pick(map.shearX, 0),
        limit: pick(map.limit, 5000),
        step: 1 / pick(map.fps, 60),
        inertia: pick(map.inertia, 1),
        strength: pick(map.strength, 100),
        damping: pick(map.damping, 1),
        massInverse: 1 / pick(map.mass, 1),
        wind: pick(map.wind, 0),
        gravity: pick(map.gravity, 0),
        mix: pick(map.mix, 1),
        inertiaGlobal: pick(map.inertiaGlobal, false),
        strengthGlobal: pick(map.strengthGlobal, false),
        dampingGlobal: pick(map.dampingGlobal, false),
        massGlobal: pick(map.massGlobal, false),
        windGlobal: pick(map.windGlobal, false),
        gravityGlobal: pick(map.gravityGlobal, false),
        mixGlobal: pick(map.mixGlobal, false),
    };
}

const nameIndex = (constraints: readonly { name: string }[]): NameIndex =>
    indexNames(constraints.map((constraint) => constraint.name));

/**
 * Reads the constraints into one list: IK first, then transform, path and physics constraints,
 * each kind in file order. Only 4.2 files have physics constraints.
 */
export function readConstraints(
    root: JsonRoot,
    bones: NameIndex,
    slots: NameIndex,
    version: Json42Version,
): ConstraintSet {
    const ik = list(root.ik, 'The "ik" entry').map((map, i) => readIk(map, i, bones));
    const transform = list(root.transform, 'The "transform" entry').map((map, i) => readTransform(map, i, bones));
    const path = list(root.path, 'The "path" entry').map((map, i) => readPath(map, i, bones, slots));
    const physics =
        version === '4.2' ? list(root.physics, 'The "physics" entry').map((map, i) => readPhysics(map, i, bones)) : [];

    return {
        list: [...ik, ...transform, ...path, ...physics],
        refs: {
            ik: nameIndex(ik),
            transform: nameIndex(transform),
            path: nameIndex(path),
            physics: nameIndex(physics),
            transformOffset: ik.length,
            pathOffset: ik.length + transform.length,
            physicsOffset: ik.length + transform.length + path.length,
        },
    };
}
