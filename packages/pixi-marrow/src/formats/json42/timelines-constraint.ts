import type { TimelineData, TimelineKind } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import { addTimeline, type SkeletonRefs, type TimelineSink } from './context';
import { type CurveLayout, readCurveTimeline, valueLayout } from './curves';
import type { JsonAnimation, JsonIkKey, JsonMixKey, JsonPathTimelines, JsonValueKey } from './schema';
import { entries, list, names, pick, resolve, unknownTimeline } from './values';

const VALUE = valueLayout(0);
const PATH_TIMELINES: readonly string[] = ['position', 'spacing', 'mix'];

/** Time, then mix, softness, bend direction, compress and stretch. Only mix and softness have curves. */
const IK: CurveLayout<JsonIkKey> = {
    entries: 6,
    curved: 2,
    read(key, out) {
        out[0] = pick(key.mix, 1);
        out[1] = pick(key.softness, 0);
        out[2] = pick(key.bendPositive, true) ? 1 : -1;
        out[3] = pick(key.compress, false) ? 1 : 0;
        out[4] = pick(key.stretch, false) ? 1 : 0;
    },
};

function readTransformMixes(key: JsonMixKey, out: Float64Array): void {
    const mixX = pick(key.mixX, 1);
    const mixScaleX = pick(key.mixScaleX, 1);

    out[0] = pick(key.mixRotate, 1);
    out[1] = mixX;
    out[2] = pick(key.mixY, mixX);
    out[3] = mixScaleX;
    out[4] = pick(key.mixScaleY, mixScaleX);
    out[5] = pick(key.mixShearY, 1);
}

/** Time, then the six mixes: rotate, x, y, scaleX, scaleY, shearY. */
const TRANSFORM: CurveLayout<JsonMixKey> = { entries: 7, curved: 6, read: readTransformMixes };

/**
 * The 4.1 layout. The official 4.1 parser never moves on from the shearY mix of the first key:
 * every key stores it, and every curve of that mix starts from it. 4.1 files must be read the same way.
 */
const TRANSFORM_41: CurveLayout<JsonMixKey> = { ...TRANSFORM, frozen: 5 };

/** Time, then the rotate, x and y mixes. */
const PATH_MIX: CurveLayout<JsonMixKey> = {
    entries: 4,
    curved: 3,
    read(key, out) {
        const mixX = pick(key.mixX, 1);

        out[0] = pick(key.mixRotate, 1);
        out[1] = mixX;
        out[2] = pick(key.mixY, mixX);
    },
};

/** The curve timelines of a physics constraint by their name in the file. */
const PHYSICS_TIMELINES: ReadonlyMap<string, TimelineKind> = new Map<string, TimelineKind>([
    ['inertia', 'physicsConstraintInertia'],
    ['strength', 'physicsConstraintStrength'],
    ['damping', 'physicsConstraintDamping'],
    ['mass', 'physicsConstraintMass'],
    ['wind', 'physicsConstraintWind'],
    ['gravity', 'physicsConstraintGravity'],
    ['mix', 'physicsConstraintMix'],
]);

/** Reads the IK constraint timelines of an animation. */
export function readIkTimelines(map: JsonAnimation, refs: SkeletonRefs, sink: TimelineSink): void {
    for (const [name, timelineMap] of entries(map.ik, `The IK timelines of ${sink.user}`)) {
        const what = `The timeline of the IK constraint "${name}" in the animation "${sink.name}"`;
        const keys = list(timelineMap, what);

        // the official parser skips a timeline without keys before it looks up the constraint
        if (keys.length === 0) continue;
        const target = resolve(refs.constraints.ik, name, 'IK constraint', sink.user);

        addTimeline(sink, readCurveTimeline('ikConstraint', target, keys, IK, what), IK.entries);
    }
}

