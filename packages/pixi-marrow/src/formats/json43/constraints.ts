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
} from '../../model/constraints';
import { enumName, type ImportContext, invalid, requireList, requireName } from './context';
import type {
    JsonConstraint,
    JsonIkConstraint,
    JsonPathConstraint,
    JsonPhysicsConstraint,
    JsonSliderConstraint,
    JsonTransformConstraint,
} from './schema';

const SCALE_Y_MODES: readonly ScaleYMode[] = ['none', 'uniform', 'volume'];
const POSITION_MODES: readonly PathConstraintData['positionMode'][] = ['fixed', 'percent'];
const SPACING_MODES: readonly PathConstraintData['spacingMode'][] = ['length', 'fixed', 'percent', 'proportional'];
const ROTATE_MODES: readonly PathConstraintData['rotateMode'][] = ['tangent', 'chain', 'chainScale'];
const TRANSFORM_PROPERTIES: readonly TransformProperty[] = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];

function boneList(names: readonly string[] | undefined, user: string, ctx: ImportContext): Int16Array {
    return Int16Array.from(requireList(names, `The bone list of ${user}`), (name) => ctx.bones.require(name, user));
}

function scaleYMode(value: string | undefined, user: string): ScaleYMode {
    return value == null ? 'none' : enumName(SCALE_Y_MODES, value, `The scale Y mode of ${user}`);
}

function transformProperty(name: string | undefined, user: string): TransformProperty {
    const property = TRANSFORM_PROPERTIES.find((known) => known === name);

    if (property === undefined) throw invalid(`${user} has the unknown property "${String(name)}".`);

    return property;
}

function readIk(map: JsonIkConstraint, name: string, skinRequired: boolean, ctx: ImportContext): IkConstraintData {
    const user = `IK constraint "${name}"`;

    return {
        type: 'ik',
        name,
        skinRequired,
        bones: boneList(map.bones, user, ctx),
        target: ctx.bones.require(map.target, user),
        scaleYMode: scaleYMode(map.scaleY, user),
        mix: map.mix ?? 1,
        softness: map.softness ?? 0,
        bendDirection: (map.bendPositive ?? true) ? 1 : -1,
        compress: map.compress ?? false,
        stretch: map.stretch ?? false,
    };
}

/**
 * Reads the property mappings of a transform constraint. A source property is kept only when it
 * feeds a target property. `mapped` receives every target property, which decides the mixes.
 */
function readTransformProperties(
    map: JsonTransformConstraint,
    user: string,
    mapped: Set<TransformProperty>,
): TransformFrom[] {
    const properties: TransformFrom[] = [];

    for (const [fromName, fromMap] of Object.entries(map.properties ?? {})) {
        const from: TransformFrom = {
            property: transformProperty(fromName, user),
            offset: fromMap.offset ?? 0,
            to: [],
        };

        for (const [toName, toMap] of Object.entries(fromMap.to ?? {})) {
            const property = transformProperty(toName, user);

            mapped.add(property);
            from.to.push({ property, offset: toMap.offset ?? 0, max: toMap.max ?? 1, scale: toMap.scale ?? 1 });
        }
        if (from.to.length > 0) properties.push(from);
    }

    return properties;
}

function readTransform(
    map: JsonTransformConstraint,
    name: string,
    skinRequired: boolean,
    ctx: ImportContext,
): TransformConstraintData {
    const user = `Transform constraint "${name}"`;
    const bones = boneList(map.bones, user, ctx);
    const source = ctx.bones.require(map.source, user);
    const mapped = new Set<TransformProperty>();
    const properties = readTransformProperties(map, user, mapped);
    // a mix stays 0 when no mapping writes its property, and Y falls back to X
    const mixX = mapped.has('x') ? (map.mixX ?? 1) : 0;
    const mixScaleX = mapped.has('scaleX') ? (map.mixScaleX ?? 1) : 0;

    return {
        type: 'transform',
        name,
        skinRequired,
        bones,
        source,
        localSource: map.localSource ?? false,
        localTarget: map.localTarget ?? false,
        additive: map.additive ?? false,
        clamp: map.clamp ?? false,
        properties,
        offsets: Float64Array.of(
            map.rotation ?? 0,
            map.x ?? 0,
            map.y ?? 0,
            map.scaleX ?? 0,
            map.scaleY ?? 0,
            map.shearY ?? 0,
        ),
        mixRotate: mapped.has('rotate') ? (map.mixRotate ?? 1) : 0,
        mixX,
        mixY: mapped.has('y') ? (map.mixY ?? mixX) : 0,
        mixScaleX,
        mixScaleY: mapped.has('scaleY') ? (map.mixScaleY ?? mixScaleX) : 0,
        mixShearY: mapped.has('shearY') ? (map.mixShearY ?? 1) : 0,
    };
}

