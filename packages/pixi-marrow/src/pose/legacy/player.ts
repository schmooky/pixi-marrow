import { MarrowError } from '../../base/errors';
import type { EventKey } from '../../model/timelines';
import type { PoseEvent, PoseEventType } from '../engine';
import type { PoseState } from '../state';
import { LegacyEntry } from './entry';
import { clipOf, type Rig } from './rig';
import type { Solver } from './solver';
import type { Clip } from './timelines';

/**
 * The playback state of one skeleton instance: the official `AnimationState` and
 * `AnimationStateData`, plus the slot states the official runtime keeps on its slots.
 */
export class LegacyPlayer {
    readonly rig: Rig;
    readonly pose: PoseState;
    /** The constraint values the constraint timelines animate. */
    readonly solver: Solver;
    /** The current entry of each track, or null. */
    readonly tracks: (LegacyEntry | null)[] = [];
    timeScale = 1;
    defaultMix = 0;
    /** Mix durations by the official key: the names of two animations joined with a period. */
    readonly mixes: Map<string, number> = new Map();
    /** True when the hold modes of the entries must be computed before the next apply. */
    animationsChanged = false;
    /**
     * True when the next apply cannot be the one before again: a call changed an entry or the
     * pose, or an update started, ended or advanced an entry. See rest.ts.
     */
    stirred = true;
    /** True when the last apply left every number of the pose as it was. Then the same apply need not run again. */
    settled = false;
    /** How many applies to wait before the next one is checked for leaving the pose as it is. */
    patience = 0;
    /** How long that wait was the last time. It doubles while the pose keeps changing. */
    waited = 0;
    /** The official `unkeyedState`. It grows by 2 with every apply. */
    unkeyedState = 0;
    /** The official `Slot.attachmentState` of each slot. */
    readonly attachmentState: Float64Array;
    /** The events the timelines of one entry fired. Emptied after each entry. */
    readonly fired: EventKey[] = [];
    /** The listener calls since the last `takeEvents`. */
    events: PoseEvent[] = [];
    /** Scratch: the property ids seen while hold modes are computed. */
    readonly seenIds: Set<number> = new Set();
    /** Scratch: the values of one key of a timeline with several values. */
    readonly values: Float64Array = new Float64Array(8);

    constructor(rig: Rig, pose: PoseState, solver: Solver) {
        this.rig = rig;
        this.pose = pose;
        this.solver = solver;
        this.attachmentState = new Float64Array(rig.model.slots.count);
    }
}

/**
 * Records one listener call. The official queue calls listeners in the order the calls were
 * queued. The event carries the entry it is about: the object the call that made the entry returned.
 */
function emit(player: LegacyPlayer, type: PoseEventType, entry: LegacyEntry): void {
    player.events.push({ type, track: entry.trackIndex, animation: entry.animation, entry });
    // an entry started, ended or was interrupted. `complete` comes from the apply itself and stirs nothing
    if (type !== 'complete') player.stirred = true;
}

/** The official `queue.start`. */
function queueStart(player: LegacyPlayer, entry: LegacyEntry): void {
    emit(player, 'start', entry);
    player.animationsChanged = true;
}

/** The official `queue.interrupt`. */
function queueInterrupt(player: LegacyPlayer, entry: LegacyEntry): void {
    emit(player, 'interrupt', entry);
}

/** The official `queue.end`. The listener hears `end`, then `dispose`. */
export function queueEnd(player: LegacyPlayer, entry: LegacyEntry): void {
    emit(player, 'end', entry);
    emit(player, 'dispose', entry);
    player.animationsChanged = true;
}

/** The official `queue.complete`. */
export function queueComplete(player: LegacyPlayer, entry: LegacyEntry): void {
    emit(player, 'complete', entry);
}

/** The official `queue.event`. */
export function queueEvent(player: LegacyPlayer, entry: LegacyEntry, key: EventKey): void {
    player.events.push({ type: 'event', track: entry.trackIndex, animation: entry.animation, entry, key });
}

/** The official `clearNext`: disposes every entry queued after `entry`. */
export function clearNext(player: LegacyPlayer, entry: LegacyEntry): void {
    for (let next = entry.next; next !== null; next = next.next) emit(player, 'dispose', next);
    entry.next = null;
}

/** The official `expandToIndex`: the current entry of a track. Tracks up to `index` are created. */
function expandToIndex(player: LegacyPlayer, index: number): LegacyEntry | null {
    if (!Number.isInteger(index) || index < 0) {
        throw new MarrowError('invalid-data', `${index} is not a track index.`, {
            fix: 'Pass a whole number from 0 up.',
        });
    }
    while (player.tracks.length <= index) player.tracks.push(null);

    return player.tracks[index] ?? null;
}

/** The official `AnimationStateData.getMix`. */
function mixBetween(player: LegacyPlayer, from: Clip, to: Clip): number {
    return player.mixes.get(`${from.name}.${to.name}`) ?? player.defaultMix;
}

