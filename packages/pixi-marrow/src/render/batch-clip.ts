import { MarrowError } from '../base/errors';
import {
    type ClippedTriangles,
    createClippedTriangles,
    TriangleClipper,
    VERDICT_NOTHING,
    VERDICT_WHOLE,
} from '../geometry/clip-triangles';
import { i16, i32 } from '../geometry/read';
import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import type { PoseState } from '../pose/state';
import type { BatchElement, BatchHome } from './batch-element';
import { POSITION_WORDS, RUN_PAD, STATIC_WORDS } from './batch-layout';
import { colorWord, flagWord, NO_DARK, placeMoved, runKey } from './batch-pack';
import type { ClipCode, ClipRoom } from './clip-code';
import { ClipShape } from './clip-shape';
import { STATIC_STRIDE } from './template';
import { NO_CLIP } from './visible';

/*
 * Clips in a batch. The mesh mode clips with a stencil mask, which is two draw calls and ends
 * every batch. Here the triangles of a slot are cut on the CPU against the clip polygon, as the
 * official runtime cuts them, and the result draws in the batch of the skeleton.
 *
 * A skeleton keeps room for its cut triangles behind the room of its slots: some vertices and
 * some indices. A slot that the clip leaves whole draws from the room of the slot, with the
 * vertices its triangles share. A slot that is cut draws the vertices the clipper made, which are
 * written anew when the clip or a slot inside it moved: positions, texture coordinates and the
 * colors of the slot.
 *
 * How much room the cut triangles need is known only after they are cut, and it changes with
 * the pose. The room is therefore what the clips of a model needed so far, with a margin, see
 * {@link roomOf}. Pixi builds the instructions again when a pose needs more. An animation that
 * loops has needed its most after one turn, and all instances of the model share the number.
 *
 * This module loads on demand, see `clip-code.ts`. With it come the clip kernel and `ClipShape`,
 * which the stencil mask of the mesh mode shapes its polygon with too. Its arrays are shared by
 * all skeletons: one is clipped and written before the next one starts.
 */

/** What a visible entry draws, in {@link plan}: its own triangles, nothing, or what was cut from this index on. */
const WHOLE = -1;
const NOTHING = -2;

/** Numbers per visible entry in {@link plan}. */
const PLAN_STRIDE = 4;

/** The deform of a slot that has none. */
const NO_DEFORM = new Float64Array(0);

const shape = new ClipShape();
const clipper = new TriangleClipper();

/** The cut triangles of the skeleton that was clipped last, slot after slot. Indices count from the first vertex of their slot. */
const cut: ClippedTriangles = createClippedTriangles(256, 768, true);

/**
 * Per visible entry of that skeleton: {@link WHOLE}, {@link NOTHING} or its first index in
 * {@link cut}, then the end of its indices, its first vertex and the end of its vertices.
 */
let plan = new Int32Array(64 * PLAN_STRIDE);

/**
 * The triangles of the polygon the clipper was started with last, when they are the ones a
 * `ClipShape` cuts once for a polygon that only moves with its bone. Null for any other polygon.
 */
let lastShared: Uint16Array | null = null;

/** Per model: the room its clips needed so far. */
const rooms = new WeakMap<SkeletonModel, ClipRoom>();

/**
 * A count with a quarter more, as a multiple of `step`: room that the next poses can grow into.
 * The indices of a skeleton are whole triangles, so their step is a multiple of 3. The skeleton
 * behind it in the batch would draw from the wrong corners otherwise.
 */
const withMargin = (count: number, step: number): number => Math.ceil((count + (count >> 2)) / step) * step;
const VERTEX_STEP = 8;
const INDEX_STEP = 12;

function roomOf(model: SkeletonModel): ClipRoom {
    let room = rooms.get(model);

    if (room === undefined) {
        room = { vertices: 0, indices: 0 };
        rooms.set(model, room);
    }

    return room;
}

