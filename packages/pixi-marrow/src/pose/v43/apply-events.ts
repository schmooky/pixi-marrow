import type { EventKey } from '../../model/timelines';
import { ANIMATION_TIME, SHARED, VALUES } from './curves';
import type { Entry } from './entry';
import { type Player43, queueComplete, queueEvent } from './player';
import { ROLE_EVENT, type Timeline43 } from './types';

/*
 * The events of an apply: those of the event timelines of an entry, also of one that plays in
 * reverse, and the `complete` of an entry.
 */

/** True when the entry completed its animation, or a loop of it, since it was last applied. */
function completed(entry: Entry): boolean {
    if (!entry.loop) {
        return Number(SHARED[ANIMATION_TIME]) >= entry.animationEnd && entry.animationLast < entry.animationEnd;
    }
    const duration = entry.animationEnd - entry.animationStart;

    if (duration === 0) return true;
    const cycles = Math.floor(entry.trackTime / duration);

    return cycles > 0 && cycles > Math.floor(entry.trackLast / duration);
}

/**
 * The official `queueEvents`: queues the events an entry fired and its `complete` call, in order.
 * The animation time of the entry is read from `SHARED`.
 */
export function queueEvents(player: Player43, entry: Entry): void {
    const { animationStart, animationEnd, reverse } = entry;
    const events = player.fired;
    const n = events.length;
    let i = 0;

    if (n > 0) {
        const duration = animationEnd - animationStart;
        const split = reverse ? duration - (entry.trackLast % duration) : entry.trackLast % duration;

        // the events before the animation completed
        for (; i < n; i++) {
            const event = events[i];

            if (event === undefined || event.time < split !== reverse) break;
            if (event.time >= animationStart && event.time <= animationEnd) queueEvent(player, entry, event);
        }
    }
    if (completed(entry)) queueComplete(player, entry);
    // the events after it
    for (; i < n; i++) {
        const event = events[i];

        if (event !== undefined && event.time >= animationStart && event.time <= animationEnd) {
            queueEvent(player, entry, event);
        }
    }
    if (n > 0) events.length = 0;
}

function pushEvent(events: EventKey[], timeline: Timeline43, index: number): void {
    const event = timeline.events[index];

    if (event !== undefined) events.push(event);
}

/**
 * The events of one event timeline that a reversed entry passed between two applies. The two
 * times are read from `SHARED`: the time of the last apply at `VALUES`, the time of this one after it.
 */
function reversedEvents(events: EventKey[], timeline: Timeline43): void {
    const frames = timeline.frames;
    const frameCount = frames.length;
    const from = Number(SHARED[VALUES]);
    const to = Number(SHARED[VALUES + 1]);
    let i = 0;

    if (from >= to) {
        for (; i < frameCount; i++) {
            const time = Number(frames[i]);

            if (time < to) continue;
            if (time >= from) break;
            pushEvent(events, timeline, i);
        }

        return;
    }
    // the animation looped: from the last apply down to 0, then from the end down to this apply
    for (; i < frameCount && !(Number(frames[i]) >= from); i++) pushEvent(events, timeline, i);
    i = 0;
    while (i < frameCount && !(Number(frames[i]) >= to)) i++;
    for (; i < frameCount; i++) pushEvent(events, timeline, i);
}

/** The official `eventsReverse`: collects the events of an entry that plays in reverse. */
export function eventsReverse(player: Player43, entry: Entry): void {
    const { duration, timelines } = entry.clip;

    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline?.role !== ROLE_EVENT) continue;
        SHARED[VALUES] = duration - entry.animationLast;
        SHARED[VALUES + 1] = duration - Number(SHARED[ANIMATION_TIME]);
        reversedEvents(player.fired, timeline);
    }
}
