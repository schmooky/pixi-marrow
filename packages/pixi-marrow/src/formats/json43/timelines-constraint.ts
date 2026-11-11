import type { TimelineKind } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import type { ImportContext } from './context';
import type { JsonAnimation, JsonPathKey, JsonValueKey } from './schema';
import {
    addTimeline,
    readCurveTimeline,
    readValueTimeline,
    type TimelineSink,
    unknownTimeline,
} from './timelines-curve';

/** Reads the `ik` timelines of an animation. Only mix and softness have curves. */
export function readIkTimelines(sink: TimelineSink, map: JsonAnimation['ik'], ctx: ImportContext): void {
    for (const [name, keys] of Object.entries(map ?? {})) {
        if (!keys[0]) continue;
        readCurveTimeline(sink, 'ikConstraint', ctx.constraint('ik', name, sink.user), keys, 6, 2, (key, out) => {
            out[0] = key.time ?? 0;
            out[1] = key.mix ?? 1;
            out[2] = key.softness ?? 0;
            out[3] = (key.bendPositive ?? true) ? 1 : -1;
            out[4] = key.compress ? 1 : 0;
            out[5] = key.stretch ? 1 : 0;
        });
    }
}

/** Reads the `transform` timelines of an animation. */
export function readTransformTimelines(sink: TimelineSink, map: JsonAnimation['transform'], ctx: ImportContext): void {
    for (const [name, keys] of Object.entries(map ?? {})) {
        if (!keys[0]) continue;
        const index = ctx.constraint('transform', name, sink.user);

        readCurveTimeline(sink, 'transformConstraint', index, keys, 7, 6, (key, out) => {
            const mixX = key.mixX ?? 1;

            out[0] = key.time ?? 0;
            out[1] = key.mixRotate ?? 1;
            out[2] = mixX;
            out[3] = key.mixY ?? mixX;
            out[4] = key.mixScaleX ?? 1;
            // unlike the setup value, a key does not fall back to its scale X mix
            out[5] = key.mixScaleY ?? 1;
            out[6] = key.mixShearY ?? 1;
        });
    }
}

function readPathTimeline(sink: TimelineSink, name: string, keys: readonly JsonPathKey[], index: number): void {
    switch (name) {
        case 'position':
            readValueTimeline(sink, 'pathConstraintPosition', index, keys, 0);
            break;
        case 'spacing':
            readValueTimeline(sink, 'pathConstraintSpacing', index, keys, 0);
            break;
        case 'mix':
            readCurveTimeline(sink, 'pathConstraintMix', index, keys, 4, 3, (key, out) => {
                const mixX = key.mixX ?? 1;

                out[0] = key.time ?? 0;
                out[1] = key.mixRotate ?? 1;
                out[2] = mixX;
                out[3] = key.mixY ?? mixX;
            });
            break;
        default:
            throw unknownTimeline(name, sink.user);
    }
}

/** Reads the `path` timelines of an animation. */
export function readPathTimelines(sink: TimelineSink, map: JsonAnimation['path'], ctx: ImportContext): void {
    for (const [constraintName, timelines] of Object.entries(map ?? {})) {
        const index = ctx.constraint('path', constraintName, sink.user);

        for (const [name, keys] of Object.entries(timelines)) {
            if (keys[0]) readPathTimeline(sink, name, keys, index);
        }
    }
}

/** Physics timelines with one value per key: the kind and the value of a key that stores none. */
const PHYSICS_TIMELINES: ReadonlyMap<string, readonly [TimelineKind, number]> = new Map([
    ['inertia', ['physicsConstraintInertia', 0]],
    ['strength', ['physicsConstraintStrength', 0]],
    ['damping', ['physicsConstraintDamping', 0]],
    ['mass', ['physicsConstraintMass', 0]],
    ['wind', ['physicsConstraintWind', 0]],
    ['gravity', ['physicsConstraintGravity', 0]],
    ['mix', ['physicsConstraintMix', 1]],
]);

function readPhysicsTimeline(sink: TimelineSink, name: string, keys: readonly JsonValueKey[], index: number): void {
    if (name === 'reset') {
        const writer = new TimelineWriter(keys.length, 1, null);

        keys.forEach((key, frame) => {
            writer.frames[frame] = key.time ?? 0;
        });
        addTimeline(sink, { kind: 'physicsConstraintReset', target: index, frames: writer.frames, curves: null }, 1);

        return;
    }
    const timeline = PHYSICS_TIMELINES.get(name);

    if (!timeline) throw unknownTimeline(name, sink.user);
    readValueTimeline(sink, timeline[0], index, keys, timeline[1]);
}

/** Reads the `physics` timelines of an animation. The name `""` stands for every physics constraint. */
export function readPhysicsTimelines(sink: TimelineSink, map: JsonAnimation['physics'], ctx: ImportContext): void {
    for (const [constraintName, timelines] of Object.entries(map ?? {})) {
        const index = constraintName.length > 0 ? ctx.constraint('physics', constraintName, sink.user) : -1;

        for (const [name, keys] of Object.entries(timelines)) {
            if (keys[0]) readPhysicsTimeline(sink, name, keys, index);
        }
    }
}

/** Reads the `slider` timelines of an animation. */
export function readSliderTimelines(sink: TimelineSink, map: JsonAnimation['slider'], ctx: ImportContext): void {
    for (const [constraintName, timelines] of Object.entries(map ?? {})) {
        const index = ctx.constraint('slider', constraintName, sink.user);

        for (const [name, keys] of Object.entries(timelines)) {
            if (!keys[0]) continue;
            if (name === 'time') readValueTimeline(sink, 'slider', index, keys, 1);
            else if (name === 'mix') readValueTimeline(sink, 'sliderMix', index, keys, 1);
            else throw unknownTimeline(name, sink.user);
        }
    }
}
