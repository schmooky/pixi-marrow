import type { AnimationData } from '../../model/model';
import { type ImportState, readName } from './reader';
import { readAttachmentTimelines } from './timelines-attachment';
import {
    readIkAndTransformTimelines,
    readPathTimelines,
    readPhysicsTimelines,
    readSliderTimelines,
} from './timelines-constraint';
import type { TimelineSink } from './timelines-curve';
import { readDrawOrderTimelines, readEventTimeline } from './timelines-order';
import { readBoneTimelines, readSlotTimelines } from './timelines-slot-bone';

/** Reads one animation. The timelines come out in the order the official reader adds them. */
function readAnimation(state: ImportState, name: string): AnimationData {
    const sink: TimelineSink = { timelines: [], duration: 0 };

    // the number of timelines, which no reader needs
    state.input.readInt(true);
    readSlotTimelines(state, sink);
    readBoneTimelines(state, sink);
    readIkAndTransformTimelines(state, sink);
    readPathTimelines(state, sink);
    readPhysicsTimelines(state, sink);
    readSliderTimelines(state, sink);
    readAttachmentTimelines(state, sink);
    readDrawOrderTimelines(state, sink);
    readEventTimeline(state, sink);
    // the animation color
    if (state.nonessential) state.input.readInt32();

    return { name, duration: sink.duration, timelines: sink.timelines };
}

/** Reads every animation, in file order. */
export function readAnimations(state: ImportState): AnimationData[] {
    const animations: AnimationData[] = [];

    for (let i = 0, n = state.input.readInt(true); i < n; i++) {
        animations.push(readAnimation(state, readName(state.input, 'An animation')));
    }

    return animations;
}
