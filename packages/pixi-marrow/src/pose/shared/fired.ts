import type { EventKey } from '../../model/timelines';

/**
 * The event keys that the timelines of one entry fired, until the player queues them.
 *
 * The list has a count of its own, and only the first `count` keys are in it. A list that is
 * emptied with `length = 0` loses the room V8 gave it, so the next event would allocate that room
 * again. An update must allocate only what it reports.
 */
export interface Fired {
    readonly keys: EventKey[];
    count: number;
}

/** An empty list of fired events. */
export function createFired(): Fired {
    return { keys: [], count: 0 };
}
