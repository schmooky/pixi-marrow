import type { EventKey } from '../../model/timelines';
import type { PoseEvent, PoseEventType } from '../engine';
import { Entry } from './entry';
import type { Pose43 } from './types';

const START = 0;
const INTERRUPT = 1;
const END = 2;
const DISPOSE = 3;
const COMPLETE = 4;
const EVENT = 5;

/** The tracks of one engine and what plays on them: the fields of the official `AnimationState`. */
export interface Player43 {
    readonly pose: Pose43;
    /** The current entry of each track, or null. */
    readonly tracks: (Entry | null)[];
    timeScale: number;
    /** The official `AnimationStateData.defaultMix`. */
    defaultMix: number;
    /** The official `animationToMixTime`: mix durations by the names of two animations. */
    readonly mixes: Map<string, number>;
    /** The official `unkeyedState`: a counter that tells the attachment states of this apply from older ones. */
    unkeyedState: number;
    /** The official `attachmentState` of each slot. */
    readonly attachmentStates: Float64Array;
    /** The events the timelines of one entry fired, until they are queued. */
    readonly fired: EventKey[];
    /** True when entries started or ended since the timeline modes were computed. */
    animationsChanged: boolean;
    /** Entries that ended, for reuse. The official `trackEntryPool`. */
    readonly pool: Entry[];
    /** The official `EventQueue`, as three lists of the same length. */
    readonly queueTypes: number[];
    readonly queueEntries: Entry[];
    readonly queueKeys: (EventKey | null)[];
    drainDisabled: boolean;
    /** The listener calls since the last `takeEvents`. */
    listened: PoseEvent[];
    /**
     * The entry of track 0 when the last apply was that entry alone, replacing the setup pose.
     * Applied again at the same time it writes the same pose, so the apply can be left out.
     */
    rested: Entry | null;
    /** The official `applyTime` of the entry that was applied last. */
    restedTime: number;
    /** The track time of that entry at that apply. */
    restedTrack: number;
}

/** Creates the player of an engine, with no tracks. */
export function createPlayer(pose: Pose43): Player43 {
    return {
        pose,
        tracks: [],
        timeScale: 1,
        defaultMix: 0,
        mixes: new Map(),
        unkeyedState: 0,
        attachmentStates: new Float64Array(pose.rig.model.slots.count),
        fired: [],
        animationsChanged: false,
        pool: [],
        queueTypes: [],
        queueEntries: [],
        queueKeys: [],
        drainDisabled: false,
        listened: [],
        rested: null,
        restedTime: Number.NaN,
        restedTrack: Number.NaN,
    };
}

/** Takes an entry from the pool, or makes one. The official `trackEntryPool.obtain`. */
export function obtainEntry(player: Player43): Entry {
    return player.pool.pop() ?? new Entry(player.pose.rig.empty);
}

function push(player: Player43, type: number, entry: Entry, key: EventKey | null): void {
    player.queueTypes.push(type);
    player.queueEntries.push(entry);
    player.queueKeys.push(key);
}

/** Queues the `start` call of an entry. */
export function queueStart(player: Player43, entry: Entry): void {
    push(player, START, entry, null);
    player.animationsChanged = true;
}

/** Queues the `interrupt` call of an entry. */
export function queueInterrupt(player: Player43, entry: Entry): void {
    push(player, INTERRUPT, entry, null);
}

/** Queues the `end` call of an entry. Its `dispose` call follows it. */
export function queueEnd(player: Player43, entry: Entry): void {
    push(player, END, entry, null);
    player.animationsChanged = true;
}

/** Queues the `dispose` call of an entry. */
export function queueDispose(player: Player43, entry: Entry): void {
    push(player, DISPOSE, entry, null);
}

/** Queues the `complete` call of an entry. */
export function queueComplete(player: Player43, entry: Entry): void {
    push(player, COMPLETE, entry, null);
}

/** Queues the `event` call of an entry for one event key. */
export function queueEvent(player: Player43, entry: Entry, key: EventKey): void {
    push(player, EVENT, entry, key);
}

/**
 * Notes one listener call. The track and the animation are copied now, because the entry goes back
 * to the pool after its `dispose` call and can then stand for a later entry.
 */
function listen(player: Player43, type: PoseEventType, entry: Entry): void {
    player.listened.push({ type, track: entry.trackIndex, animation: entry.animation, entry });
}

function free(player: Player43, entry: Entry): void {
    entry.reset();
    // the object can stand for a later entry, which has not been applied
    if (player.rested === entry) player.rested = null;
    player.pool.push(entry);
}

/** Reports one queued call. An entry that ended or was disposed goes back to the pool. */
function report(player: Player43, type: number, entry: Entry, key: EventKey | null): void {
    switch (type) {
        case START:
            listen(player, 'start', entry);
            break;
        case INTERRUPT:
            listen(player, 'interrupt', entry);
            break;
        case END:
            listen(player, 'end', entry);
            listen(player, 'dispose', entry);
            free(player, entry);
            break;
        case DISPOSE:
            listen(player, 'dispose', entry);
            free(player, entry);
            break;
        case COMPLETE:
            listen(player, 'complete', entry);
            break;
        default:
            if (key !== null) {
                player.listened.push({
                    type: 'event',
                    track: entry.trackIndex,
                    animation: entry.animation,
                    entry,
                    key,
                });
            }
    }
}

/**
 * The official `EventQueue.drain`: reports the queued calls in order and empties the queue.
 * Nothing happens while draining is turned off.
 */
export function drain(player: Player43): void {
    const { queueTypes, queueEntries, queueKeys } = player;

    // most updates queue nothing: setting the length of an empty list is not free
    if (player.drainDisabled || queueTypes.length === 0) return;

    for (let i = 0; i < queueTypes.length; i++) {
        const entry = queueEntries[i];

        if (entry !== undefined) report(player, queueTypes[i] ?? EVENT, entry, queueKeys[i] ?? null);
    }
    queueTypes.length = 0;
    queueEntries.length = 0;
    queueKeys.length = 0;
}
