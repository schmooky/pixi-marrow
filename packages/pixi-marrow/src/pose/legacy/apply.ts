import { MarrowError } from '../../base/errors';
import type { AttachmentData } from '../../model/attachments';
import type { EventKey } from '../../model/timelines';
import { applyTimeline, slotIsActive } from './apply-timeline';
import { ALPHA, ALPHA_HOLD, ALPHA_MIX, ANIMATION_TIME, LAST_TIME, MIX, SHARED, search, TIME } from './curves';
import { type LegacyEntry, MODE_UNSET } from './entry';
import { computeHolds, FIRST_TIMELINE, HOLD_FIRST, HOLD_SUBSEQUENT, SUBSEQUENT } from './hold';
import { type LegacyPlayer, queueComplete, queueEvent } from './player';
import { applyRepeats, keepPose, poseIsKept } from './rest';
import { applyRotateTimeline, rotationsOf } from './rotate';
import { findAttachment, setSlotAttachment } from './skeleton';
import {
    ADD,
    FIRST,
    K_ATTACHMENT,
    K_DRAW_ORDER,
    K_ROTATE,
    type LegacyTimeline,
    MIX_IN,
    MIX_OUT,
    SETUP,
} from './timelines';

/** Added to `unkeyedState` for a slot whose attachment a timeline left unset in this apply. */
const STATE_SETUP = 1;
/** Added to `unkeyedState` for a slot whose attachment a timeline set in this apply. */
const STATE_CURRENT = 2;

/*
 * The times and the alphas of an entry go from function to function through `SHARED`, for the
 * reasons given in curves.ts. A function writes them after the entries it mixes from are applied,
 * because those write the same numbers.
 */

/** The official `AnimationState.setAttachment`. */
function setAttachment(player: LegacyPlayer, slot: number, name: string | null, attachments: boolean): void {
    const { rig, pose } = player;

    setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, name));
    if (attachments) player.attachmentState[slot] = player.unkeyedState + STATE_CURRENT;
}

/**
 * Finds the attachment each key of an attachment timeline shows in the active skin, and keeps
 * them with the timeline. It is a function of its own so that the apply of the timeline stays small.
 */
function findShown(player: LegacyPlayer, timeline: LegacyTimeline): readonly (AttachmentData | null)[] {
    const { rig, pose } = player;
    const names = timeline.attachmentNames;
    const shown: (AttachmentData | null)[] = [];

    for (let key = 0; key < names.length; key++) {
        shown.push(findAttachment(rig, pose, timeline.target, names[key] ?? null));
    }
    timeline.shown[pose.skin + 1] = shown;

    return shown;
}

/**
 * The attachment each key of an attachment timeline shows in the active skin. Finding one by its
 * name costs more than the rest of the timeline, so it is done once per skin.
 */
function shownBy(player: LegacyPlayer, timeline: LegacyTimeline): readonly (AttachmentData | null)[] {
    return timeline.shown[player.pose.skin + 1] ?? findShown(player, timeline);
}

/**
 * The official `applyAttachmentTimeline`. With `attachments` false the attachment is set for
 * later timelines to see, and the slot goes back to its setup attachment after the apply.
 */
function applyAttachmentTimeline(
    player: LegacyPlayer,
    timeline: LegacyTimeline,
    blend: number,
    attachments: boolean,
): void {
    const slot = timeline.target;

    if (!slotIsActive(player, slot)) return;
    if (Number(SHARED[TIME]) < Number(timeline.frames[0])) {
        if (blend === SETUP || blend === FIRST) {
            setAttachment(player, slot, player.rig.model.slots.attachments[slot] ?? null, attachments);
        }
    } else {
        const attachment = shownBy(player, timeline)[search(timeline.frames, 1)] ?? null;

        // the official setAttachment, with the attachment in hand
        setSlotAttachment(player.rig, player.pose, slot, attachment);
        if (attachments) player.attachmentState[slot] = player.unkeyedState + STATE_CURRENT;
    }
    // if an attachment was not set, set the setup attachment later
    if (Number(player.attachmentState[slot]) <= player.unkeyedState) {
        player.attachmentState[slot] = player.unkeyedState + STATE_SETUP;
    }
}

