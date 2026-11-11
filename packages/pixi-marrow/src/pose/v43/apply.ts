import type { AttachmentData } from '../../model/attachments';
import type { EventKey } from '../../model/timelines';
import { LOCAL_STRIDE } from '../state';
import { curveValue, f32, f64, search } from './curves';
import type { Entry } from './entry';
import { animationsChanged } from './hold';
import { drain, type Player43, queueComplete, queueEvent } from './player';
import { setSlotAttachment, setupAttachment, slotActive } from './slots';
import { keyAttachment } from './timelines-slot';
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

const signum = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * The official `applyAttachmentTimeline`: applies an attachment timeline and notes in the
 * attachment state of the slot whether the attachment stays.
 *
 * @param retain True when the attachment stays after the apply. False when it is there only for
 * the deform timelines of this apply.
 */
function applyAttachmentTimeline(
    player: Player43,
    timeline: Timeline43,
    time: number,
    from: number,
    retain: boolean,
): void {
    const { pose, attachmentStates, unkeyedState } = player;
    const slot = timeline.target;

    if (!slotActive(pose, slot)) return;
    if (!retain && attachmentStates[slot] === unkeyedState + ATTACH_RETAIN) return;
    let setup = time < f32(timeline.frames, 0);
    let name: string | null = null;

    if (!setup) {
        name = timeline.names[search(timeline.frames, time, 1)] ?? null;
        setup = !retain && name === null;
    }
    if (setup) {
        if (from === CURRENT) return;
        setSlotAttachment(pose, slot, setupAttachmentByKey(pose, slot));
    } else {
        setSlotAttachment(pose, slot, keyAttachment(pose, slot, name));
    }
    if (retain) attachmentStates[slot] = unkeyedState + ATTACH_RETAIN;
    else if (!setup) attachmentStates[slot] = unkeyedState + ATTACH_SETUP;
}

/** The setup attachment of a slot, found by its name like the attachment of a key. */
function setupAttachmentByKey(pose: Pose43, slot: number): AttachmentData | null {
    return keyAttachment(pose, slot, pose.rig.model.slots.attachments[slot] ?? null);
}

/**
 * The total rotation of a mix, along the direction that was the shortest on its first frame.
 * The entry remembers the total and the last difference per timeline, to see when the difference
 * crosses half a turn.
 */
function rotationTotal(rotations: Float64Array, i: number, diff: number, firstFrame: boolean): number {
    if (diff === 0) return f64(rotations, i);
    const lastTotal = firstFrame ? 0 : f64(rotations, i);
    const lastDiff = firstFrame ? diff : f64(rotations, i + 1);
    const loops = lastTotal - (lastTotal % 360);
    const current = diff >= 0;
    let total = diff + loops;
    let dir = lastTotal >= 0;

    if (Math.abs(lastDiff) <= 90 && signum(lastDiff) !== signum(diff)) {
        if (Math.abs(lastTotal - loops) > 180) {
            total += 360 * signum(lastTotal);
            dir = current;
        } else if (loops !== 0) total -= 360 * signum(lastTotal);
        else dir = current;
    }
    if (dir !== current) total += 360 * signum(lastTotal);
    rotations[i] = total;

    return total;
}

/**
 * The official `applyRotateTimeline`: mixes a rotate timeline with the pose and keeps the
 * direction of rotation that was chosen when the mix began.
 */
function applyRotateTimeline(
    pose: Pose43,
    timeline: Timeline43,
    time: number,
    alpha: number,
    from: number,
    rotations: Float64Array,
    i: number,
    firstFrame: boolean,
): void {
    if (firstFrame) rotations[i] = 0;
    if (alpha === 1) {
        timeline.apply(pose, timeline, 0, time, null, 1, from, false, false);

        return;
    }
    const { local, active } = pose.state;
    const bone = timeline.target;

    if (active[bone] !== 1) return;
    const index = bone * LOCAL_STRIDE + ROTATION;
    const setup = f64(pose.rig.model.bones.setup, index);
    let r1 = f64(local, index);
    let r2 = setup;

    if (time < f32(timeline.frames, 0)) {
        if (from === SETUP) local[index] = setup;
        if (from === SETUP || from === CURRENT) return;
    } else {
        if (from === SETUP) r1 = setup;
        r2 = setup + curveValue(timeline.frames, timeline.curves, time);
    }
    // mix between the rotations along the shortest route of the first frame, and detect crosses
    let diff = r2 - r1;

    diff -= Math.ceil(diff / 360 - 0.5) * 360;
    const total = rotationTotal(rotations, i, diff, firstFrame);

    rotations[i + 1] = diff;
    local[index] = r1 + total * alpha;
}

