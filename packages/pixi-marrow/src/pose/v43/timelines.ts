import type { EventKey } from '../../model/timelines';
import { applyInherit, applyPair, applyRelative, applyScale, applyScalePair } from './timelines-bone';
import { applyConstraintMixes, applyConstraintValue, applyIkConstraint } from './timelines-constraint';
import { applyDeform } from './timelines-deform';
import { applyDrawOrder, applyDrawOrderFolder, applyEvent, applySequence } from './timelines-misc';
import { applyAlpha, applyAttachment, applyColor, applyColorWithoutDark } from './timelines-slot';
import {
    OP_ALPHA,
    OP_ATTACHMENT,
    OP_COLOR,
    OP_DEFORM,
    OP_DRAW_ORDER,
    OP_EVENT,
    OP_FOLDER,
    OP_IK,
    OP_INHERIT,
    OP_MIXES,
    OP_NO_DARK,
    OP_PAIR,
    OP_RELATIVE,
    OP_SCALE,
    OP_SCALE_PAIR,
    OP_SEQUENCE,
    OP_VALUE,
    type Pose43,
    type Timeline43,
} from './types';

/**
 * Applies one timeline to a pose: the official `Timeline.apply`, without the applied pose flag,
 * because this engine writes the animated pose only. The official `lastTime`, `time` and `alpha`
 * are read from `SHARED`. Set them with `setClock`.
 *
 * Every kernel is called by name. V8 can inline such a call. It cannot inline a call through a
 * field of the timeline, which is a different function from one timeline to the next.
 *
 * @param events Where an event timeline puts the events it passes. Null to leave them out.
 * @param from The official `MixFrom`. One of `CURRENT`, `SETUP` and `FIRST`.
 * @param add The official `add`. True to add the values of an additive timeline to the pose.
 * @param out The official `out`. True while the entry of the timeline is mixed out.
 */
export function applyTimeline(
    pose: Pose43,
    timeline: Timeline43,
    events: EventKey[] | null,
    from: number,
    add: boolean,
    out: boolean,
): void {
    switch (timeline.op) {
        case OP_RELATIVE:
            applyRelative(pose, timeline, from, add);
            break;
        case OP_PAIR:
            applyPair(pose, timeline, from, add);
            break;
        case OP_SCALE_PAIR:
            applyScalePair(pose, timeline, from, add, out);
            break;
        case OP_SCALE:
            applyScale(pose, timeline, from, add, out);
            break;
        case OP_COLOR:
            applyColor(pose, timeline, from);
            break;
        case OP_ALPHA:
            applyAlpha(pose, timeline, from);
            break;
        case OP_ATTACHMENT:
            applyAttachment(pose, timeline, from, out);
            break;
        case OP_DEFORM:
            applyDeform(pose, timeline, from, add);
            break;
        case OP_SEQUENCE:
            applySequence(pose, timeline, from, out);
            break;
        case OP_EVENT:
            applyEvent(timeline, events);
            break;
        case OP_DRAW_ORDER:
            applyDrawOrder(pose, timeline, from, out);
            break;
        case OP_FOLDER:
            applyDrawOrderFolder(pose, timeline, from, out);
            break;
        case OP_INHERIT:
            applyInherit(pose, timeline, from, out);
            break;
        case OP_IK:
            applyIkConstraint(pose, timeline, from, out);
            break;
        case OP_MIXES:
            applyConstraintMixes(pose, timeline, from, add);
            break;
        case OP_VALUE:
            applyConstraintValue(pose, timeline, from, add);
            break;
        case OP_NO_DARK:
            applyColorWithoutDark(pose, timeline);
            break;
        // OP_NOTHING: a timeline of a constraint that is not solved changes nothing
    }
}