/** Reads the transform constraint timelines of an animation. */
export function readTransformTimelines(map: JsonAnimation, refs: SkeletonRefs, sink: TimelineSink): void {
    const { constraints } = refs;
    const layout = refs.version === '4.1' ? TRANSFORM_41 : TRANSFORM;

    for (const [name, timelineMap] of entries(map.transform, `The transform timelines of ${sink.user}`)) {
        const what = `The timeline of the transform constraint "${name}" in the animation "${sink.name}"`;
        const keys = list(timelineMap, what);

        if (keys.length === 0) continue;
        const target =
            constraints.transformOffset + resolve(constraints.transform, name, 'transform constraint', sink.user);

        addTimeline(sink, readCurveTimeline('transformConstraint', target, keys, layout, what), layout.entries);
    }
}

function readPathTimeline(name: string, map: JsonPathTimelines, target: number, what: string): TimelineData | null {
    switch (name) {
        case 'position':
            return map.position?.length
                ? readCurveTimeline('pathConstraintPosition', target, map.position, VALUE, what)
                : null;
        case 'spacing':
            return map.spacing?.length
                ? readCurveTimeline('pathConstraintSpacing', target, map.spacing, VALUE, what)
                : null;
        case 'mix':
            return map.mix?.length ? readCurveTimeline('pathConstraintMix', target, map.mix, PATH_MIX, what) : null;
        default:
            throw unknownTimeline(name, what, PATH_TIMELINES);
    }
}

/** Reads the path constraint timelines of an animation: position, spacing and mix. */
export function readPathTimelines(map: JsonAnimation, refs: SkeletonRefs, sink: TimelineSink): void {
    const { constraints } = refs;

    for (const [constraintName, constraintMap] of entries(map.path, `The path timelines of ${sink.user}`)) {
        const target = constraints.pathOffset + resolve(constraints.path, constraintName, 'path constraint', sink.user);

        for (const name of names(constraintMap, `The timelines of the path constraint "${constraintName}"`)) {
            const what = `The ${name} timeline of the path constraint "${constraintName}" in the animation "${sink.name}"`;
            const timeline = readPathTimeline(name, constraintMap, target, what);

            if (timeline) addTimeline(sink, timeline, name === 'mix' ? PATH_MIX.entries : VALUE.entries);
        }
    }
}

/** Reads a reset timeline: one time per key, without curves. */
function readResetTimeline(keys: readonly JsonValueKey[], target: number): TimelineData {
    const writer = new TimelineWriter(keys.length, 1, null);

    keys.forEach((key, frame) => {
        writer.frames[frame] = pick(key.time, 0);
    });

    return { kind: 'physicsConstraintReset', target, frames: writer.frames, curves: null };
}

/**
 * Reads the physics constraint timelines of an animation. 4.2 only.
 * Timelines under an empty constraint name apply to every physics constraint and get the target -1.
 */
export function readPhysicsTimelines(map: JsonAnimation, refs: SkeletonRefs, sink: TimelineSink): void {
    const { constraints } = refs;
    const known = ['reset', ...PHYSICS_TIMELINES.keys()];

    for (const [constraintName, constraintMap] of entries(map.physics, `The physics timelines of ${sink.user}`)) {
        const target =
            constraintName.length > 0
                ? constraints.physicsOffset +
                  resolve(constraints.physics, constraintName, 'physics constraint', sink.user)
                : -1;

        for (const [name, timelineMap] of entries(constraintMap, `The physics timelines of ${sink.user}`)) {
            const what = `The ${name} timeline of the physics constraint "${constraintName}" in the animation "${sink.name}"`;
            const keys = list(timelineMap, what);
            const kind = PHYSICS_TIMELINES.get(name);

            if (keys.length === 0) continue;
            if (name === 'reset') addTimeline(sink, readResetTimeline(keys, target), 1);
            else if (kind) addTimeline(sink, readCurveTimeline(kind, target, keys, VALUE, what), VALUE.entries);
            else throw unknownTimeline(name, what, known);
        }
    }
}
