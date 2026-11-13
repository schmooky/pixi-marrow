import { i16, i32 } from '../geometry/read';
import { isNewer, type PoseState } from '../pose/state';
import type { BatchElement } from './batch-element';
import { POSITIONS_CHANGED } from './batch-pack';
import { weightBones } from './drafts';
import { placeEntry, showSequence, tintEntry } from './entry-pose';
import { u8 } from './read';
import type { ViewStats } from './stats';
import type { Template } from './template';
import { NO_CLIP, type VisibleList } from './visible';

/*
 * What a pose changed for a view, read from the stamps of the pose. An engine stamps a bone when
 * its world transform or its activity changed and a slot when its color, attachment, sequence
 * index or deform changed, see `PoseState`. A view remembers the version it drew last and does
 * the work of what is newer:
 *
 * - The vertices of a slot are placed again when the slot is newer, or a bone that moves them.
 *   A region and a mesh without weights hang on the bone of the slot. A weighted mesh hangs on
 *   the bones of its vertices, which the layout lists once per mesh.
 * - The colors of a slot are written again when the slot is newer.
 * - The list of visible slots is made again when the draw order is newer, and when a slot that
 *   is newer shows another attachment or has an alpha that reached 0 or left it.
 * - The slots inside a clip are cut again when one of them was placed, or the polygon of the clip.
 *
 * A stamp may move although the value stayed, so the work is never less than the change.
 */

/** What one pass over the visible entries did. A view keeps one object and reads it after {@link poseEntries}. */
export interface PosePass {
    /** The version of the pose the view drew last. A pass does the work of what is newer. */
    seen: number;
    /** The version the view had drawn before its last pass: what is newer moved in that pass. */
    before: number;
    /** True when the last update of the view found nothing to do and made no pass. */
    skipped: boolean;
    /** True when every entry is placed and colored, whatever the stamps say: a first pose, a new layout, another mode. */
    all: boolean;
    /** Entries whose vertices were placed on the CPU and go to the GPU. */
    placed: number;
    /** Bones whose world transform went to the GPU, for a vertex shader that places vertices. 0 elsewhere. */
    skinned: number;
    /** The vertices that were placed: the first one and the one behind the last. */
    from: number;
    to: number;
    /** True when an entry inside a clip was placed: its triangles are cut again. */
    cut: boolean;
    /** Entries whose colors were written, and their vertices: the first one and the one behind the last. */
    colored: number;
    colorFrom: number;
    colorTo: number;
    /** Entries whose sequence showed another region: their texture coordinates were rewritten. */
    framed: number;
    /** True when such a region is on a page of another group of 8, which is another draw range of the mesh mode. */
    regrouped: boolean;
    /** True when the alpha of an entry with an opaque rectangle changed: it can hide other slots, or no longer. */
    recolored: boolean;
}

/**
 * A pass that has drawn no pose yet.
 *
 * @example
 * const pass = createPosePass();
 * poseEntries(pass, template, state, model.slots.bones, model.slots.hasDark, seen, undefined);
 */
export function createPosePass(): PosePass {
    return {
        seen: 0,
        before: 0,
        skipped: false,
        all: true,
        placed: 0,
        skinned: 0,
        from: 0,
        to: 0,
        cut: false,
        colored: 0,
        colorFrom: 0,
        colorTo: 0,
        framed: 0,
        regrouped: false,
        recolored: false,
    };
}

/** The marks of a view that draws in no batch. */
const NO_MARKS = new Int32Array(0);

/**
 * Whether a bone that moves the vertices of an attachment is newer than a version: the bone of
 * its slot, or for weighted vertices one of the bones they hang on.
 *
 * @param list The bones weighted vertices hang on, see `weightBones`, or null for vertices on the bone of the slot.
 * @param bone The bone of the slot.
 *
 * @example
 * if (bonesMoved(state, template.weights[entry] ?? null, bone, seen)) placeEntry(template, state, bones, entry, slot);
 */
export function bonesMoved(state: PoseState, list: Int16Array | null, bone: number, seen: number): boolean {
    const { boneStamps } = state;

    if (list === null) return isNewer(Number(boneStamps[bone]), seen);
    for (let i = 0; i < list.length; i++) {
        if (isNewer(Number(boneStamps[Number(list[i])]), seen)) return true;
    }

    return false;
}

/**
 * Whether the polygon of a clip that cuts a visible slot is newer than a version: the slot of
 * its clipping attachment, or a bone that moves its vertices.
 *
 * @param bones The bone of each slot.
 *
 * @example
 * if (pass.cut || clipsMoved(state, seen, model.slots.bones, pass.seen)) clipCode()?.pose(element, state);
 */
export function clipsMoved(state: PoseState, visible: VisibleList, bones: Int16Array, seen: number): boolean {
    const { clips, count, shown } = visible;
    let last = NO_CLIP;

    for (let i = 0; i < count; i++) {
        const clip = i16(clips, i);

        if (clip === last || clip === NO_CLIP) continue;
        last = clip;
        const attachment = shown[clip];

        if (isNewer(Number(state.slotStamps[clip]), seen)) return true;
        if (attachment?.type !== 'clipping') continue;
        if (bonesMoved(state, attachment.bones === null ? null : weightBones(attachment), i16(bones, clip), seen)) {
            return true;
        }
    }

    return false;
}