/** The official `queueEvents`: queues the events an entry fired and its `complete` call, in order. */
function queueEvents(player: Player43, entry: Entry, animationTime: number): void {
    const { animationStart, animationEnd, reverse } = entry;
    const duration = animationEnd - animationStart;
    const split = reverse ? duration - (entry.trackLast % duration) : entry.trackLast % duration;
    const events = player.fired;
    const n = events.length;
    let i = 0;

    // the events before the animation completed
    for (; i < n; i++) {
        const event = events[i];

        if (event === undefined || event.time < split !== reverse) break;
        if (event.time >= animationStart && event.time <= animationEnd) queueEvent(player, entry, event);
    }
    if (completed(entry, duration, animationTime)) queueComplete(player, entry);
    // the events after it
    for (; i < n; i++) {
        const event = events[i];

        if (event !== undefined && event.time >= animationStart && event.time <= animationEnd) {
            queueEvent(player, entry, event);
        }
    }
}

/** True when the entry completed its animation, or a loop of it, since it was last applied. */
function completed(entry: Entry, duration: number, animationTime: number): boolean {
    if (!entry.loop) return animationTime >= entry.animationEnd && entry.animationLast < entry.animationEnd;
    if (duration === 0) return true;
    const cycles = Math.floor(entry.trackTime / duration);

    return cycles > 0 && cycles > Math.floor(entry.trackLast / duration);
}

function pushEvent(events: EventKey[], timeline: Timeline43, index: number): void {
    const event = timeline.events[index];

    if (event !== undefined) events.push(event);
}

/** The events of one event timeline that a reversed entry passed between two applies. */
function reversedEvents(events: EventKey[], timeline: Timeline43, from: number, to: number): void {
    const frames = timeline.frames;
    const frameCount = frames.length;
    let i = 0;

    if (from >= to) {
        for (; i < frameCount; i++) {
            if (f32(frames, i) < to) continue;
            if (f32(frames, i) >= from) break;
            pushEvent(events, timeline, i);
        }

        return;
    }
    // the animation looped: from the last apply down to 0, then from the end down to this apply
    for (; i < frameCount && !(f32(frames, i) >= from); i++) pushEvent(events, timeline, i);
    i = 0;
    while (i < frameCount && !(f32(frames, i) >= to)) i++;
    for (; i < frameCount; i++) pushEvent(events, timeline, i);
}

/** The official `eventsReverse`: collects the events of an entry that plays in reverse. */
function eventsReverse(player: Player43, entry: Entry, animationLast: number, animationTime: number): void {
    const { duration, timelines } = entry.clip;

    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline?.role !== ROLE_EVENT) continue;
        reversedEvents(player.fired, timeline, duration - animationLast, duration - animationTime);
    }
}

/** Applies an entry on track 0 at full alpha: every timeline replaces the setup pose. */
function applyFromSetup(
    player: Player43,
    entry: Entry,
    animationLast: number,
    time: number,
    events: EventKey[] | null,
): void {
    const pose = player.pose;
    const timelines = entry.clip.timelines;

    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        if (timeline.role === ROLE_ATTACHMENT) applyAttachmentTimeline(player, timeline, time, SETUP, true);
        else timeline.apply(pose, timeline, animationLast, time, events, 1, SETUP, false, false);
    }
}

/** Applies the current entry of a track with the modes of its timelines. */
function applyMixed(
    player: Player43,
    entry: Entry,
    animationLast: number,
    time: number,
    events: EventKey[] | null,
    alpha: number,
): void {
    const pose = player.pose;
    const timelines = entry.clip.timelines;
    const count = timelines.length;
    const retain = alpha >= entry.alphaAttachmentThreshold;
    const add = entry.additive;
    const shortestRotation = add || entry.shortestRotation;
    const firstFrame = !shortestRotation && entry.rotationCount !== count << 1;

    if (firstFrame) entry.sizeRotations(count << 1);
    for (let i = 0; i < count; i++) {
        const timeline = timelines[i];

        if (timeline === undefined) continue;
        const from = (entry.modes[i] ?? 0) & MODE;

        if (!shortestRotation && timeline.role === ROLE_ROTATE) {
            applyRotateTimeline(pose, timeline, time, alpha, from, entry.rotations, i << 1, firstFrame);
        } else if (timeline.role === ROLE_ATTACHMENT) {
            applyAttachmentTimeline(player, timeline, time, from, retain);
        } else {
            timeline.apply(pose, timeline, animationLast, time, events, alpha, from, add, false);
        }
    }
}