/** True when a looping entry finished a loop since it was last applied. The versions decide it differently. */
function loopCompleted(entry: LegacyEntry, v41: boolean): boolean {
    const duration = entry.animationEnd - entry.animationStart;

    if (duration === 0) return true;
    if (v41) return entry.trackLast % duration > entry.trackTime % duration;
    const cycles = Math.floor(entry.trackTime / duration);

    return cycles > 0 && cycles > Math.floor(entry.trackLast / duration);
}

/**
 * The official `queueEvents`: reports the fired events of an entry, with `complete` in its place
 * among them, and empties the list of fired events. The animation time of the entry is read from `SHARED`.
 */
export function queueEvents(player: LegacyPlayer, entry: LegacyEntry): void {
    const { animationStart, animationEnd } = entry;
    const fired = player.fired;
    const n = fired.length;
    let i = 0;

    if (n > 0) {
        const trackLastWrapped = entry.trackLast % (animationEnd - animationStart);

        // events before complete
        for (; i < n; i++) {
            const event = fired[i];

            if (event === undefined || event.time < trackLastWrapped) break;
            // discard events outside animation start and end
            if (event.time > animationEnd) continue;
            queueEvent(player, entry, event);
        }
    }
    // complete, if the entry completed a loop iteration or the animation
    const complete = entry.loop
        ? loopCompleted(entry, player.rig.v41)
        : Number(SHARED[ANIMATION_TIME]) >= animationEnd && entry.animationLast < animationEnd;

    if (complete) queueComplete(player, entry);
    // events after complete
    for (; i < n; i++) {
        const event = fired[i];

        if (event !== undefined && !(event.time < animationStart)) queueEvent(player, entry, event);
    }
    if (n > 0) fired.length = 0;
}

/**
 * Writes the alpha of timeline `i` of an entry that is mixing out to `SHARED` at `ALPHA`. A
 * timeline that fades out gets the mix alpha. A held timeline keeps the hold alpha.
 */
function mixOutAlpha(from: LegacyEntry, i: number, mode: number): void {
    if (mode === SUBSEQUENT || mode === FIRST_TIMELINE) {
        SHARED[ALPHA] = Number(SHARED[ALPHA_MIX]);

        return;
    }
    if (mode === HOLD_SUBSEQUENT || mode === HOLD_FIRST) {
        SHARED[ALPHA] = Number(SHARED[ALPHA_HOLD]);

        return;
    }
    const holdMix = from.timelineHoldMix[i];

    if (holdMix === undefined) {
        // the official runtime crashes here
        throw new MarrowError('invalid-data', 'A track entry is mixed out before its timeline modes were computed.', {
            fix: 'Set mixBlend on a new entry only, before the first update.',
        });
    }
    SHARED[ALPHA] = Number(SHARED[ALPHA_HOLD]) * Math.max(0, 1 - holdMix.mixTime / holdMix.mixDuration);
}

/** One timeline of an entry that is mixing out, unless it is a rotate timeline that keeps its direction. */
function mixOutTimeline(
    player: LegacyPlayer,
    from: LegacyEntry,
    timeline: LegacyTimeline,
    fired: EventKey[] | null,
    blend: number,
    attachments: boolean,
    drawOrder: boolean,
): void {
    if (timeline.kind === K_ATTACHMENT) {
        // 4.1 has no alphaAttachmentThreshold
        const shown = attachments && (player.rig.v41 || Number(SHARED[ALPHA]) >= from.alphaAttachmentThreshold);

        applyAttachmentTimeline(player, timeline, blend, shown);
    } else {
        const direction = drawOrder && timeline.kind === K_DRAW_ORDER && blend === SETUP ? MIX_IN : MIX_OUT;

        applyTimeline(player, timeline, fired, blend, direction);
    }
}

/**
 * The timelines of an entry that is mixing out, for every blend but `add`. Part of
 * `applyMixingFrom`. The mix and the hold alpha are read from `SHARED`.
 */
