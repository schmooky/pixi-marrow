import { MarrowError } from '../../base/errors';
import type { EventKey } from '../../model/timelines';
import { LOCAL_STRIDE } from '../state';
import { applyTimeline, slotIsActive } from './apply-timeline';
import { LOCAL_ROTATION } from './bones';
import { curveValues, search } from './curves';
import { type LegacyEntry, MODE_UNSET } from './entry';
import { computeHolds, FIRST_TIMELINE, HOLD_FIRST, HOLD_SUBSEQUENT, SUBSEQUENT } from './hold';
import { type LegacyPlayer, queueComplete, queueEvent } from './player';
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

const signum = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

/** The official `AnimationState.setAttachment`. */
function setAttachment(player: LegacyPlayer, slot: number, name: string | null, attachments: boolean): void {
    const { rig, pose } = player;

    setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, name));
    if (attachments) player.attachmentState[slot] = player.unkeyedState + STATE_CURRENT;
}

/**
 * The official `applyAttachmentTimeline`. With `attachments` false the attachment is set for
 * later timelines to see, and the slot goes back to its setup attachment after the apply.
 */
function applyAttachmentTimeline(
    player: LegacyPlayer,
    timeline: LegacyTimeline,
    time: number,
    blend: number,
    attachments: boolean,
): void {
    const slot = timeline.target;

    if (!slotIsActive(player, slot)) return;
    if (time < Number(timeline.frames[0])) {
        if (blend === SETUP || blend === FIRST) {
            setAttachment(player, slot, player.rig.model.slots.attachments[slot] ?? null, attachments);
        }
    } else {
        const name = timeline.attachmentNames[search(timeline.frames, time, 1)] ?? null;

        setAttachment(player, slot, name, attachments);
    }
    // if an attachment was not set, set the setup attachment later
    if (Number(player.attachmentState[slot]) <= player.unkeyedState) {
        player.attachmentState[slot] = player.unkeyedState + STATE_SETUP;
    }
}

/**
 * The rotation numbers of an entry for this apply, or null for an entry with `shortestRotation`,
 * whose rotate timelines are applied like any other. On the first frame of a mix the numbers
 * start unwritten: the official `timelinesRotation.length = count << 1`.
 */
function rotationsOf(entry: LegacyEntry, count: number, firstFrame: boolean): Float64Array | null {
    if (entry.shortestRotation) return null;
    if (!firstFrame) return entry.timelinesRotation;
    let rotations = entry.timelinesRotation;

    if (rotations === null) {
        rotations = new Float64Array(count << 1);
        entry.timelinesRotation = rotations;
    }
    rotations.fill(Number.NaN);
    entry.rotationLength = count << 1;

    return rotations;
}

/*
 * The two functions below take the new difference from `values[0]`, the last total rotation from
 * `rotations[i]` and the last difference from `rotations[i + 1]`. They write the new total to
 * `rotations[i]`. Numbers passed to a call or returned from it can cost an allocation.
 */

/** The total rotation of a mix in 4.1. */
function totalRotation41(rotations: Float64Array, i: number, values: Float64Array): void {
    const diff = Number(values[0]);
    const lastDiff = Number(rotations[i + 1]);
    let lastTotal = Number(rotations[i]);
    const current = diff > 0;
    let dir = lastTotal >= 0;

    // detect cross at 0 (not 180)
    if (signum(lastDiff) !== signum(diff) && Math.abs(lastDiff) <= 90) {
        // a cross after a 360 rotation is a loop
        if (Math.abs(lastTotal) > 180) lastTotal += 360 * signum(lastTotal);
        dir = current;
    }
    let total = diff + lastTotal - (lastTotal % 360);

    if (dir !== current) total += 360 * signum(lastTotal);
    rotations[i] = total;
}

