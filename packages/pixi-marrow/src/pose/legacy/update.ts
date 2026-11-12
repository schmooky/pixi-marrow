import { DELTA, SHARED } from './curves';
import type { LegacyEntry } from './entry';
import { clearNext, type LegacyPlayer, queueEnd, setCurrent } from './player';

/**
 * The official `updateMixingFrom`: advances the entries `to` mixes from. Returns true when all
 * of them finished mixing.
 *
 * The versions differ in how they know that `from` was applied at least once. The 4.1 runtime
 * asks for a mix time above 0, the 4.2 runtime asks whether `to` was applied.
 */
function updateMixingFrom(player: LegacyPlayer, to: LegacyEntry): boolean {
    const from = to.mixingFrom;

    if (from === null) return true;
    const finished = updateMixingFrom(player, from);
    const delta = Number(SHARED[DELTA]);

    from.animationLast = from.nextAnimationLast;
    from.trackLast = from.nextTrackLast;
    const applied = player.rig.v41 ? to.mixTime > 0 : to.nextTrackLast !== -1;

    if (applied && to.mixTime >= to.mixDuration) {
        // mixing is complete for all entries before the from entry, or the mix is instantaneous
        if (from.totalAlpha === 0 || to.mixDuration === 0) {
            to.mixingFrom = from.mixingFrom;
            if (from.mixingFrom !== null) from.mixingFrom.mixingTo = to;
            to.interruptAlpha = from.interruptAlpha;
            queueEnd(player, from);
        }

        return finished;
    }
    from.trackTime += delta * from.timeScale;
    to.mixTime += delta;

    return false;
}

/**
 * Makes the queued entry current when its delay has passed. Returns true when it did. The caller
 * then adds the time this update gives the current entry to its track time.
 */
function advanceToNext(player: LegacyPlayer, index: number, current: LegacyEntry): boolean {
    const next = current.next;
    const delta = Number(SHARED[DELTA]);

    if (next === null) return false;
    // when the next entry's delay is passed, change to the next entry, preserving leftover time
    const nextTime = current.trackLast - next.delay;

    if (!(nextTime >= 0)) return false;
    next.delay = 0;
    next.trackTime += current.timeScale === 0 ? 0 : (nextTime / current.timeScale + delta) * next.timeScale;
    setCurrent(player, index, next, true);
    for (let entry = next; entry.mixingFrom !== null; entry = entry.mixingFrom) entry.mixTime += delta;

    return true;
}

function updateTrack(player: LegacyPlayer, index: number, current: LegacyEntry): void {
    current.animationLast = current.nextAnimationLast;
    current.trackLast = current.nextTrackLast;
    let currentDelta = Number(SHARED[DELTA]) * current.timeScale;

    if (current.delay > 0) {
        current.delay -= currentDelta;
        if (current.delay > 0) return;
        currentDelta = -current.delay;
        current.delay = 0;
    }
    if (current.next !== null) {
        if (advanceToNext(player, index, current)) {
            current.trackTime += currentDelta;

            return;
        }
    } else if (current.trackLast >= current.trackEnd && current.mixingFrom === null) {
        // the track end was reached and nothing is queued: clear the track
        player.tracks[index] = null;
        queueEnd(player, current);
        clearNext(player, current);

        return;
    }
    if (current.mixingFrom !== null && updateMixingFrom(player, current)) {
        // end the entries that were mixed from once all have completed
        let from: LegacyEntry | null = current.mixingFrom;

        current.mixingFrom = null;
        if (from !== null) from.mixingTo = null;
        for (; from !== null; from = from.mixingFrom) queueEnd(player, from);
    }
    current.trackTime += currentDelta;
}

/** The official `AnimationState.update`: advances every track by `dt` seconds. */
export function updateTracks(player: LegacyPlayer, dt: number): void {
    const tracks = player.tracks;

    SHARED[DELTA] = dt * player.timeScale;
    for (let i = 0, n = tracks.length; i < n; i++) {
        const current = tracks[i] ?? null;

        if (current !== null) updateTrack(player, i, current);
    }
}