/** Shapes the polygon of the clipping attachment a slot shows and hands it to the clipper. */
function startClip(model: SkeletonModel, pose: PoseState, slot: number, attachment: AttachmentData | null): void {
    if (attachment?.type !== 'clipping') {
        throw new MarrowError('invalid-data', `Slot ${slot} cuts other slots and shows no clipping attachment.`, {
            fix: 'Report this as a bug of pixi-marrow.',
        });
    }
    const deformLength = i32(pose.deformLengths, slot);

    shape.compute(
        model.version,
        attachment,
        pose.world,
        i16(model.slots.bones, slot),
        pose.deform[slot] ?? NO_DEFORM,
        deformLength,
    );
    // without weights and without a deform the polygon only moves, and its shared triangles say which one it is
    const shared = attachment.bones === null && deformLength === 0 ? shape.fixedIndices : null;

    clipper.start(
        model.version,
        shape.polygon,
        shape.vertexCount,
        shape.triangles,
        shape.indexCount,
        attachment.inverse,
        attachment.convex,
        // the polygon of the last start at another place, as for the next instance of a rig: its parts are placed, not cut again
        shared !== null && shared === lastShared,
    );
    lastShared = shared;
}

/**
 * Clips the visible entries of an element into {@link cut} and notes in {@link plan} what each
 * one draws. A slot that a later slot covers is clipped too: Pixi can ask for it back at the
 * time of the draw, when no room can be added.
 */
function clipEntries(element: BatchElement): void {
    const { template, model, pose, seen } = element;
    const { list, clips, count } = seen;
    const { first, positions, statics, triangles } = template;
    let current = NO_CLIP;

    if (plan.length < count * PLAN_STRIDE) plan = new Int32Array(count * PLAN_STRIDE * 2);
    cut.vertexCount = 0;
    cut.indexCount = 0;
    for (let i = 0, at = 0; i < count; i++, at += PLAN_STRIDE) {
        const clip = i16(clips, i);
        const entry = i32(list, i);
        const indices = triangles[entry];

        plan[at] = WHOLE;
        if (clip === NO_CLIP || pose === undefined) continue;
        if (clip !== current) {
            current = clip;
            startClip(model, pose, clip, seen.shown[clip] ?? null);
        }
        plan[at] = NOTHING;
        if (indices === undefined || indices.length === 0) continue;
        const vertex = i32(first, entry);
        // most slots inside a clip are not near its edge: the clipper says so from their box
        const verdict = clipper.verdict(positions, vertex * 2, 2, indices, 0, indices.length);

        if (verdict === VERDICT_NOTHING) continue;
        if (verdict === VERDICT_WHOLE) {
            plan[at] = WHOLE;
            continue;
        }
        const base = cut.vertexCount;

        plan[at] = cut.indexCount;
        for (let done = 0; ; ) {
            done += clipper.clip(
                positions,
                vertex * 2,
                2,
                statics,
                vertex * STATIC_STRIDE,
                STATIC_STRIDE,
                indices,
                done,
                indices.length - done,
                cut,
                base,
            );
            if (done === indices.length) break;
            clipper.grow(cut);
        }
        plan[at + 1] = cut.indexCount;
        plan[at + 2] = base;
        plan[at + 3] = cut.vertexCount;
    }
}

/**
 * Writes the vertices of one cut entry into the room of an element. They get positions in the
 * space of the skeleton, the texture coordinates the clipper gave them, and the colors of the slot.
 *
 * @param from The first of the vertices in {@link cut}.
 * @param to The vertex of the batch the first one goes to.
 */
function writeVertices(
    element: BatchElement,
    home: BatchHome,
    entry: number,
    from: number,
    to: number,
    count: number,
): void {
    const { template, staticWords: stride, tint } = element;
    const { statics, staticBytes } = home;
    const positions = home.attributeBuffer.float32View;
    const light = colorWord(template.light, entry);
    const dark = template.hasDark ? colorWord(template.dark, entry) : NO_DARK;
    const flags = flagWord(element, entry, i32(template.slots, entry));

    for (let v = 0, r = from * 2, p = to * POSITION_WORDS, s = to * stride; v < count; v++, r += 2) {
        positions[p] = Number(cut.positions[r]);
        positions[p + 1] = Number(cut.positions[r + 1]);
        statics[s] = Number(cut.uvs[r]);
        statics[s + 1] = Number(cut.uvs[r + 1]);
        staticBytes[s + 2] = light;
        staticBytes[s + 3] = tint;
        staticBytes[s + 4] = flags;
        if (stride > STATIC_WORDS) staticBytes[s + 5] = dark;
        p += POSITION_WORDS;
        s += stride;
    }
}