function mixOutTimelines(player: LegacyPlayer, from: LegacyEntry, blend: number, fired: EventKey[] | null): void {
    const timelines = from.clip.timelines;
    const count = timelines.length;
    const mix = Number(SHARED[MIX]);
    const attachments = mix < from.mixAttachmentThreshold;
    const drawOrder = mix < from.mixDrawOrderThreshold;
    const firstFrame = !from.shortestRotation && from.rotationLength !== count << 1;
    const rotations = rotationsOf(from, count, firstFrame);

    SHARED[ALPHA_MIX] = Number(SHARED[ALPHA_HOLD]) * (1 - mix);
    from.totalAlpha = 0;
    for (let i = 0; i < count; i++) {
        const timeline = timelines[i];
        const mode = from.timelineMode[i] ?? MODE_UNSET;

        if (timeline === undefined) continue;
        if (mode === SUBSEQUENT && !drawOrder && timeline.kind === K_DRAW_ORDER) continue;
        const timelineBlend = mode === SUBSEQUENT || mode === HOLD_SUBSEQUENT ? blend : SETUP;

        mixOutAlpha(from, i, mode);
        from.totalAlpha += Number(SHARED[ALPHA]);
        if (rotations !== null && timeline.kind === K_ROTATE) {
            applyRotateTimeline(player, timeline, timelineBlend, rotations, i << 1, firstFrame);
        } else {
            mixOutTimeline(player, from, timeline, fired, timelineBlend, attachments, drawOrder);
        }
    }
}

/** The timelines of an entry that is mixing out with blend `add`, at the alpha in `SHARED`. Part of `applyMixingFrom`. */
function addOutTimelines(player: LegacyPlayer, from: LegacyEntry, fired: EventKey[] | null): void {
    const timelines = from.clip.timelines;

    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        applyTimeline(player, timeline, fired, ADD, MIX_OUT);
    }
}

/**
 * Writes the official `getAnimationTime` of an entry to `SHARED` at `ANIMATION_TIME`, and the
 * times its timelines are applied with at `LAST_TIME` and `TIME`. A reversed entry is applied at
 * the time counted from the end of its animation.
 */
export function setTimes(entry: LegacyEntry): void {
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

/**
 * The official `applyMixingFrom`: applies the entry `to` mixes from, after the entries that one
 * mixes from. Writes how far the mix is, from 0 to 1, to `SHARED` at `MIX`.
 */
function applyMixingFrom(player: LegacyPlayer, to: LegacyEntry, from: LegacyEntry, trackBlend: number): void {
    if (from.mixingFrom !== null) applyMixingFrom(player, from, from.mixingFrom, trackBlend);
    let mix = 1;
    let blend = trackBlend;

    if (to.mixDuration === 0) {
        // single frame mix to undo mixingFrom changes
        if (blend === FIRST) blend = SETUP;
    } else {
        mix = to.mixTime / to.mixDuration;
        if (mix > 1) mix = 1;
        if (blend !== FIRST) blend = from.mixBlend;
    }
    const alphaHold = from.alpha * to.interruptAlpha;
    const fired = !from.reverse && mix < from.eventThreshold ? player.fired : null;

    // after the entries this one mixes from, which write the same numbers
    setTimes(from);
    SHARED[MIX] = mix;
    SHARED[ALPHA_HOLD] = alphaHold;
    if (blend === ADD) {
        SHARED[ALPHA] = alphaHold * (1 - mix);
        addOutTimelines(player, from, fired);
    } else mixOutTimelines(player, from, blend, fired);
    if (to.mixDuration > 0) queueEvents(player, from);
    else if (player.fired.length > 0) player.fired.length = 0;
    from.nextAnimationLast = Number(SHARED[ANIMATION_TIME]);
    from.nextTrackLast = from.trackTime;
}

/** The timelines of the current entry of a track when it replaces the pose below it or adds to it. */
function plainTimelines(
    player: LegacyPlayer,
    current: LegacyEntry,
    fired: EventKey[] | null,
    blend: number,
    attachments: boolean,
): void {
    const timelines = current.clip.timelines;

    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        if (timeline.kind === K_ATTACHMENT) applyAttachmentTimeline(player, timeline, blend, attachments);
        else applyTimeline(player, timeline, fired, blend, MIX_IN);
    }
}

/** The timelines of the current entry of a track when it is mixed with the pose below it. */
function mixInTimelines(
    player: LegacyPlayer,
    current: LegacyEntry,
    fired: EventKey[] | null,
    blend: number,
    attachments: boolean,
): void {
    const timelines = current.clip.timelines;
    const count = timelines.length;
    const firstFrame = !current.shortestRotation && current.rotationLength !== count << 1;
    const rotations = rotationsOf(current, count, firstFrame);

    for (let i = 0; i < count; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        const timelineBlend = current.timelineMode[i] === SUBSEQUENT ? blend : SETUP;

        if (rotations !== null && timeline.kind === K_ROTATE) {
            applyRotateTimeline(player, timeline, timelineBlend, rotations, i << 1, firstFrame);
        } else if (timeline.kind === K_ATTACHMENT) {
            applyAttachmentTimeline(player, timeline, blend, attachments);
        } else {
            applyTimeline(player, timeline, fired, timelineBlend, MIX_IN);
        }
    }
}