/** The official `AnimationStateData.setMixWith`. Animations are model indices. */
export function setMix(player: LegacyPlayer, from: number, to: number, duration: number): void {
    player.mixes.set(`${clipOf(player.rig, from).name}.${clipOf(player.rig, to).name}`, duration);
}

/** The official `trackEntry`: a new entry with the mix duration from `last` to it. */
function newEntry(
    player: LegacyPlayer,
    trackIndex: number,
    clip: Clip,
    loop: boolean,
    last: LegacyEntry | null,
): LegacyEntry {
    return new LegacyEntry(trackIndex, clip, loop, last === null ? 0 : mixBetween(player, last.clip, clip));
}

/** The official `setCurrent`: makes `current` the entry of a track and mixes from the entry it replaces. */
export function setCurrent(player: LegacyPlayer, index: number, current: LegacyEntry, interrupt: boolean): void {
    const from = expandToIndex(player, index);

    player.tracks[index] = current;
    if (from !== null) {
        if (interrupt) queueInterrupt(player, from);
        current.mixingFrom = from;
        from.mixingTo = current;
        current.mixTime = 0;
        // store the interrupted mix percentage
        if (from.mixingFrom !== null && from.mixDuration > 0) {
            current.interruptAlpha *= Math.min(1, from.mixTime / from.mixDuration);
        }
        // reset rotation for mixing out, in case the entry was mixed in
        from.rotationLength = 0;
    }
    queueStart(player, current);
}

/** The official `setAnimationWith`. */
export function setAnimation(player: LegacyPlayer, trackIndex: number, clip: Clip, loop: boolean): LegacyEntry {
    let interrupt = true;
    let current = expandToIndex(player, trackIndex);

    if (current !== null) {
        if (current.nextTrackLast === -1) {
            // do not mix from an entry that was never applied
            player.tracks[trackIndex] = current.mixingFrom;
            queueInterrupt(player, current);
            queueEnd(player, current);
            clearNext(player, current);
            current = current.mixingFrom;
            interrupt = false;
        } else {
            clearNext(player, current);
        }
    }
    const entry = newEntry(player, trackIndex, clip, loop, current);

    setCurrent(player, trackIndex, entry, interrupt);

    return entry;
}

/**
 * The official `addAnimationWith`. The 4.2 runtime never sets a negative delay, the 4.1 runtime
 * can. The two also add the three numbers of the delay in a different order.
 */
export function addAnimation(
    player: LegacyPlayer,
    trackIndex: number,
    clip: Clip,
    loop: boolean,
    delay: number,
): LegacyEntry {
    const v41 = player.rig.v41;
    let last = expandToIndex(player, trackIndex);
    let entryDelay = delay;

    while (last !== null && last.next !== null) last = last.next;
    const entry = newEntry(player, trackIndex, clip, loop, last);

    if (last === null) {
        setCurrent(player, trackIndex, entry, true);
        if (!v41 && entryDelay < 0) entryDelay = 0;
    } else {
        last.next = entry;
        if (entryDelay <= 0) {
            entryDelay = v41
                ? entryDelay + (last.getTrackComplete() - entry.mixDuration)
                : Math.max(entryDelay + last.getTrackComplete() - entry.mixDuration, 0);
        }
    }
    entry.delay = entryDelay;

    return entry;
}

/** The official `setEmptyAnimation`. */
export function setEmptyAnimation(player: LegacyPlayer, trackIndex: number, mixDuration: number): LegacyEntry {
    const entry = setAnimation(player, trackIndex, player.rig.empty, false);

    entry.mixDuration = mixDuration;
    entry.trackEnd = mixDuration;

    return entry;
}

/** The official `addEmptyAnimation`. */
export function addEmptyAnimation(
    player: LegacyPlayer,
    trackIndex: number,
    mixDuration: number,
    delay: number,
): LegacyEntry {
    const entry = addAnimation(player, trackIndex, player.rig.empty, false, delay);

    if (delay <= 0) {
        entry.delay = player.rig.v41
            ? entry.delay + (entry.mixDuration - mixDuration)
            : Math.max(entry.delay + entry.mixDuration - mixDuration, 0);
    }
    entry.mixDuration = mixDuration;
    entry.trackEnd = mixDuration;

    return entry;
}

/** The official `clearTrack`: ends the entry of a track and every entry it mixes from. */
export function clearTrack(player: LegacyPlayer, trackIndex: number): void {
    const current = player.tracks[trackIndex] ?? null;

    if (current === null) return;
    queueEnd(player, current);
    clearNext(player, current);
    let entry = current;

    for (let from = entry.mixingFrom; from !== null; from = entry.mixingFrom) {
        queueEnd(player, from);
        entry.mixingFrom = null;
        entry.mixingTo = null;
        entry = from;
    }
    player.tracks[current.trackIndex] = null;
}

/** The official `clearTracks`. */
export function clearTracks(player: LegacyPlayer): void {
    for (let i = 0, n = player.tracks.length; i < n; i++) clearTrack(player, i);
    player.tracks.length = 0;
}
