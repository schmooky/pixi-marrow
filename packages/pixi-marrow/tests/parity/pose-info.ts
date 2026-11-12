/*
 * What the scripts know about the animations of a rig: the length, whether events fire, how long
 * the longest timeline is and where some of its keys are, and how many bones are keyed.
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
    /** How many bones the animation keys. */
    bones: number;
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
    const bones = new Set<unknown>();
    let longest: OfficialTimeline | undefined;

    for (const timeline of timelines) {
        if (longest === undefined || timeline.getFrameCount() > longest.getFrameCount()) longest = timeline;
        if ('boneIndex' in timeline) bones.add(timeline.boneIndex);
    }

    return {
        name,
        duration,
        events: timelines.some((timeline) => kind(timeline) === 'event'),
        keys: longest?.getFrameCount() ?? 0,
        times: longest ? someKeyTimes(longest) : [],
        bones: bones.size,
    };
}