/** Applies the current entry of a track, after the entries it mixes from. */
function applyTrack(player: LegacyPlayer, index: number, current: LegacyEntry): void {
    const blend = index === 0 ? FIRST : current.mixBlend;
    let alpha = current.alpha;

    if (current.mixingFrom !== null) {
        applyMixingFrom(player, current, current.mixingFrom, blend);
        alpha *= Number(SHARED[MIX]);
    } else if (current.trackTime >= current.trackEnd && current.next === null) alpha = 0;
    // 4.1 has no alphaAttachmentThreshold: the current entry always sets attachments
    let attachments = player.rig.v41 || alpha >= current.alphaAttachmentThreshold;
    const fired = current.reverse ? null : player.fired;

    // after the entries this one mixes from, which write the same numbers
    setTimes(current);
    SHARED[ALPHA] = alpha;
    if ((index === 0 && alpha === 1) || blend === ADD) {
        if (index === 0) attachments = true;
        plainTimelines(player, current, fired, blend, attachments);
    } else {
        mixInTimelines(player, current, fired, blend, attachments);
    }
    queueEvents(player, current);
    current.nextAnimationLast = Number(SHARED[ANIMATION_TIME]);
    current.nextTrackLast = current.trackTime;
}

/**
 * What is left of an apply whose timelines need not run: the times of every entry move on, and
 * an entry that completes a loop says so.
 */
function settleTracks(player: LegacyPlayer): void {
    const tracks = player.tracks;

    for (let i = 0, n = tracks.length; i < n; i++) {
        const current = tracks[i] ?? null;

        if (current === null || current.delay > 0) continue;
        setTimes(current);
        queueEvents(player, current);
        current.nextAnimationLast = Number(SHARED[ANIMATION_TIME]);
        current.nextTrackLast = current.trackTime;
    }
}

/** The longest wait between two looks at whether an apply leaves the pose as it is, in applies. */
const LONGEST_WAIT = 64;

/**
 * An apply that repeats the one before. It is first looked at: when it leaves the pose as it
 * was, the applies after it that repeat it too are not run, as rest.ts explains. While it does
 * not, the next look comes after a wait that doubles, so that a pose which keeps moving costs little.
 */
function applyAgain(player: LegacyPlayer): void {
    if (player.settled) {
        settleTracks(player);
    } else if (player.patience-- > 0) {
        poseTracks(player);
    } else {
        keepPose(player);
        poseTracks(player);
        player.settled = poseIsKept(player);
        player.waited = Math.min(Math.max(1, player.waited * 2), LONGEST_WAIT);
        player.patience = player.waited;
    }
}

/**
 * The official `AnimationState.apply`: poses the skeleton with the entries of every track. The
 * timelines are not applied when they would leave the pose as it is.
 *
 * The apply of an animation that plays on is the common one, and it is kept short: what an apply
 * that repeats needs is a function of its own.
 */
export function applyTracks(player: LegacyPlayer): void {
    if (player.animationsChanged) computeHolds(player);
    if (applyRepeats(player)) {
        applyAgain(player);

        return;
    }
    player.stirred = false;
    // a look sets the wait: without one, the other two are as they start
    if (player.waited !== 0) {
        player.settled = false;
        player.patience = 0;
        player.waited = 0;
    }
    poseTracks(player);
}

/** Applies the entries of every track to the pose. */
function poseTracks(player: LegacyPlayer): void {
    const { rig, pose, tracks, attachmentState } = player;

    for (let i = 0, n = tracks.length; i < n; i++) {
        const current = tracks[i] ?? null;

        if (current !== null && !(current.delay > 0)) applyTrack(player, i, current);
    }
    // Slots whose attachment a timeline set for a moment only go back to the setup attachment.
    const setupState = player.unkeyedState + STATE_SETUP;
    const setupNames = rig.model.slots.attachments;

    for (let slot = 0; slot < attachmentState.length; slot++) {
        if (attachmentState[slot] !== setupState) continue;
        setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, setupNames[slot] ?? null));
    }
    // growing with each apply saves resetting the state of every slot
    player.unkeyedState += 2;
}
