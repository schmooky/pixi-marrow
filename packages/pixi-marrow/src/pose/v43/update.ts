import { clearNext, setTrack } from './commands';
import type { Entry } from './entry';
import { drain, type Player43, queueEnd } from './player';

/**
 * The official `updateMixingFrom`: advances the entries `to` mixes from and ends those whose mix
 * is done. Returns true when every one of them is done.
 */
function updateMixingFrom(player: Player43, to: Entry, delta: number): boolean {
    const from = to.mixingFrom;

    if (!from) return true;
    const finished = updateMixingFrom(player, from, delta);

    from.animationLast = from.nextAnimationLast;
    from.trackLast = from.nextTrackLast;
    // the from entry was applied at least once and the mix is complete
    if (to.nextTrackLast !== -1 && to.mixTime >= to.mixDuration) {
        // mixing is complete for all entries before the from entry, or the mix is instant
        if (from.totalAlpha === 0 || to.mixDuration === 0) {
            to.mixingFrom = from.mixingFrom;
            if (from.mixingFrom != null) from.mixingFrom.mixingTo = to;
            if (from.totalAlpha === 0) {
                for (let next = to; next.mixingTo != null; next = next.mixingTo) next.keepHold = true;
            }
            queueEnd(player, from);
        }

        return finished;
    }
    from.trackTime += delta * from.timeScale;
    to.mixTime += delta;

    return false;
}

/** Makes the queued entry current once its delay has passed. It keeps the time that is left over. */
function changeToNext(
    player: Player43,
    index: number,
    current: Entry,
    next: Entry,
    nextTime: number,
    delta: number,
    currentDelta: number,
): void {
    next.delay = 0;
    next.trackTime += current.timeScale === 0 ? 0 : (nextTime / current.timeScale + delta) * next.timeScale;
    current.trackTime += currentDelta;
    setTrack(player, index, next, true);
    let entry = next;

    while (entry.mixingFrom) {
        entry.mixTime += delta;
        entry = entry.mixingFrom;
    }
}

/** Ends every entry `current` mixes from, once all of them have completed. */
function endMixingFrom(player: Player43, current: Entry): void {
    let from = current.mixingFrom;

    current.mixingFrom = null;
    if (from) from.mixingTo = null;
    while (from) {
        queueEnd(player, from);
        from = from.mixingFrom;
    }
}

function updateTrack(player: Player43, index: number, current: Entry, delta: number): void {
    current.animationLast = current.nextAnimationLast;
    current.trackLast = current.nextTrackLast;
    let currentDelta = delta * current.timeScale;

    if (current.delay > 0) {
        current.delay -= currentDelta;
        if (current.delay > 0) return;
        currentDelta = -current.delay;
        current.delay = 0;
    }
    const next = current.next;

    if (next) {
        const nextTime = current.trackLast - next.delay;

        if (nextTime >= 0) {
            changeToNext(player, index, current, next, nextTime, delta, currentDelta);

            return;
        }
    } else if (current.trackLast >= current.trackEnd && !current.mixingFrom) {
        // the track end was reached and nothing is queued: the track is cleared
        player.tracks[index] = null;
        queueEnd(player, current);
        clearNext(player, current);

        return;
    }
    if (current.mixingFrom && updateMixingFrom(player, current, delta)) endMixingFrom(player, current);
    current.trackTime += currentDelta;
}

/** The official `AnimationState.update`: advances every track by `delta` seconds. */
export function updateTracks(player: Player43, delta: number): void {
    const tracks = player.tracks;

    delta *= player.timeScale;
    for (let i = 0, n = tracks.length; i < n; i++) {
        const current = tracks[i];

        if (current) updateTrack(player, i, current, delta);
    }
    drain(player);
}
