import type { Entry } from './entry';
import { drain, obtainEntry, type Player43, queueDispose, queueEnd, queueInterrupt, queueStart } from './player';
import type { Clip43 } from './types';

/** The key the official `AnimationStateData` stores a mix duration under. */
export function mixKey(from: Clip43, to: Clip43): string {
    return `${from.name}.${to.name}`;
}

/** The official `expandToIndex`: the current entry of a track. Makes the track list long enough. */
function expandToIndex(player: Player43, index: number): Entry | null {
    const tracks = player.tracks;

    while (tracks.length <= index) tracks.push(null);

    return tracks[index] ?? null;
}

/** The official `trackEntry`: a fresh entry with the default values. */
function trackEntry(player: Player43, trackIndex: number, clip: Clip43, loop: boolean, last: Entry | null): Entry {
    const entry = obtainEntry(player);

    entry.reset();
    entry.trackIndex = trackIndex;
    entry.clip = clip;
    entry.animation = clip.index;
    entry.loop = loop;
    entry.additive = false;
    entry.reverse = false;
    entry.shortestRotation = false;
    entry.eventThreshold = 0;
    entry.alphaAttachmentThreshold = 0;
    entry.mixAttachmentThreshold = 0;
    entry.mixDrawOrderThreshold = 0;
    entry.animationStart = 0;
    entry.animationEnd = clip.duration;
    entry.animationLast = -1;
    entry.nextAnimationLast = -1;
    entry.delay = 0;
    entry.trackTime = 0;
    entry.trackLast = -1;
    entry.nextTrackLast = -1;
    entry.trackEnd = Number.MAX_VALUE;
    entry.timeScale = 1;
    entry.alpha = 1;
    entry.mixTime = 0;
    entry.mixDuration = last === null ? 0 : (player.mixes.get(mixKey(last.clip, clip)) ?? player.defaultMix);
    entry.totalAlpha = 0;
    entry.keepHold = false;

    return entry;
}

/** The official `clearNext`: disposes every entry queued after `entry`. */
export function clearNext(player: Player43, entry: Entry): void {
    let next = entry.next;

    while (next) {
        queueDispose(player, next);
        next = next.next;
    }
    entry.next = null;
}

/** The official `setTrack`: makes `current` the entry of a track. It mixes from the entry before it. */
export function setTrack(player: Player43, index: number, current: Entry, interrupt: boolean): void {
    const from = expandToIndex(player, index);

    player.tracks[index] = current;
    current.previous = null;
    if (from) {
        from.next = null;
        if (interrupt) queueInterrupt(player, from);
        current.mixingFrom = from;
        from.mixingTo = current;
        current.mixTime = 0;
        // the rotation directions start over for the mix out
        from.rotationCount = 0;
    }
    queueStart(player, current);
}

/** The official `setAnimation`: plays an animation on a track now and drops what was queued. */
export function setAnimation(player: Player43, trackIndex: number, clip: Clip43, loop: boolean): Entry {
    let interrupt = true;
    let current = expandToIndex(player, trackIndex);

    if (current) {
        if (current.nextTrackLast === -1 && current.clip === clip) {
            // an entry that was never applied is replaced, not mixed from
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
    const entry = trackEntry(player, trackIndex, clip, loop, current);

    setTrack(player, trackIndex, entry, interrupt);
    drain(player);

    return entry;
}

/** The official `addAnimation`: queues an animation after the last entry of a track. */
export function addAnimation(player: Player43, trackIndex: number, clip: Clip43, loop: boolean, delay: number): Entry {
    let last = expandToIndex(player, trackIndex);

    while (last?.next) last = last.next;
    const entry = trackEntry(player, trackIndex, clip, loop, last);

    if (last) {
        last.next = entry;
        entry.previous = last;
        if (delay <= 0) delay = Math.max(delay + last.getTrackComplete() - entry.mixDuration, 0);
    } else {
        setTrack(player, trackIndex, entry, true);
        drain(player);
        if (delay < 0) delay = 0;
    }
    entry.delay = delay;

    return entry;
}

/** The official `setEmptyAnimation`: mixes a track out to nothing over `mixDuration` seconds. */
export function setEmptyAnimation(player: Player43, trackIndex: number, mixDuration: number): Entry {
    const entry = setAnimation(player, trackIndex, player.pose.rig.empty, false);

    entry.mixDuration = mixDuration;
    entry.trackEnd = mixDuration;

    return entry;
}

/** The official `addEmptyAnimation`: queues mixing a track out to nothing. */
export function addEmptyAnimation(player: Player43, trackIndex: number, mixDuration: number, delay: number): Entry {
    const entry = addAnimation(player, trackIndex, player.pose.rig.empty, false, delay);

    if (delay <= 0) entry.delay = Math.max(entry.delay + entry.mixDuration - mixDuration, 0);
    entry.mixDuration = mixDuration;
    entry.trackEnd = mixDuration;

    return entry;
}

/** The official `clearTrack`: ends the entry of a track and the entries it mixes from. */
export function clearTrack(player: Player43, trackIndex: number): void {
    const current = player.tracks[trackIndex];

    if (!current) return;
    queueEnd(player, current);
    clearNext(player, current);
    let entry = current;

    while (true) {
        const from = entry.mixingFrom;

        if (!from) break;
        queueEnd(player, from);
        entry.mixingFrom = null;
        entry.mixingTo = null;
        entry = from;
    }
    player.tracks[current.trackIndex] = null;
    drain(player);
}

/** The official `clearTracks`: clears every track and reports all calls at the end. */
export function clearTracks(player: Player43): void {
    const oldDrainDisabled = player.drainDisabled;

    player.drainDisabled = true;
    for (let i = 0, n = player.tracks.length; i < n; i++) clearTrack(player, i);
    player.tracks.length = 0;
    player.drainDisabled = oldDrainDisabled;
    drain(player);
}
