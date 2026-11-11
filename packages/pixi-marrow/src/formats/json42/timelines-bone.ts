import { INHERIT_MODES } from '../../model/model';
import type { TimelineData, TimelineKind } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import { addTimeline, type SkeletonRefs, type TimelineSink } from './context';
import { type CurveLayout, pairLayout, readCurveTimeline, valueLayout } from './curves';
import type { JsonAnimation, JsonBoneKey, JsonValueKey } from './schema';
import { entries, enumIndex, list, lowerFirst, pick, resolve, unknownTimeline } from './values';

interface BoneTimeline {
    kind: TimelineKind;
    layout: CurveLayout<JsonValueKey>;
}

const VALUE_0 = valueLayout(0);
const VALUE_1 = valueLayout(1);
const PAIR_0 = pairLayout(0);
const PAIR_1 = pairLayout(1);

/** The curve timelines of a bone by their name in the file. Scale values default to 1, the others to 0. */
const BONE_TIMELINES: ReadonlyMap<string, BoneTimeline> = new Map<string, BoneTimeline>([
    ['rotate', { kind: 'rotate', layout: VALUE_0 }],
    ['translate', { kind: 'translate', layout: PAIR_0 }],
    ['translatex', { kind: 'translateX', layout: VALUE_0 }],
    ['translatey', { kind: 'translateY', layout: VALUE_0 }],
    ['scale', { kind: 'scale', layout: PAIR_1 }],
    ['scalex', { kind: 'scaleX', layout: VALUE_1 }],
    ['scaley', { kind: 'scaleY', layout: VALUE_1 }],
    ['shear', { kind: 'shear', layout: PAIR_0 }],
    ['shearx', { kind: 'shearX', layout: VALUE_0 }],
    ['sheary', { kind: 'shearY', layout: VALUE_0 }],
]);
const INHERIT_ENTRIES = 2;

/** Reads an inherit timeline: time and inherit mode per key, without curves. 4.2 only. */
function readInheritTimeline(keys: readonly JsonBoneKey[], bone: number, what: string): TimelineData {
    const writer = new TimelineWriter(keys.length, INHERIT_ENTRIES, null);

    keys.forEach((key, frame) => {
        writer.frames[frame * INHERIT_ENTRIES] = pick(key.time, 0);
        writer.frames[frame * INHERIT_ENTRIES + 1] = enumIndex(
            INHERIT_MODES,
            lowerFirst(pick(key.inherit, 'normal')),
            `A key of ${what}`,
        );
    });

    return { kind: 'inherit', target: bone, frames: writer.frames, curves: null };
}

/** Reads the bone timelines of an animation. Only 4.2 files have inherit timelines. */
export function readBoneTimelines(map: JsonAnimation, refs: SkeletonRefs, sink: TimelineSink): void {
    const known = [...BONE_TIMELINES.keys(), ...(refs.version === '4.2' ? ['inherit'] : [])];

    for (const [boneName, boneMap] of entries(map.bones, `The bone timelines of ${sink.user}`)) {
        const bone = resolve(refs.bones, boneName, 'bone', sink.user);

        for (const [name, timelineMap] of entries(
            boneMap,
            `The timelines of the bone "${boneName}" in the animation "${sink.name}"`,
        )) {
            const what = `The ${name} timeline of the bone "${boneName}" in the animation "${sink.name}"`;
            const keys = list(timelineMap, what);
            const curve = BONE_TIMELINES.get(name);

            // the official parser skips a timeline without keys
            if (keys.length === 0) continue;
            if (curve) {
                addTimeline(sink, readCurveTimeline(curve.kind, bone, keys, curve.layout, what), curve.layout.entries);
            } else if (name === 'inherit' && refs.version === '4.2') {
                addTimeline(sink, readInheritTimeline(keys, bone, what), INHERIT_ENTRIES);
            } else {
                throw unknownTimeline(name, what, known);
            }
        }
    }
}
