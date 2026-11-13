import type { EventKey } from '../../model/timelines';
import {
    applyInherit,
    applyRelative,
    applyRelativePair,
    applyScalePair,
    applyScaleValue,
    LOCAL_ROTATION,
    LOCAL_SCALE_X,
    LOCAL_SCALE_Y,
    LOCAL_SHEAR_X,
    LOCAL_SHEAR_Y,
    LOCAL_X,
    LOCAL_Y,
} from './bones';
import { applyAlpha, applyRgb, applyRgb2, applyRgba, applyRgba2 } from './colors';
import { applyConstraintTimeline } from './constraint-timelines';
import { applyDeform } from './deform';
import { applyPhysicsTimeline } from './physics-timelines';
import type { LegacyPlayer } from './player';
import { applyAttachment, applyDrawOrder, applyEvents, applySequence } from './slots';
import {
    K_ALPHA,
    K_ATTACHMENT,
    K_DEFORM,
    K_DRAW_ORDER,
    K_EVENT,
    K_INHERIT,
    K_PATH_MIX,
    K_RGB,
    K_RGB2,
    K_RGBA,
    K_RGBA2,
    K_ROTATE,
    K_SCALE,
    K_SCALE_X,
    K_SCALE_Y,
    K_SEQUENCE,
    K_SHEAR,
    K_SHEAR_X,
    K_SHEAR_Y,
    K_TRANSLATE,
    K_TRANSLATE_X,
    K_TRANSLATE_Y,
    type LegacyTimeline,
} from './timelines';

/** The timelines of one value of a bone, and the one of its inherit mode. Animations have few of them. */
function applyBoneValueTimeline(
    player: LegacyPlayer,
    timeline: LegacyTimeline,
    blend: number,
    direction: number,
): void {
    const { rig, pose, values } = player;
    const local = pose.local;
    const setup = rig.model.bones.setup;
    const moved = player.solver.moved;
    const v41 = rig.v41;

    switch (timeline.kind) {
        case K_TRANSLATE_X:
            applyRelative(timeline, local, setup, LOCAL_X, blend, v41, moved);
            break;
        case K_TRANSLATE_Y:
            applyRelative(timeline, local, setup, LOCAL_Y, blend, v41, moved);
            break;
        case K_SCALE_X:
            applyScaleValue(timeline, local, setup, LOCAL_SCALE_X, blend, direction, v41, values, moved);
            break;
        case K_SCALE_Y:
            applyScaleValue(timeline, local, setup, LOCAL_SCALE_Y, blend, direction, v41, values, moved);
            break;
        case K_SHEAR_X:
            applyRelative(timeline, local, setup, LOCAL_SHEAR_X, blend, v41, moved);
            break;
        case K_SHEAR_Y:
            applyRelative(timeline, local, setup, LOCAL_SHEAR_Y, blend, v41, moved);
            break;
        case K_INHERIT:
            applyInherit(timeline, pose.inherit, rig.model.bones.inherit, blend, direction, moved);
            break;
    }
}

/**
 * The timelines of a bone. The common ones are told apart here, and the function stays short: V8
 * builds a function into its caller only below a size, and this one runs for most timelines.
 */
function applyBoneTimeline(player: LegacyPlayer, timeline: LegacyTimeline, blend: number, direction: number): void {
    const local = player.pose.local;
    const setup = player.rig.model.bones.setup;
    const moved = player.solver.moved;
    const kind = timeline.kind;

    if (kind === K_ROTATE) applyRelative(timeline, local, setup, LOCAL_ROTATION, blend, false, moved);
    else if (kind === K_TRANSLATE) applyRelativePair(timeline, local, setup, LOCAL_X, blend, player.values, moved);
    else if (kind === K_SCALE) applyScalePair(timeline, local, setup, blend, direction, player.values, moved);
    else if (kind === K_SHEAR) applyRelativePair(timeline, local, setup, LOCAL_SHEAR_X, blend, player.values, moved);
    else applyBoneValueTimeline(player, timeline, blend, direction);
}

function applySlotTimeline(player: LegacyPlayer, timeline: LegacyTimeline, blend: number, direction: number): void {
    const { rig, pose, values } = player;
    const slots = rig.model.slots;

    switch (timeline.kind) {
        case K_RGBA:
            applyRgba(timeline, pose, slots, blend, values);
            break;
        case K_RGB:
            applyRgb(timeline, pose, slots, blend, values);
            break;
        case K_ALPHA:
            applyAlpha(timeline, pose, slots, blend, values);
            break;
        case K_RGBA2:
            applyRgba2(timeline, pose, slots, blend, values);
            break;
        case K_RGB2:
            applyRgb2(timeline, pose, slots, blend, values);
            break;
        case K_ATTACHMENT:
            applyAttachment(rig, pose, timeline, blend, direction);
            break;
        case K_DEFORM:
            if (player.deforms) applyDeform(rig, pose, timeline, blend, values);
            break;
        case K_SEQUENCE:
            applySequence(rig, pose, timeline, blend, direction);
            break;
    }
}

/** True when the bone of a slot is posed. Timelines of a slot on an inactive bone change nothing. */
export function slotIsActive(player: LegacyPlayer, slot: number): boolean {
    return player.pose.active[player.rig.model.slots.bones[slot] ?? -1] === 1;
}

/**
 * Applies one timeline: the official `Timeline.apply` of its kind. `fired` collects events, or is
 * null to fire none.
 *
 * The official `lastTime`, `time` and `alpha` arguments are read from `SHARED`.
 */
export function applyTimeline(
    player: LegacyPlayer,
    timeline: LegacyTimeline,
    fired: EventKey[] | null,
    blend: number,
    direction: number,
): void {
    const kind = timeline.kind;

    if (kind <= K_INHERIT) {
        if (player.pose.active[timeline.target] === 1) applyBoneTimeline(player, timeline, blend, direction);
    } else if (kind <= K_SEQUENCE) {
        if (slotIsActive(player, timeline.target)) applySlotTimeline(player, timeline, blend, direction);
    } else if (kind === K_EVENT) {
        if (fired !== null) applyEvents(timeline, fired);
    } else if (kind === K_DRAW_ORDER) {
        applyDrawOrder(player.pose, timeline, blend, direction);
    } else if (kind <= K_PATH_MIX) {
        applyConstraintTimeline(player.solver, timeline, blend, direction, player.values);
    } else {
        applyPhysicsTimeline(player.solver, timeline, blend, player.values);
    }
}
