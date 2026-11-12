/*
 * What the scripts know about the animations of a rig: the length, whether events fire, how long
 * the longest timeline is and where some of its keys are, and which bones are keyed. And what they
 * know about its bones: which hang on which, which need a skin, and which a constraint writes or reads.
 */

/** What a script needs to know about an animation. */
export interface AnimationInfo {
    name: string;
    duration: number;
    /** Whether the animation has an event timeline. */
    events: boolean;
    /** How many keys the timeline with the most keys has. */
    keys: number;
    /** Key times of that timeline, in order: the first, the last and up to four between them. */
    times: number[];
    /** The bones the animation keys, in the order of the rig. */
    keyed: number[];
}

/** What a script needs to know about the bones of a rig. Bones are indices into the bone list. */
export interface BoneInfo {
    /** Per bone, its parent. -1 for the root bone. */
    parents: number[];
    /** The bones that need a skin: not active until a skin lists them. */
    skinBones: number[];
    /** The bones a constraint writes, each once, in the order of the constraints. */
    constrained: number[];
    /** The bones a constraint reads to pose others: IK targets, the sources of transform constraints, the bones of sliders. */
    sources: number[];
}

/** What `describeBones` reads of an official bone. Every version has these. */
interface OfficialBone {
    index: number;
    parent: { index: number } | null;
    skinRequired: boolean;
}

/** Describes the bones of an official skeleton for the scripts. `constrained` and `sources` may name a bone more than once. */
export function describeBones(
    bones: readonly OfficialBone[],
    constrained: readonly { index: number }[],
    sources: readonly ({ index: number } | null)[],
): BoneInfo {
    const once = (list: readonly ({ index: number } | null)[]): number[] => [
        ...new Set(list.flatMap((bone) => (bone === null ? [] : [bone.index]))),
    ];

    return {
        parents: bones.map((bone) => bone.parent?.index ?? -1),
        skinBones: bones.filter((bone) => bone.skinRequired).map((bone) => bone.index),
        constrained: once(constrained),
        sources: once(sources),
    };
}

/** What `describeAnimation` reads of an official timeline. Every version has these. */
interface OfficialTimeline {
    frames: ArrayLike<number>;
    getFrameEntries(): number;
    getFrameCount(): number;
}

/** Up to six of the key times of a timeline, evenly picked, the first and the last among them. */
function someKeyTimes(timeline: OfficialTimeline): number[] {
    const count = timeline.getFrameCount();
    const picked = Array.from({ length: Math.min(count, 6) }, (_, i) => Math.round((i * (count - 1)) / 5));

    return [...new Set(picked)].map((key) => timeline.frames[key * timeline.getFrameEntries()] ?? 0);
}

/** Describes an official animation for the scripts. `kind` names the kind of a timeline. */
export function describeAnimation(
    animation: { name: string; duration: number; timelines: readonly OfficialTimeline[] },
    kind: (timeline: OfficialTimeline) => string,
): AnimationInfo {
    const { name, duration, timelines } = animation;
    const keyed = new Set<number>();
    let longest: OfficialTimeline | undefined;

    for (const timeline of timelines) {
        if (longest === undefined || timeline.getFrameCount() > longest.getFrameCount()) longest = timeline;
        if ('boneIndex' in timeline && typeof timeline.boneIndex === 'number') keyed.add(timeline.boneIndex);
    }

    return {
        name,
        duration,
        events: timelines.some((timeline) => kind(timeline) === 'event'),
        keys: longest?.getFrameCount() ?? 0,
        times: longest ? someKeyTimes(longest) : [],
        keyed: [...keyed].sort((a, b) => a - b),
    };
}
