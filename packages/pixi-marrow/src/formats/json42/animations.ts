import type { AnimationData } from '../../model/model';
import type { AnimationRefs, TimelineSink } from './context';
import type { JsonAnimation, JsonRoot } from './schema';
import { readAttachmentTimelines } from './timelines-attachment';
import { readBoneTimelines } from './timelines-bone';
import {
    readIkTimelines,
    readPathTimelines,
    readPhysicsTimelines,
    readTransformTimelines,
} from './timelines-constraint';
import { readDrawOrderTimeline, readEventTimeline } from './timelines-order';
import { readSlotTimelines } from './timelines-slot';
import { entries, invalid } from './values';

/**
 * Reads one animation. The timelines come in the order the official parser adds them: slots,
 * bones, IK, transform, path, physics, attachments, draw order, events.
 */
function readAnimation(name: string, map: JsonAnimation, refs: AnimationRefs): AnimationData {
    if (name === '') throw invalid('An animation has an empty name.');
    const sink: TimelineSink = { name, user: `The animation "${name}"`, timelines: [], duration: 0 };

    readSlotTimelines(map, refs, sink);
    readBoneTimelines(map, refs, sink);
    readIkTimelines(map, refs, sink);
    readTransformTimelines(map, refs, sink);
    readPathTimelines(map, refs, sink);
    if (refs.version === '4.2') readPhysicsTimelines(map, refs, sink);
    readAttachmentTimelines(map, refs, sink);
    readDrawOrderTimeline(map, refs, sink);
    readEventTimeline(map, refs, sink);

    return { name, duration: sink.duration, timelines: sink.timelines };
}

/** Reads `animations` in file order. */
export function readAnimations(root: JsonRoot, refs: AnimationRefs): AnimationData[] {
    return entries(root.animations, 'The "animations" entry').map(([name, map]) => readAnimation(name, map, refs));
}