/** The total rotation of a mix in 4.2. */
function totalRotation42(rotations: Float64Array, i: number, values: Float64Array): void {
    const diff = Number(values[0]);
    const lastDiff = Number(rotations[i + 1]);
    const lastTotal = Number(rotations[i]);
    const loops = lastTotal - (lastTotal % 360);
    let total = diff + loops;
    const current = diff >= 0;
    let dir = lastTotal >= 0;

    if (Math.abs(lastDiff) <= 90 && signum(lastDiff) !== signum(diff)) {
        if (Math.abs(lastTotal - loops) > 180) {
            total += 360 * signum(lastTotal);
            dir = current;
        } else if (loops !== 0) {
            total -= 360 * signum(lastTotal);
        } else {
            dir = current;
        }
    }
    if (dir !== current) total += 360 * signum(lastTotal);
    rotations[i] = total;
}

/**
 * The official `applyRotateTimeline`: mixes a rotation along the shortest way on the first frame
 * of a mix and keeps that direction afterwards. `i` is the index of the entry's two rotation numbers.
 */
function applyRotateTimeline(
    player: LegacyPlayer,
    timeline: LegacyTimeline,
    time: number,
    alpha: number,
    blend: number,
    rotations: Float64Array,
    i: number,
    firstFrame: boolean,
): void {
    if (firstFrame) rotations[i] = 0;
    if (alpha === 1) {
        applyTimeline(player, timeline, time, null, 1, blend, MIX_IN);

        return;
    }
    const { rig, pose, values } = player;
    const bone = timeline.target;

    if (pose.active[bone] !== 1) return;
    const at = bone * LOCAL_STRIDE + LOCAL_ROTATION;
    const setup = Number(rig.model.bones.setup[at]);
    let r1 = 0;
    let r2 = 0;

    if (time < Number(timeline.frames[0])) {
        if (blend === SETUP) pose.local[at] = setup;
        if (blend !== FIRST) return;
        r1 = Number(pose.local[at]);
        r2 = setup;
    } else {
        curveValues(timeline.frames, timeline.curves, time, 2, values);
        r1 = blend === SETUP ? setup : Number(pose.local[at]);
        r2 = setup + Number(values[0]);
    }
    // mix between rotations using the direction of the shortest route on the first frame while detecting crosses
    let diff = r2 - r1;

    diff -= rig.v41 ? (16384 - ((16384.499999999996 - diff / 360) | 0)) * 360 : Math.ceil(diff / 360 - 0.5) * 360;
    if (diff !== 0) {
        // on the first frame the last total is 0, as set above, and the last difference is the new one
        if (firstFrame) rotations[i + 1] = diff;
        values[0] = diff;
        if (rig.v41) totalRotation41(rotations, i, values);
        else totalRotation42(rotations, i, values);
    }
    rotations[i + 1] = diff;
    pose.local[at] = r1 + Number(rotations[i]) * alpha;
}

/** True when a looping entry finished a loop since it was last applied. The versions decide it differently. */
function loopCompleted(entry: LegacyEntry, duration: number, trackLastWrapped: number, v41: boolean): boolean {
    if (duration === 0) return true;
    if (v41) return trackLastWrapped > entry.trackTime % duration;
    const cycles = Math.floor(entry.trackTime / duration);

    return cycles > 0 && cycles > Math.floor(entry.trackLast / duration);
}

/** The official `queueEvents`: reports the fired events of an entry, with `complete` in its place among them. */
function queueEvents(player: LegacyPlayer, entry: LegacyEntry, animationTime: number): void {
    const { animationStart, animationEnd } = entry;
    const duration = animationEnd - animationStart;
    const trackLastWrapped = entry.trackLast % duration;
    const fired = player.fired;
    const n = fired.length;
    let i = 0;

    // events before complete
    for (; i < n; i++) {
        const event = fired[i];

        if (event === undefined || event.time < trackLastWrapped) break;
        // discard events outside animation start and end
        if (event.time > animationEnd) continue;
        queueEvent(player, entry, event);
    }
    // complete, if the entry completed a loop iteration or the animation
    const complete = entry.loop
        ? loopCompleted(entry, duration, trackLastWrapped, player.rig.v41)
        : animationTime >= animationEnd && entry.animationLast < animationEnd;

    if (complete) queueComplete(player, entry);
    // events after complete
    for (; i < n; i++) {
        const event = fired[i];

        if (event !== undefined && !(event.time < animationStart)) queueEvent(player, entry, event);
    }
}

