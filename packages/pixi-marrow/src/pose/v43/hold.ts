import type { Entry } from './entry';
import type { Player43 } from './player';
import { CURRENT, FIRST, HOLD, type Rig43, ROLE_FOLDER, type Scratch43, SETUP, type Timeline43 } from './types';

/**
 * Notes that `track` sets a property, unless a track has set it already. Returns the track that
 * set it first, or -1 when that is this call.
 */
function claim(scratch: Scratch43, id: number, track: number): number {
    if (scratch.stamps[id] === scratch.generation) return scratch.owners[id] ?? -1;
    scratch.stamps[id] = scratch.generation;
    scratch.owners[id] = track;

    return -1;
}

/**
 * The official `AnimationState.from`: what a timeline mixes from. That is the setup pose when the
 * timeline is the first to set its properties. It is the current pose when a lower track sets
 * them, and the first pose when an older entry of its own track does.
 */
function mixFrom(rig: Rig43, track: number, timeline: Timeline43): number {
    const { scratch } = rig;
    const ids = timeline.ids;
    let from = SETUP;

    for (let i = 0, n = ids.length; i < n; i++) {
        const owner = claim(scratch, ids[i] ?? 0, track);

        if (owner === -1) continue;
        if (owner !== track) {
            while (++i < n) claim(scratch, ids[i] ?? 0, track);

            return CURRENT;
        }
        from = FIRST;
    }
    if (timeline.role === ROLE_FOLDER && scratch.stamps[rig.drawOrderId] === scratch.generation) {
        return scratch.owners[rig.drawOrderId] !== track ? CURRENT : FIRST;
    }

    return from;
}

/** True when an entry that mixes in from `timeline`'s entry takes over the properties of the timeline. */
function overwrites(to: Entry, timeline: Timeline43): boolean {
    if (to.additive && timeline.additive) return false;

    for (const id of timeline.ids) if (to.clip.ids.has(id)) return true;

    return false;
}

/**
 * The entry whose mix fades the hold of a timeline out: the first later entry on the track that
 * does not set the properties of the timeline. Null when its mix has no duration or none is found.
 */
function holdFade(to: Entry, timeline: Timeline43): Entry | null {
    for (let next = to.mixingTo; next != null; next = next.mixingTo) {
        if (!overwrites(next, timeline)) return next.mixDuration > 0 ? next : null;
    }

    return null;
}

/** The official `computeHold`: the mode of every timeline of one entry. */
function computeHold(rig: Rig43, entry: Entry, track: number): void {
    const timelines = entry.clip.timelines;
    const modes = entry.sizeModes(timelines.length);
    const holdMix = entry.holdMix;
    const to = entry.mixingTo;

    holdMix.length = 0;
    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        const from = mixFrom(rig, track, timeline);
        let mode = from;

        holdMix[i] = null;
        if (entry.additive && timeline.additive) {
            modes[i] = from;
            continue;
        }
        // hold if the next entry will overwrite this property
        if (to !== null && !timeline.instant && overwrites(to, timeline)) {
            mode = from | HOLD;
            holdMix[i] = holdFade(to, timeline);
        }
        if (entry.keepHold) mode = (mode & ~HOLD) | ((modes[i] ?? 0) & HOLD);
        modes[i] = mode;
    }
}

/**
 * The official `_animationsChanged`: computes the timeline modes of every entry, track by track,
 * each from the oldest entry that is mixed out to the current one.
 */
export function animationsChanged(player: Player43): void {
    const { rig } = player.pose;
    const tracks = player.tracks;

    player.animationsChanged = false;
    // forgets which track set which property: the official propertyIds.clear
    rig.scratch.generation++;
    for (let i = 0, n = tracks.length; i < n; i++) {
        let entry = tracks[i] ?? null;

        if (entry === null) continue;
        while (entry.mixingFrom) entry = entry.mixingFrom;
        while (entry !== null) {
            computeHold(rig, entry, i);
            entry = entry.mixingTo;
        }
    }
}
