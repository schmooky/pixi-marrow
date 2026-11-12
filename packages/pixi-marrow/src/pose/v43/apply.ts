import type { AttachmentData } from '../../model/attachments';
import type { EventKey } from '../../model/timelines';
import { LOCAL_STRIDE } from '../state';
import {
    ALPHA,
    ALPHA_HOLD,
    ALPHA_MIX,
    ANIMATION_TIME,
    curveValue,
    LAST_TIME,
    SHARED,
    search,
    TIME,
    VALUES,
} from './curves';
import type { Entry } from './entry';
import { animationsChanged } from './hold';
import { drain, type Player43, queueComplete, queueEvent } from './player';
import { setSlotAttachment, setupAttachment } from './slots';
import { applyTimeline } from './timelines';
import { applyRelative } from './timelines-bone';
import { keyAttachment, shownAttachment } from './timelines-slot';
import {
    CURRENT,
    HOLD,
    MODE,
    type Pose43,
    ROLE_ATTACHMENT,
    ROLE_DRAW_ORDER,
    ROLE_EVENT,
    ROLE_ROTATE,
    SETUP,
    type Timeline43,
} from './types';

/** The slot got its attachment for this apply only, so that deform timelines can run. */
const ATTACH_SETUP = 1;
/** The slot keeps its attachment after this apply. */
const ATTACH_RETAIN = 2;
const ROTATION = 2;

/*
 * The times and the alphas of an entry go from function to function through `SHARED`, for the
 * reasons given in curves.ts. A function writes them after the entries it mixes from are applied,
 * because those write the same numbers.
 */

/** The setup attachment of a slot, found by its name like the attachment of a key. */
function setupAttachmentByKey(pose: Pose43, slot: number): AttachmentData | null {
    return keyAttachment(pose, slot, pose.rig.model.slots.attachments[slot] ?? null);
}

/**
 * The official `applyAttachmentTimeline`: applies an attachment timeline and notes in the
 * attachment state of the slot whether the attachment stays.
 *
 * @param retain True when the attachment stays after the apply. False when it is there only for
 * the deform timelines of this apply.
 */
function applyAttachmentTimeline(player: Player43, timeline: Timeline43, from: number, retain: boolean): void {
    const { pose, attachmentStates, unkeyedState } = player;
    const slot = timeline.target;
    const frames = timeline.frames;

    if (pose.state.active[timeline.bone] !== 1) return;
    if (!retain && attachmentStates[slot] === unkeyedState + ATTACH_RETAIN) return;
    let setup = Number(SHARED[TIME]) < Number(frames[0]);
    let key = 0;

    if (!setup) {
        key = search(frames, 1);
        setup = !retain && timeline.names[key] == null;
    }
    if (setup) {
        if (from === CURRENT) return;
        setSlotAttachment(pose, slot, setupAttachmentByKey(pose, slot));
    } else {
        setSlotAttachment(pose, slot, shownAttachment(pose, timeline, key));
    }
    if (retain) attachmentStates[slot] = unkeyedState + ATTACH_RETAIN;
    else if (!setup) attachmentStates[slot] = unkeyedState + ATTACH_SETUP;
}

/**
 * Adds one rotation difference to the total rotation of a mix, along the direction that was the
 * shortest on its first frame. The entry remembers the total and the last difference per timeline,
 * to see when the difference crosses half a turn. The difference is read from `SHARED` at `VALUES`.
 * The total is written to `rotations` at `i`.
 */
