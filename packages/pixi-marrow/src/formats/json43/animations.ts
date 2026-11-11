import type { AnimationData } from '../../model/model';
import { type ImportContext, invalid } from './context';
import type { JsonAnimation } from './schema';
import { readAttachmentTimelines } from './timelines-attachment';
import {
    readIkTimelines,
    readPathTimelines,
    readPhysicsTimelines,
    readSliderTimelines,
    readTransformTimelines,
} from './timelines-constraint';
import type { TimelineSink } from './timelines-curve';
import { readDrawOrderFolderTimelines, readDrawOrderTimeline, readEventTimeline } from './timelines-order';
import { readBoneTimelines, readSlotTimelines } from './timelines-slot-bone';

/** Reads one animation. The timelines come in the order the official parser creates them. */
function readAnimation(name: string, map: JsonAnimation, ctx: ImportContext): AnimationData {
    if (name === '') throw invalid('An animation has no name.');
    const sink: TimelineSink = { user: `Animation "${name}"`, timelines: [], duration: 0 };

    readSlotTimelines(sink, map.slots, ctx);
    readBoneTimelines(sink, map.bones, ctx);
    readIkTimelines(sink, map.ik, ctx);
    readTransformTimelines(sink, map.transform, ctx);
    readPathTimelines(sink, map.path, ctx);
    readPhysicsTimelines(sink, map.physics, ctx);
    readSliderTimelines(sink, map.slider, ctx);
    readAttachmentTimelines(sink, map.attachments, ctx);
    readDrawOrderTimeline(sink, map.drawOrder, ctx);
    readDrawOrderFolderTimelines(sink, map.drawOrderFolder, ctx);
    readEventTimeline(sink, map.events, ctx);

    return { name, duration: sink.duration, timelines: sink.timelines };
}

/** Reads `animations`, in file order. */
export function readAnimations(maps: Readonly<Record<string, JsonAnimation>>, ctx: ImportContext): AnimationData[] {
    return Object.entries(maps).map(([name, map], index) => {
        const animation = readAnimation(name, map, ctx);

        ctx.animations.add(name, index);

        return animation;
    });
}