/** The indices of cut triangles that {@link writeElement} has written for the element it is at. */
let usedIndices = 0;

/**
 * Appends the triangles of an entry that draws from the room of its slot, with the vertices its
 * triangles share. Returns how many indices it wrote.
 *
 * @param offset The vertex of the batch the first vertex of the slot is at.
 */
function writeWhole(
    out: Uint16Array | Uint32Array,
    cursor: number,
    list: Uint16Array | undefined,
    offset: number,
): number {
    if (list === undefined) return 0;
    for (let t = 0; t < list.length; t++) out[cursor + t] = offset + Number(list[t]);

    return list.length;
}

/**
 * Appends what the clip left of an entry: its vertices go behind the cut vertices the element
 * holds so far, and its indices to `cursor`. Returns how many indices it wrote. That is 0 for an
 * entry the room of the element cannot hold: the instructions are built again with more room,
 * and until then the slot is left out.
 *
 * @param at Where the entry is in {@link plan}.
 */
function writeCut(element: BatchElement, home: BatchHome, entry: number, at: number, cursor: number): number {
    const from = i32(plan, at);
    const first = i32(plan, at + 2);
    const count = i32(plan, at + 3) - first;
    const indices = i32(plan, at + 1) - from;
    const used = element.clipUsed;
    const to = element._attributeStart / POSITION_WORDS + element.layout.vertices + used;
    const { indexBuffer } = home;

    if (used + count > element.clipVertices || usedIndices + indices > element.clipIndices) return 0;
    writeVertices(element, home, entry, first, to, count);
    for (let k = 0; k < indices; k++) indexBuffer[cursor + k] = to + Number(cut.indices[from + k]);
    element.clipUsed = used + count;
    usedIndices += indices;

    return indices;
}

/**
 * Writes what {@link clipEntries} left into the place of an element in a batch. These are the
 * vertices of the cut entries and the indices of all entries, run after run as `writeIndices`
 * writes them.
 */
function writeElement(element: BatchElement, home: BatchHome, mark: boolean): void {
    const { template, seen, skipped, blendModes, runSizes, layout } = element;
    const { slots, triangles, pages } = template;
    const { indexBuffer } = home;
    const vertex = element._attributeStart / POSITION_WORDS;
    const end = element._indexStart + element.indexSize;
    let cursor = element._indexStart;
    let start = cursor;
    let run = 0;
    let key = -1;

    element.clipUsed = 0;
    usedIndices = 0;
    for (let i = 0, at = 0; i < seen.count; i++, at += PLAN_STRIDE) {
        const entry = i32(seen.list, i);
        const slot = i32(slots, entry);
        const next = runKey(Number(blendModes[slot]), i32(pages, entry));
        const from = i32(plan, at);

        if (next !== key && i > 0) {
            for (let pad = 0; pad < RUN_PAD; pad++) indexBuffer[cursor++] = vertex;
            runSizes[run++] = cursor - start;
            start = cursor;
        }
        key = next;
        if (skipped[i] === 1 || from === NOTHING) continue;
        cursor +=
            from === WHOLE
                ? writeWhole(indexBuffer, cursor, triangles[entry], vertex + i32(layout.at, slot))
                : writeCut(element, home, entry, at, cursor);
    }
    // what was written so far draws: runs, their ends, and the triangles between
    element.drawn = cursor - element._indexStart - run * RUN_PAD;
    while (cursor < end) indexBuffer[cursor++] = vertex;
    runSizes[run] = end - start;
    if (!mark) return;
    home.touchStatics((vertex + layout.vertices) * element.staticWords, element.clipUsed * element.staticWords);
    home.touchIndices(element._indexStart, element.indexSize);
}

