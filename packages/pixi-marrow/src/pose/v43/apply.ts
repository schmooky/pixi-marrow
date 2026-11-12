import type { AttachmentData } from '../../model/attachments';
import type { EventKey } from '../../model/timelines';
import { LOCAL_STRIDE } from '../state';
import { eventsReverse, queueEvents } from './apply-events';
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
import { drain, type Player43 } from './player';
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

/**
 * Notes the bones that the timelines of an entry pose: the next update has to pose them again.
 * While updates pose every bone anyway, nothing is noted.
 */
function noteBones(pose: Pose43, entry: Entry): void {
    if (pose.solve.busy > 0) return;
    const { bones } = entry.clip;
    const { fresh } = pose;

    for (let i = 0; i < bones.length; i++) fresh[Number(bones[i])] = 1;
}

/** Applies an entry on track 0 at full alpha: every timeline replaces the setup pose. */
function applyFromSetup(player: Player43, entry: Entry, events: EventKey[] | null): void {
    const pose = player.pose;
    const timelines = entry.clip.timelines;

    noteBones(pose, entry);

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
    noteBones(pose, entry);
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
    noteBones(pose, from);
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

/**
 * Applies the current entry of a track, after the entries it mixes from. Returns true when the
 * entry alone replaced the setup pose: it is on track 0 at full alpha and mixes from nothing.
 * Such an apply writes the same pose again when it is repeated at the same time.
 */
function applyCurrent(player: Player43, current: Entry, track: number): boolean {
    const mixing = current.mixingFrom !== null;
    let alpha = current.alpha;

    if (current.mixingFrom) {
        applyMixingFrom(player, current, current.mixingFrom);
        alpha *= current.mixed;
    } else if (current.trackTime >= current.trackEnd && !current.next) alpha = 0;
    const events = current.reverse ? null : player.fired;
    const replaces = track === 0 && alpha === 1;

    setTimes(current);
    SHARED[ALPHA] = alpha;
    player.restedTime = Number(SHARED[TIME]);
    player.restedTrack = current.trackTime;
    if (replaces) applyFromSetup(player, current, events);
    else applyMixed(player, current, events);
    finish(player, current);

    return replaces && !mixing;
}

/** This apply has timelines to run. */
const APPLY = 0;
/** No track has an entry to apply. */
const NOTHING = 1;
/** The one entry to apply would write the pose it wrote last time. */
const REPEAT = 2;

/**
 * Says whether this apply would write the pose the last apply left, so that no timeline has to
 * run: one of `APPLY`, `NOTHING` and `REPEAT`. It repeats when the one entry to apply is the one
 * that replaced the setup pose last time, at the same time, and nothing else has changed the
 * pose since. The times of that entry are in `SHARED` then.
 */
function restsAsApplied(player: Player43): number {
    const tracks = player.tracks;
    let only: Entry | null = null;

    for (let i = 0, n = tracks.length; i < n; i++) {
        const current = tracks[i];

        if (!current || current.delay > 0) continue;
        if (i !== 0) return APPLY;
        only = current;
    }
    if (only === null) return NOTHING;
    if (only !== player.rested || player.pose.solve.dirty || only.mixingFrom !== null) return APPLY;
    if (only.alpha !== 1 || (only.trackTime >= only.trackEnd && !only.next)) return APPLY;
    // an entry that moved on and is not at its end is at another time: no need to work the time out twice
    const playing = only.loop
        ? only.animationEnd > only.animationStart
        : only.trackTime < only.animationEnd - only.animationStart;

    if (playing && only.trackTime !== player.restedTrack) return APPLY;
    setTimes(only);
    const time = Number(SHARED[TIME]);

    if (Number(SHARED[ANIMATION_TIME]) !== only.animationLast || time !== player.restedTime) return APPLY;

    // a reversed entry is applied at another time than its last time: a physics reset timeline can fire there
    return only.clip.resets && time !== only.animationLast ? APPLY : REPEAT;
}

/** Gives a slot its setup attachment back when its attachment was set for deform timelines only. */
function restoreSetupAttachments(player: Player43): void {
    const { pose, attachmentStates } = player;
    const setupState = player.unkeyedState + ATTACH_SETUP;

    for (let slot = 0; slot < attachmentStates.length; slot++) {
        if (attachmentStates[slot] === setupState) setSlotAttachment(pose, slot, setupAttachment(pose, slot));
    }
}

/**
 * The official `AnimationState.apply`: poses the skeleton with the entries of every track.
 *
 * An apply that would write the pose the last one left runs no timeline. It still does what the
 * official apply does to the entry: it fires its `complete` and keeps its times. The pose is
 * marked as changed whenever a timeline ran.
 */
export function applyTracks(player: Player43): void {
    const tracks = player.tracks;
    let applied = 0;
    let replaced = false;

    if (player.animationsChanged) animationsChanged(player);
    const rest = restsAsApplied(player);

    if (rest !== APPLY) {
        // no event timeline fires at the time of the last apply: the entry has its times to keep and its `complete`
        if (rest === REPEAT && player.rested !== null) finish(player, player.rested);
        drain(player);

        return;
    }
    for (let i = 0, n = tracks.length; i < n; i++) {
        const current = tracks[i];

        if (!current || current.delay > 0) continue;
        replaced = applyCurrent(player, current, i);
        applied++;
    }
    restoreSetupAttachments(player);
    player.unkeyedState += 2;
    player.rested = applied === 1 && replaced ? (tracks[0] ?? null) : null;
    if (applied > 0) player.pose.solve.dirty = true;
    drain(player);
}