/** The alpha of timeline `i` of an entry that is mixing out. Held timelines keep their alpha. */
function mixOutAlpha(from: LegacyEntry, i: number, mode: number, alphaHold: number, alphaMix: number): number {
    if (mode === SUBSEQUENT || mode === FIRST_TIMELINE) return alphaMix;
    if (mode === HOLD_SUBSEQUENT || mode === HOLD_FIRST) return alphaHold;
    const holdMix = from.timelineHoldMix[i];

    if (holdMix === undefined) {
        // the official runtime crashes here
        throw new MarrowError('invalid-data', 'A track entry is mixed out before its timeline modes were computed.', {
            fix: 'Set mixBlend on a new entry only, before the first update.',
        });
    }

    return alphaHold * Math.max(0, 1 - holdMix.mixTime / holdMix.mixDuration);
}

/** One timeline of an entry that is mixing out, unless it is a rotate timeline that keeps its direction. */
function mixOutTimeline(
    player: LegacyPlayer,
    from: LegacyEntry,
    timeline: LegacyTimeline,
    applyTime: number,
    fired: EventKey[] | null,
    alpha: number,
    blend: number,
    attachments: boolean,
    drawOrder: boolean,
): void {
    if (timeline.kind === K_ATTACHMENT) {
        // 4.1 has no alphaAttachmentThreshold
        const shown = attachments && (player.rig.v41 || alpha >= from.alphaAttachmentThreshold);

        applyAttachmentTimeline(player, timeline, applyTime, blend, shown);
    } else {
        const direction = drawOrder && timeline.kind === K_DRAW_ORDER && blend === SETUP ? MIX_IN : MIX_OUT;

        applyTimeline(player, timeline, applyTime, fired, alpha, blend, direction);
    }
}

/** The timelines of an entry that is mixing out, for every blend but `add`. Part of `applyMixingFrom`. */
function mixOutTimelines(
    player: LegacyPlayer,
    from: LegacyEntry,
    mix: number,
    blend: number,
    alphaHold: number,
    applyTime: number,
    fired: EventKey[] | null,
): void {
    const timelines = from.clip.timelines;
    const count = timelines.length;
    const alphaMix = alphaHold * (1 - mix);
    const attachments = mix < from.mixAttachmentThreshold;
    const drawOrder = mix < from.mixDrawOrderThreshold;
    const firstFrame = !from.shortestRotation && from.rotationLength !== count << 1;
    const rotations = rotationsOf(from, count, firstFrame);

    from.totalAlpha = 0;
    for (let i = 0; i < count; i++) {
        const timeline = timelines[i];
        const mode = from.timelineMode[i] ?? MODE_UNSET;

        if (timeline === undefined) continue;
        if (mode === SUBSEQUENT && !drawOrder && timeline.kind === K_DRAW_ORDER) continue;
        const timelineBlend = mode === SUBSEQUENT || mode === HOLD_SUBSEQUENT ? blend : SETUP;
        const alpha = mixOutAlpha(from, i, mode, alphaHold, alphaMix);

        from.totalAlpha += alpha;
        if (rotations !== null && timeline.kind === K_ROTATE) {
            applyRotateTimeline(player, timeline, applyTime, alpha, timelineBlend, rotations, i << 1, firstFrame);
        } else {
            mixOutTimeline(player, from, timeline, applyTime, fired, alpha, timelineBlend, attachments, drawOrder);
        }
    }
}

/** The timelines of an entry that is mixing out with blend `add`. Part of `applyMixingFrom`. */
function addOutTimelines(
    player: LegacyPlayer,
    from: LegacyEntry,
    applyTime: number,
    fired: EventKey[] | null,
    alphaMix: number,
): void {
    const timelines = from.clip.timelines;

    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        applyTimeline(player, timeline, applyTime, fired, alphaMix, ADD, MIX_OUT);
    }
}