function turnTotal(rotations: Float64Array, i: number, firstFrame: boolean): void {
    const diff = Number(SHARED[VALUES]);
    const lastDiff = firstFrame ? diff : Number(rotations[i + 1]);

    rotations[i + 1] = diff;
    if (diff === 0) return;
    const lastTotal = firstFrame ? 0 : Number(rotations[i]);
    const loops = lastTotal - (lastTotal % 360);
    const current = diff >= 0;
    // the official signum of the last total, of the last difference and of this one
    const side = lastTotal > 0 ? 1 : lastTotal < 0 ? -1 : 0;
    const lastSide = lastDiff > 0 ? 1 : lastDiff < 0 ? -1 : 0;
    const diffSide = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    let total = diff + loops;
    let dir = lastTotal >= 0;

    if (Math.abs(lastDiff) <= 90 && lastSide !== diffSide) {
        if (Math.abs(lastTotal - loops) > 180) {
            total += 360 * side;
            dir = current;
        } else if (loops !== 0) total -= 360 * side;
        else dir = current;
    }
    if (dir !== current) total += 360 * side;
    rotations[i] = total;
}

/**
 * The official `applyRotateTimeline`: mixes a rotate timeline with the pose and keeps the
 * direction of rotation that was chosen when the mix began.
 */
function applyRotateTimeline(
    pose: Pose43,
    timeline: Timeline43,
    from: number,
    rotations: Float64Array,
    i: number,
    firstFrame: boolean,
): void {
    const alpha = Number(SHARED[ALPHA]);

    if (firstFrame) rotations[i] = 0;
    if (alpha === 1) {
        applyRelative(pose, timeline, from, false);

        return;
    }
    const { local } = pose;
    const { active } = pose.state;
    const bone = timeline.target;
    const frames = timeline.frames;

    if (active[bone] !== 1) return;
    const index = bone * LOCAL_STRIDE + ROTATION;
    const setup = Number(pose.rig.model.bones.setup[index]);
    let r1 = Number(local[index]);
    let r2 = setup;

    if (Number(SHARED[TIME]) < Number(frames[0])) {
        if (from === SETUP) local[index] = setup;
        if (from === SETUP || from === CURRENT) return;
    } else {
        if (from === SETUP) r1 = setup;
        curveValue(frames, timeline.curves);
        r2 = setup + Number(SHARED[VALUES]);
    }
    // mix between the rotations along the shortest route of the first frame, and detect crosses
    let diff = r2 - r1;

    diff -= Math.ceil(diff / 360 - 0.5) * 360;
    SHARED[VALUES] = diff;
    turnTotal(rotations, i, firstFrame);
    local[index] = r1 + Number(rotations[i]) * alpha;
}

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
function queueEvents(player: Player43, entry: Entry): void {
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
function eventsReverse(player: Player43, entry: Entry): void {
    const { duration, timelines } = entry.clip;

    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline?.role !== ROLE_EVENT) continue;
        SHARED[VALUES] = duration - entry.animationLast;
        SHARED[VALUES + 1] = duration - Number(SHARED[ANIMATION_TIME]);
        reversedEvents(player.fired, timeline);
    }
}

/** Applies an entry on track 0 at full alpha: every timeline replaces the setup pose. */
function applyFromSetup(player: Player43, entry: Entry, events: EventKey[] | null): void {
    const pose = player.pose;
    const timelines = entry.clip.timelines;

    for (let i = 0, n = timelines.length; i < n; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        if (timeline.role === ROLE_ATTACHMENT) applyAttachmentTimeline(player, timeline, SETUP, true);
        else applyTimeline(pose, timeline, events, SETUP, false, false);
    }
}

/** Applies the current entry of a track with the modes of its timelines, at the alpha in `SHARED`. */
function applyMixed(player: Player43, entry: Entry, events: EventKey[] | null): void {
    const pose = player.pose;
    const timelines = entry.clip.timelines;
    const count = timelines.length;
    const retain = Number(SHARED[ALPHA]) >= entry.alphaAttachmentThreshold;
    const add = entry.additive;
    const shortestRotation = add || entry.shortestRotation;
    const firstFrame = !shortestRotation && entry.rotationCount !== count << 1;

    if (firstFrame) entry.sizeRotations(count << 1);
    for (let i = 0; i < count; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        const from = (entry.modes[i] ?? 0) & MODE;

        if (!shortestRotation && timeline.role === ROLE_ROTATE) {
            applyRotateTimeline(pose, timeline, from, entry.rotations, i << 1, firstFrame);
        } else if (timeline.role === ROLE_ATTACHMENT) {
            applyAttachmentTimeline(player, timeline, from, retain);
        } else {
            applyTimeline(pose, timeline, events, from, add, false);
        }
    }
}