/**
 * Shows the region of a sequence the slot of an entry is at, and notes it in the pass. It runs
 * before the vertices of the entry are placed: every region of a sequence has offsets of its own.
 *
 * @example
 * if (newer) frameEntry(pass, template, state, entry, slot, undefined);
 */
export function frameEntry(
    pass: PosePass,
    template: Template,
    state: PoseState,
    entry: number,
    slot: number,
    element: BatchElement | undefined,
): void {
    const shown = i32(template.frameCounts, entry) > 1 ? showSequence(template, state, entry, slot) : 0;

    if (shown === 0) return;
    pass.framed++;
    element?.mark(entry);
    if (shown > 1) pass.regrouped = true;
}

/**
 * Writes the colors of an entry when they are other ones than its vertices hold, and notes it in the pass.
 *
 * @example
 * if (newer) colorEntry(pass, template, state, model.slots.hasDark, entry, slot, undefined);
 */
export function colorEntry(
    pass: PosePass,
    template: Template,
    state: PoseState,
    hasDark: Uint8Array,
    entry: number,
    slot: number,
    element: BatchElement | undefined,
): void {
    const { light } = template;
    const alpha = u8(light, entry * 4 + 3);

    if (!tintEntry(template, state, hasDark, entry, slot)) return;
    const start = i32(template.first, entry);
    const end = start + i32(template.counts, entry);

    pass.colored++;
    if (start < pass.colorFrom) pass.colorFrom = start;
    if (end > pass.colorTo) pass.colorTo = end;
    element?.mark(entry);
    // the alpha of a slot with an opaque rectangle decides whether it can hide others
    if (u8(light, entry * 4 + 3) !== alpha && i32(template.opaqueAt, entry) >= 0) pass.recolored = true;
}

/**
 * Brings the vertex data of the visible entries in line with a pose: positions, colors and the
 * regions of sequences. Only what the stamps of the pose call newer than `pass.seen` is done,
 * and everything with `pass.all`. The pass says what was done.
 *
 * An element of a batch is told which entries changed, so that it packs those.
 *
 * The loop is the cost of an update in which everything moves, so it calls as little as it can.
 * These are the kernel that places an entry, and two small functions for a slot that is newer.
 *
 * @param bones The bone of each slot.
 * @param hasDark Per slot: 1 when the slot has a dark color.
 *
 * @example
 * poseEntries(pass, template, state, model.slots.bones, model.slots.hasDark, seen, paints.element);
 * if (pass.placed > 0) positions.update();
 */
export function poseEntries(
    pass: PosePass,
    template: Template,
    state: PoseState,
    bones: Int16Array,
    hasDark: Uint8Array,
    visible: VisibleList,
    element: BatchElement | undefined,
): void {
    const { list, count, clips } = visible;
    const { slotStamps } = state;
    const { seen, all } = pass;
    const { first, counts, slots, weights } = template;
    // an element packs the entries whose positions are marked: the mark is written here, without a call
    const marks = element === undefined ? NO_MARKS : element.state;
    const marksAt = element === undefined ? 0 : element.changedAt;
    let placed = 0;
    let from = template.vertexCount;
    let to = 0;
    let cut = false;

    pass.colored = 0;
    pass.colorFrom = template.vertexCount;
    pass.colorTo = 0;
    pass.framed = 0;
    pass.skinned = 0;
    pass.regrouped = false;
    pass.recolored = false;
    for (let i = 0; i < count; i++) {
        const entry = i32(list, i);
        const slot = i32(slots, entry);
        const vertices = i32(counts, entry);
        const start = i32(first, entry);
        const newer = all || isNewer(Number(slotStamps[slot]), seen);

        // a hollow entry has no vertex to place or to color
        if (vertices === 0) continue;
        if (!newer && !bonesMoved(state, weights[entry] ?? null, i16(bones, slot), seen)) continue;
        if (newer) frameEntry(pass, template, state, entry, slot, element);
        placeEntry(template, state, bones, entry, slot);
        placed++;
        from = Math.min(from, start);
        to = Math.max(to, start + vertices);
        if (i16(clips, i) !== NO_CLIP) cut = true;
        if (element !== undefined) marks[marksAt + entry] = Number(marks[marksAt + entry]) | POSITIONS_CHANGED;
        if (newer) colorEntry(pass, template, state, hasDark, entry, slot, element);
    }
    if (placed > 0 && element !== undefined) element.dirty = true;
    pass.placed = placed;
    pass.from = from;
    pass.to = to;
    pass.cut = cut;
}

/**
 * Counts in the stats of a view what a pass over its visible entries did.
 *
 * @example
 * poseEntries(pass, template, state, bones, hasDark, seen, element);
 * notePass(view.stats, pass);
 */
export function notePass(stats: ViewStats, pass: PosePass): void {
    stats.placedSlots = pass.placed;
    stats.coloredSlots = pass.colored;
    if (pass.placed > 0) stats.positionUploads++;
    if (pass.colored > 0) stats.colorUploads++;
    if (pass.framed > 0) stats.uvUploads++;
}