/**
 * The official `applyMixingFrom`: applies the entry `to` mixes from, after the entries that one
 * mixes from. Returns how far the mix is, from 0 to 1.
 */
function applyMixingFrom(player: LegacyPlayer, to: LegacyEntry, from: LegacyEntry, trackBlend: number): number {
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
    const animationTime = from.getAnimationTime();
    let applyTime = animationTime;
    let fired: EventKey[] | null = null;

    if (from.reverse) applyTime = from.clip.duration - applyTime;
    else if (mix < from.eventThreshold) fired = player.fired;
    player.lastTime = from.animationLast;
    if (blend === ADD) addOutTimelines(player, from, applyTime, fired, alphaHold * (1 - mix));
    else mixOutTimelines(player, from, mix, blend, alphaHold, applyTime, fired);
    if (to.mixDuration > 0) queueEvents(player, from, animationTime);
    player.fired.length = 0;
    from.nextAnimationLast = animationTime;
    from.nextTrackLast = from.trackTime;

    return mix;
}

/** The timelines of the current entry of a track when it replaces the pose below it or adds to it. */
function plainTimelines(
    player: LegacyPlayer,
    current: LegacyEntry,
    applyTime: number,
    fired: EventKey[] | null,
    alpha: number,
    blend: number,
    attachments: boolean,
): void {
    const timelines = current.clip.timelines;

    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        if (timeline.kind === K_ATTACHMENT) {
            applyAttachmentTimeline(player, timeline, applyTime, blend, attachments);
        } else {
            applyTimeline(player, timeline, applyTime, fired, alpha, blend, MIX_IN);
        }
    }
}

/** The timelines of the current entry of a track when it is mixed with the pose below it. */
function mixInTimelines(
    player: LegacyPlayer,
    current: LegacyEntry,
    applyTime: number,
    fired: EventKey[] | null,
    alpha: number,
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
            applyRotateTimeline(player, timeline, applyTime, alpha, timelineBlend, rotations, i << 1, firstFrame);
        } else if (timeline.kind === K_ATTACHMENT) {
            applyAttachmentTimeline(player, timeline, applyTime, blend, attachments);
        } else {
            applyTimeline(player, timeline, applyTime, fired, alpha, timelineBlend, MIX_IN);
        }
    }
}

/** Applies the current entry of a track, after the entries it mixes from. */
function applyTrack(player: LegacyPlayer, index: number, current: LegacyEntry): void {
    const blend = index === 0 ? FIRST : current.mixBlend;
    let alpha = current.alpha;

    if (current.mixingFrom !== null) alpha *= applyMixingFrom(player, current, current.mixingFrom, blend);
    else if (current.trackTime >= current.trackEnd && current.next === null) alpha = 0;
    // 4.1 has no alphaAttachmentThreshold: the current entry always sets attachments
    let attachments = player.rig.v41 || alpha >= current.alphaAttachmentThreshold;
    const animationTime = current.getAnimationTime();
    let applyTime = animationTime;
    let fired: EventKey[] | null = player.fired;

    if (current.reverse) {
        applyTime = current.clip.duration - applyTime;
        fired = null;
    }
    // after the entries this one mixes from, which set their own
    player.lastTime = current.animationLast;
    if ((index === 0 && alpha === 1) || blend === ADD) {
        if (index === 0) attachments = true;
        plainTimelines(player, current, applyTime, fired, alpha, blend, attachments);
    } else {
        mixInTimelines(player, current, applyTime, fired, alpha, blend, attachments);
    }
    queueEvents(player, current, animationTime);
    player.fired.length = 0;
    current.nextAnimationLast = animationTime;
    current.nextTrackLast = current.trackTime;
}

/** The official `AnimationState.apply`: poses the skeleton with the entries of every track. */
export function applyTracks(player: LegacyPlayer): void {
    const { rig, pose, tracks, attachmentState } = player;

    if (player.animationsChanged) computeHolds(player);
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