/**
 * Writes the alpha of a held timeline of an entry that is mixed out to `SHARED` at `ALPHA`: the
 * hold alpha, which a later mix can fade out.
 */
function holdAlpha(from: Entry, i: number): void {
    const holdMix = from.holdMix[i];
    const alphaHold = Number(SHARED[ALPHA_HOLD]);

    if (holdMix == null) SHARED[ALPHA] = alphaHold;
    else if (holdMix.mixDuration === 0) SHARED[ALPHA] = alphaHold * (1 - 1);
    else {
        // the official TrackEntry.mix of the entry whose mix fades the hold out
        const mix = holdMix.mixTime / holdMix.mixDuration;

        SHARED[ALPHA] = alphaHold * (1 - (mix >= 1 ? 1 : mix));
    }
}

/**
 * True for a draw order timeline that is left out while its entry is mixed out. That is one that
 * mixes from the current pose and is not held, once the mix has passed the draw order threshold.
 */
function leavesDrawOrder(timeline: Timeline43, mode: number, drawOrder: boolean): boolean {
    return !drawOrder && timeline.role === ROLE_DRAW_ORDER && (mode & HOLD) === 0 && (mode & MODE) === CURRENT;
}

/**
 * Applies the timelines of an entry that is mixed out, and adds up their alphas.
 *
 * A timeline that fades out with the mix gets the mix alpha in `SHARED`. A held timeline gets the
 * hold alpha. The flags `attachments` and `drawOrder` are true while the mix is below the
 * entry's threshold for them.
 */
function applyMixedOut(
    player: Player43,
    from: Entry,
    events: EventKey[] | null,
    attachments: boolean,
    drawOrder: boolean,
): void {
    const pose = player.pose;
    const timelines = from.clip.timelines;
    const count = timelines.length;
    const add = from.additive;
    const shortestRotation = add || from.shortestRotation;
    const firstFrame = !shortestRotation && from.rotationCount !== count << 1;
    const alphaMix = Number(SHARED[ALPHA_MIX]);

    if (firstFrame) from.sizeRotations(count << 1);
    from.totalAlpha = 0;
    for (let i = 0; i < count; i++) {
        const timeline = timelines[i];
        const mode = from.modes[i] ?? 0;
        const mix = mode & MODE;

        if (timeline === undefined || leavesDrawOrder(timeline, mode, drawOrder)) continue;
        if ((mode & HOLD) !== 0) holdAlpha(from, i);
        else SHARED[ALPHA] = alphaMix;
        const alpha = Number(SHARED[ALPHA]);

        from.totalAlpha += alpha;
        if (!shortestRotation && timeline.role === ROLE_ROTATE) {
            applyRotateTimeline(pose, timeline, mix, from.rotations, i << 1, firstFrame);
        } else if (timeline.role === ROLE_ATTACHMENT) {
            const retain = attachments && alpha >= from.alphaAttachmentThreshold;

            applyAttachmentTimeline(player, timeline, mix, retain);
        } else {
            // a draw order timeline that owns the draw order goes on while the mix is below its threshold
            const out = !drawOrder || timeline.role !== ROLE_DRAW_ORDER || mix === CURRENT;

            applyTimeline(pose, timeline, events, mix, add, out);
        }
    }
}

/**
 * Writes the official `getAnimationTime` of an entry to `SHARED` at `ANIMATION_TIME`, and the
 * times its timelines are applied with at `LAST_TIME` and `TIME`. A reversed entry is applied at
 * the time counted from the end of its animation.
 */