/** The alpha of a held timeline of an entry that is mixed out. A later mix can fade the hold out. */
function heldAlpha(from: Entry, i: number, alphaHold: number): number {
    const holdMix = from.holdMix[i];

    return holdMix == null ? alphaHold : alphaHold * (1 - holdMix.mix());
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
 * A timeline that fades out with the mix gets `alphaMix`. A held timeline gets `alphaHold`.
 * The flags `attachments` and `drawOrder` are true while the mix is below the entry's threshold
 * for them.
 */
function applyMixedOut(
    player: Player43,
    from: Entry,
    animationLast: number,
    time: number,
    events: EventKey[] | null,
    alphaMix: number,
    alphaHold: number,
    attachments: boolean,
    drawOrder: boolean,
): void {
    const pose = player.pose;
    const timelines = from.clip.timelines;
    const count = timelines.length;
    const add = from.additive;
    const shortestRotation = add || from.shortestRotation;
    const firstFrame = !shortestRotation && from.rotationCount !== count << 1;

    if (firstFrame) from.sizeRotations(count << 1);
    from.totalAlpha = 0;
    for (let i = 0; i < count; i++) {
        const timeline = timelines[i];
        const mode = from.modes[i] ?? 0;
        const mix = mode & MODE;

        if (timeline === undefined || leavesDrawOrder(timeline, mode, drawOrder)) continue;
        const alpha = (mode & HOLD) !== 0 ? heldAlpha(from, i, alphaHold) : alphaMix;

        from.totalAlpha += alpha;
        if (!shortestRotation && timeline.role === ROLE_ROTATE) {
            applyRotateTimeline(pose, timeline, time, alpha, mix, from.rotations, i << 1, firstFrame);
        } else if (timeline.role === ROLE_ATTACHMENT) {
            const retain = attachments && alpha >= from.alphaAttachmentThreshold;

            applyAttachmentTimeline(player, timeline, time, mix, retain);
        } else {
            // a draw order timeline that owns the draw order goes on while the mix is below its threshold
            const out = !drawOrder || timeline.role !== ROLE_DRAW_ORDER || mix === CURRENT;

            timeline.apply(pose, timeline, animationLast, time, events, alpha, mix, add, out);
        }
    }
}

/**
 * The official `applyMixingFrom`: applies the entries `to` mixes from, oldest first, each at the
 * alpha the mix leaves it. Returns how far the mix to `to` is.
 */
function applyMixingFrom(player: Player43, to: Entry, from: Entry): number {
    const fromMix = from.mixingFrom !== null ? applyMixingFrom(player, from, from.mixingFrom) : 1;
    const mix = to.mix();
    const a = from.alpha * fromMix;
    const keep = 1 - mix * to.alpha;
    const alphaMix = a * (1 - mix);
    const alphaHold = keep > 0 ? alphaMix / keep : a;
    const attachments = mix < from.mixAttachmentThreshold;
    const drawOrder = mix < from.mixDrawOrderThreshold;
    const animationLast = from.animationLast;
    const animationTime = from.getAnimationTime();
    let applyTime = animationTime;
    let events: EventKey[] | null = null;

    if (from.reverse) applyTime = from.clip.duration - applyTime;
    else if (mix < from.eventThreshold) events = player.fired;
    applyMixedOut(player, from, animationLast, applyTime, events, alphaMix, alphaHold, attachments, drawOrder);
    if (from.reverse && mix < from.eventThreshold) eventsReverse(player, from, animationLast, animationTime);
    if (to.mixDuration > 0) queueEvents(player, from, animationTime);
    player.fired.length = 0;
    from.nextAnimationLast = animationTime;
    from.nextTrackLast = from.trackTime;

    return mix;
}

/** Applies the current entry of a track, after the entries it mixes from. */
function applyCurrent(player: Player43, current: Entry, track: number): void {
    let alpha = current.alpha;

    if (current.mixingFrom) alpha *= applyMixingFrom(player, current, current.mixingFrom);
    else if (current.trackTime >= current.trackEnd && !current.next) alpha = 0;
    const animationLast = current.animationLast;
    const animationTime = current.getAnimationTime();
    const applyTime = current.reverse ? current.clip.duration - animationTime : animationTime;
    const events = current.reverse ? null : player.fired;

    if (track === 0 && alpha === 1) applyFromSetup(player, current, animationLast, applyTime, events);
    else applyMixed(player, current, animationLast, applyTime, events, alpha);
    if (current.reverse) eventsReverse(player, current, animationLast, animationTime);
    queueEvents(player, current, animationTime);
    player.fired.length = 0;
    current.nextAnimationLast = animationTime;
    current.nextTrackLast = current.trackTime;
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