function readPath(
    map: JsonPathConstraint,
    name: string,
    skinRequired: boolean,
    ctx: ImportContext,
): PathConstraintData {
    const user = `Path constraint "${name}"`;
    const mixX = map.mixX ?? 1;

    return {
        type: 'path',
        name,
        skinRequired,
        bones: boneList(map.bones, user, ctx),
        slot: ctx.slots.require(map.slot, user),
        positionMode: enumName(POSITION_MODES, map.positionMode ?? 'percent', `The position mode of ${user}`),
        spacingMode: enumName(SPACING_MODES, map.spacingMode ?? 'length', `The spacing mode of ${user}`),
        rotateMode: enumName(ROTATE_MODES, map.rotateMode ?? 'tangent', `The rotate mode of ${user}`),
        offsetRotation: map.rotation ?? 0,
        position: map.position ?? 0,
        spacing: map.spacing ?? 0,
        mixRotate: map.mixRotate ?? 1,
        mixX,
        mixY: map.mixY ?? mixX,
    };
}

function readPhysics(
    map: JsonPhysicsConstraint,
    name: string,
    skinRequired: boolean,
    ctx: ImportContext,
): PhysicsConstraintData {
    const user = `Physics constraint "${name}"`;

    return {
        type: 'physics',
        name,
        skinRequired,
        bone: ctx.bones.require(map.bone, user),
        x: map.x ?? 0,
        y: map.y ?? 0,
        rotate: map.rotate ?? 0,
        scaleX: map.scaleX ?? 0,
        scaleYMode: scaleYMode(map.scaleY, user),
        shearX: map.shearX ?? 0,
        limit: map.limit ?? 5000,
        step: 1 / (map.fps ?? 60),
        inertia: map.inertia ?? 0.5,
        strength: map.strength ?? 100,
        damping: map.damping ?? 0.85,
        massInverse: 1 / (map.mass ?? 1),
        wind: map.wind ?? 0,
        gravity: map.gravity ?? 0,
        mix: map.mix ?? 1,
        inertiaGlobal: map.inertiaGlobal ?? false,
        strengthGlobal: map.strengthGlobal ?? false,
        dampingGlobal: map.dampingGlobal ?? false,
        massGlobal: map.massGlobal ?? false,
        windGlobal: map.windGlobal ?? false,
        gravityGlobal: map.gravityGlobal ?? false,
        mixGlobal: map.mixGlobal ?? false,
    };
}

/**
 * Reads a slider without its animation, which {@link linkSliderAnimations} sets later.
 * A slider reads either a bone property or its own time, never both.
 */
function readSlider(
    map: JsonSliderConstraint,
    name: string,
    skinRequired: boolean,
    ctx: ImportContext,
): SliderConstraintData {
    const user = `Slider "${name}"`;
    const slider: SliderConstraintData = {
        type: 'slider',
        name,
        skinRequired,
        animation: -1,
        additive: map.additive ?? false,
        loop: map.loop ?? false,
        mix: map.mix ?? 1,
        time: 0,
        bone: -1,
        property: null,
        propertyOffset: 0,
        offset: 0,
        scale: 0,
        max: 0,
        local: false,
    };

    if (!map.bone) {
        slider.time = map.time ?? 0;

        return slider;
    }
    slider.bone = ctx.bones.require(map.bone, user);
    slider.property = transformProperty(map.property, user);
    slider.propertyOffset = map.from ?? 0;
    slider.offset = map.to ?? 0;
    slider.scale = map.scale ?? 1;
    slider.max = map.max ?? 0;
    slider.local = map.local ?? false;

    return slider;
}

function readConstraint(map: JsonConstraint, index: number, ctx: ImportContext): ConstraintData {
    const type: string = map.type;
    const name = requireName(map.name, `Constraint ${index}`);
    const skinRequired = map.skin ?? false;

    switch (map.type) {
        case 'ik':
            return readIk(map, name, skinRequired, ctx);
        case 'transform':
            return readTransform(map, name, skinRequired, ctx);
        case 'path':
            return readPath(map, name, skinRequired, ctx);
        case 'physics':
            return readPhysics(map, name, skinRequired, ctx);
        case 'slider':
            return readSlider(map, name, skinRequired, ctx);
        default:
            throw invalid(`Constraint "${name}" has the unknown type "${type}".`);
    }
}

/** Reads `constraints` into the one constraint list, in file order. */
export function readConstraints(maps: readonly JsonConstraint[], ctx: ImportContext): void {
    maps.forEach((map, index) => {
        ctx.addConstraint(readConstraint(map, index, ctx));
    });
}

/**
 * Sets the animation of every slider. It runs after the animations are read, because a slider
 * names its animation and the animations refer to the sliders.
 */
export function linkSliderAnimations(maps: readonly JsonConstraint[], ctx: ImportContext): void {
    for (const map of maps) {
        if (map.type !== 'slider') continue;
        const user = `Slider "${String(map.name)}"`;
        // the official parser looks the slider up by name again: the first one of that name gets the animation
        const slider = ctx.constraints[ctx.constraint('slider', map.name, user)];

        if (slider?.type === 'slider') slider.animation = ctx.animations.require(map.animation, user);
    }
}
