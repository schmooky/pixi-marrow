import type { LegacyEntry } from './entry';
import type { LegacyPlayer } from './player';
import { ADD, type Clip, K_ATTACHMENT, K_DRAW_ORDER, K_EVENT, type LegacyTimeline } from './timelines';

/** A timeline applied earlier has set this property. Mix from the current pose. */
export const SUBSEQUENT = 0;
/** The first timeline to set this property. Mix from the setup pose. */
export const FIRST_TIMELINE = 1;
/** Like `SUBSEQUENT`, and the next entry also sets the property. The timeline is not mixed out. */
export const HOLD_SUBSEQUENT = 2;
/** Like `FIRST_TIMELINE`, and the next entry also sets the property. The timeline is not mixed out. */
export const HOLD_FIRST = 3;
/** Like `HOLD_FIRST`, and a later entry that does not set the property fades the timeline out. */
const HOLD_MIX = 4;

/** The official `StringSet.addAll`: adds every id. True when at least one was new. */
function addAll(seen: Set<number>, ids: readonly number[]): boolean {
    const before = seen.size;

    for (const id of ids) seen.add(id);

    return seen.size !== before;
}

/** The official `Animation.hasTimeline`. */
function hasTimeline(clip: Clip, ids: readonly number[]): boolean {
    for (const id of ids) {
        if (clip.ids.has(id)) return true;
    }

    return false;
}

/** The mode of timeline `i` of an entry that mixes out to `to`, or plays alone when `to` is null. */
function modeOf(
    player: LegacyPlayer,
    entry: LegacyEntry,
    to: LegacyEntry | null,
    timeline: LegacyTimeline,
    i: number,
): number {
    const { ids, kind } = timeline;

    if (!addAll(player.seenIds, ids)) return SUBSEQUENT;
    if (to === null || kind === K_ATTACHMENT || kind === K_DRAW_ORDER || kind === K_EVENT) return FIRST_TIMELINE;
    if (!hasTimeline(to.clip, ids)) return FIRST_TIMELINE;
    for (let next = to.mixingTo; next !== null; next = next.mixingTo) {
        if (hasTimeline(next.clip, ids)) continue;
        if (entry.mixDuration > 0) {
            entry.timelineHoldMix[i] = next;

            return HOLD_MIX;
        }
        break;
    }

    return HOLD_FIRST;
}

/** The official `computeHold`: decides for every timeline of an entry how it mixes. */
function computeHold(player: LegacyPlayer, entry: LegacyEntry): void {
    const to = entry.mixingTo;
    const timelines = entry.clip.timelines;
    const modes = entry.timelineMode;
    const holdPrevious = to?.holdPrevious === true;

    entry.timelineHoldMix.length = 0;
    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        if (holdPrevious) modes[i] = addAll(player.seenIds, timeline.ids) ? HOLD_FIRST : HOLD_SUBSEQUENT;
        else modes[i] = modeOf(player, entry, to, timeline, i);
    }
}

/**
 * The official `_animationsChanged`: computes the hold modes of every entry, lowest track first
 * and within a track from the oldest entry up.
 */
export function computeHolds(player: LegacyPlayer): void {
    player.animationsChanged = false;
    player.seenIds.clear();
    for (const track of player.tracks) {
        if (track === null) continue;
        let entry: LegacyEntry | null = track;

        while (entry.mixingFrom !== null) entry = entry.mixingFrom;
        for (; entry !== null; entry = entry.mixingTo) {
            if (entry.mixingTo === null || entry.mixBlend !== ADD) computeHold(player, entry);
        }
    }
}