/**
 * Gives an element the room for cut triangles that the clips of its model needed so far, before
 * it is added to a batch. A skeleton that clipped once keeps the room: a clip that comes and
 * goes builds nothing again.
 *
 * @example
 * clipCode()?.size(element);
 * element.attributeSize = element.layout.vertices + element.clipVertices;
 */
function sizeClipRoom(element: BatchElement): void {
    if (element.clipVertices === 0 && element.seen.clipped === 0) return;
    if (element.seen.clipped > 0) batchClip.measure(element);
    const room = roomOf(element.model);

    element.clipVertices = room.vertices;
    element.clipIndices = room.indices;
}

/**
 * Takes the pose of an update for the clips of an element. While a clipping attachment cuts a
 * visible slot, the slots are clipped now and written into the batch. Their positions are in
 * the space of the skeleton, and the next sync moves them once Pixi knows where the skeleton is.
 * Whether a pose needs more room than the batch has is then known before Pixi looks at its
 * instructions.
 *
 * @example
 * clipCode()?.pose(element, engine.state);
 * body.touch();
 */
function clipPose(element: BatchElement, pose: PoseState): void {
    const { home } = element;

    element.pose = pose;
    element.clipFresh = false;
    element.clipPlaced = false;
    element.dirty = true;
    // an element without a place is measured and written when the instructions are built
    if (element.seen.clipped === 0 || home === null || !element.placed || element.resized) return;
    if (batchClip.fill(element, home, true)) element.clipFresh = true;
    else element.resized = true;
    element.stats.indices = element.drawn;
}

/**
 * The part of a sync for a skeleton with slots inside a clip: the cut triangles and the indices
 * of all slots. The batch holds the cut triangles of a pose in the space of the skeleton right
 * after {@link clipPose}, and they are moved to the display object here. They are cut again when
 * the batch holds them for another transform or another list of slots, and when a color changed,
 * which every cut vertex carries.
 *
 * @param all Whether every vertex of the skeleton was placed again.
 * @param statics Whether colors, texture coordinates or the list of slots changed.
 *
 * @example
 * if (element.seen.clipped > 0) clipCode()?.write(element, home, true, moved, false);
 */
function writeClip(element: BatchElement, home: BatchHome, mark: boolean, all: boolean, statics: boolean): void {
    const at = element._attributeStart + element.layout.vertices * POSITION_WORDS;

    if (!element.clipFresh) {
        if (element.clipPlaced && !all && !statics) return;
        if (!batchClip.fill(element, home, mark)) {
            element.resized = true;
            // Pixi looks at the instructions of a display object that says it changed
            element.place.touch();
        }
    }
    element.stats.indices = element.drawn;
    placeMoved(home.attributeBuffer.float32View, at, element.clipUsed, element.place.groupTransform);
    if (mark && !all) home.touchPositions(at, element.clipUsed * POSITION_WORDS);
    // they are where the display object is now, and cannot be moved again
    element.clipFresh = false;
    element.clipPlaced = true;
}

/**
 * The code that clips. `clip-code.ts` hands it out once this module is loaded.
 *
 * @example
 * const { batchClip } = await import('./batch-clip');
 * if (!batchClip.fill(element, home, true)) element.resized = true;
 */
export const batchClip: ClipCode = {
    shape,
    room: roomOf,
    size: sizeClipRoom,
    pose: clipPose,
    write: writeClip,
    measure(element: BatchElement): void {
        const room = roomOf(element.model);

        clipEntries(element);
        if (cut.vertexCount <= room.vertices && cut.indexCount <= room.indices) return;
        // both grow at once: a pose that needs more vertices needs more indices soon
        room.vertices = Math.max(room.vertices, withMargin(cut.vertexCount, VERTEX_STEP));
        room.indices = Math.max(room.indices, withMargin(cut.indexCount, INDEX_STEP));
    },
    fill(element: BatchElement, home: BatchHome, mark: boolean): boolean {
        clipEntries(element);
        writeElement(element, home, mark);

        return cut.vertexCount <= element.clipVertices && cut.indexCount <= element.clipIndices;
    },
};