function setTimes(entry: Entry): void {
    const start = entry.animationStart;
    let time = start;

    if (!entry.loop) time = Math.min(entry.trackTime + start, entry.animationEnd);
    else {
        const duration = entry.animationEnd - start;

        if (duration !== 0) time = (entry.trackTime % duration) + start;
    }
    SHARED[ANIMATION_TIME] = time;
    SHARED[LAST_TIME] = entry.animationLast;
    SHARED[TIME] = entry.reverse ? entry.clip.duration - time : time;
}

/** Notes that an entry was applied at the animation time in `SHARED`, and queues what happened to it. */
function finish(player: Player43, entry: Entry): void {
    if (entry.reverse) eventsReverse(player, entry);
    queueEvents(player, entry);
    entry.nextAnimationLast = Number(SHARED[ANIMATION_TIME]);
    entry.nextTrackLast = entry.trackTime;
}

/**
 * The official `applyMixingFrom`: applies the entries `to` mixes from, oldest first, each at the
 * alpha the mix leaves it. Writes how far the mix from `from` is to `to.mixed`.
 */
function applyMixingFrom(player: Player43, to: Entry, from: Entry): void {
    let fromMix = 1;

    if (from.mixingFrom !== null) {
        applyMixingFrom(player, from, from.mixingFrom);
        fromMix = from.mixed;
    }
    // the official TrackEntry.mix
    let mix = 1;

    if (to.mixDuration !== 0) {
        mix = to.mixTime / to.mixDuration;
        if (mix >= 1) mix = 1;
    }
    const a = from.alpha * fromMix;
    const keep = 1 - mix * to.alpha;
    const alphaMix = a * (1 - mix);
    const attachments = mix < from.mixAttachmentThreshold;
    const drawOrder = mix < from.mixDrawOrderThreshold;
    const fires = mix < from.eventThreshold;

    to.mixed = mix;
    setTimes(from);
    SHARED[ALPHA_MIX] = alphaMix;
    SHARED[ALPHA_HOLD] = keep > 0 ? alphaMix / keep : a;
    applyMixedOut(player, from, !from.reverse && fires ? player.fired : null, attachments, drawOrder);
    if (to.mixDuration > 0) {
        if (from.reverse && fires) eventsReverse(player, from);
        queueEvents(player, from);
    } else if (player.fired.length > 0) player.fired.length = 0;
    from.nextAnimationLast = Number(SHARED[ANIMATION_TIME]);
    from.nextTrackLast = from.trackTime;
}

/** Applies the current entry of a track, after the entries it mixes from. */
function applyCurrent(player: Player43, current: Entry, track: number): void {
    let alpha = current.alpha;

    if (current.mixingFrom) {
        applyMixingFrom(player, current, current.mixingFrom);
        alpha *= current.mixed;
    } else if (current.trackTime >= current.trackEnd && !current.next) alpha = 0;
    const events = current.reverse ? null : player.fired;

    setTimes(current);
    SHARED[ALPHA] = alpha;
    if (track === 0 && alpha === 1) applyFromSetup(player, current, events);
    else applyMixed(player, current, events);
    finish(player, current);
}

/** Gives a slot its setup attachment back when its attachment was set for deform timelines only. */
function restoreSetupAttachments(player: Player43): void {
    const { pose, attachmentStates } = player;
    const setupState = player.unkeyedState + ATTACH_SETUP;

    for (let slot = 0; slot < attachmentStates.length; slot++) {
        if (attachmentStates[slot] === setupState) setSlotAttachment(pose, slot, setupAttachment(pose, slot));
    }
}

/** The official `AnimationState.apply`: poses the skeleton with the entries of every track. */
export function applyTracks(player: Player43): void {
    const tracks = player.tracks;

    if (player.animationsChanged) animationsChanged(player);
    for (let i = 0, n = tracks.length; i < n; i++) {
        const current = tracks[i];

        if (current && !(current.delay > 0)) applyCurrent(player, current, i);
    }
    restoreSetupAttachments(player);
    player.unkeyedState += 2;
    drain(player);
}
