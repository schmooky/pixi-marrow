import type { Matrix } from 'pixi.js';
import { PAGE_SHIFT, POSITION_WORDS, RUN_PAD, type SlotLayout, STATIC_WORDS } from './batch-layout';
import { STATIC_STRIDE, type Template } from './template';

/*
 * The loops that write one skeleton into the buffers of a batch. They are the cost of the batched
 * mode per frame, so they read plain typed arrays and call nothing. Numbers that are no small
 * integers stay inside one function: the transform is read from its matrix here, and colors are
 * put together from bytes here.
 *
 * A batch keeps a vertex in two buffers. The position buffer holds x and y, which every pose
 * rewrites and every frame uploads. The static buffer holds 5 words of 32 bits, or 6 with dark
 * colors: u, v, the light color, the tint of the display object, the flags, the dark color. It
 * uploads only when one of them changed. A slot writes its vertices where its layout says, so a
 * slot that shows another attachment writes over the one before.
 */

/** The slot blend mode that adds. An index into `BLEND_MODES`. */
const ADDITIVE = 1;

/** The dark color of a slot that has none: black, with the alpha of 1 every dark color carries. */
export const NO_DARK: number = 0xff000000 | 0;

/** The flag byte of an additive slot, and the one of a vertex that is rounded to pixels. */
const ADDITIVE_FLAG = 0xff00;
const ROUND_FLAG = 0xff0000;

/**
 * What decides the run of a slot: its blend state in the two low bits, and above them the group
 * of 16 pages the page of its attachment is in. Normal and additive slots draw with the same
 * blend state.
 */
export const runKey = (blendMode: number, page: number): number =>
    (blendMode === ADDITIVE ? 0 : blendMode) | ((page >> PAGE_SHIFT) << 2);

/** What the loops read of a skeleton in a batch. */
export interface PackSource {
    /** The vertex ranges of the mesh mode: the positions of the pose and what never moves. */
    template: Template;
    /** Where each slot writes its vertices. */
    layout: SlotLayout;
    /** The visible entries in draw order. Valid up to `count`. */
    readonly visible: Int32Array;
    /** Per visible entry, 1 when a later slot covers it. */
    readonly skipped: Uint8Array;
    /** The blend mode of each slot: an index into `BLEND_MODES` of the model. */
    readonly blendModes: Uint8Array;
    /**
     * What the skeleton keeps about its place in the batch, in one array. First per slot: the
     * entry whose vertices the batch holds, or -1. From `changedAt` on per entry: 1 when its
     * colors or texture coordinates changed since the batch got them. From `pagesAt` on per atlas
     * page: the texture of the page in the batch.
     */
    state: Int32Array;
    changedAt: number;
    pagesAt: number;
    /** Per run: its indices, with the triangle without area that ends it. A run is a stretch of slots one draw call can draw. */
    readonly runSizes: number[];
    /**
     * The 32-bit words of a vertex in the static buffer of the batch: 5, or 6 in a batch with dark
     * colors. A skeleton without dark colors can draw in such a batch, with black as its dark color.
     */
    staticWords: number;
    /** The tint of the display object as Pixi keeps it: 0xAABBGGRR. */
    tint: number;
    /** Whether the renderer rounds positions to pixels. */
    round: boolean;
}

/**
 * A color of an entry as the word a vertex carries: 0xAABBGGRR. `bytes` holds r, g, b, a per entry.
 *
 * @example
 * const light = colorWord(template.light, entry);
 */
export function colorWord(bytes: Uint8Array, entry: number): number {
    const c = entry * 4;

    return Number(bytes[c]) | (Number(bytes[c + 1]) << 8) | (Number(bytes[c + 2]) << 16) | (Number(bytes[c + 3]) << 24);
}

/**
 * The flag word of the vertices of an entry. Its lowest byte is the texture of its page in the
 * batch. Then comes a byte for an additive slot and a byte for a vertex that is rounded to pixels.
 *
 * @example
 * const flags = flagWord(source, entry, template.slots[entry] ?? 0);
 */
export function flagWord(source: PackSource, entry: number, slot: number): number {
    const texture = Number(source.state[source.pagesAt + Number(source.template.pages[entry])]);

    return texture | (source.blendModes[slot] === ADDITIVE ? ADDITIVE_FLAG : 0) | (source.round ? ROUND_FLAG : 0);
}

/**
 * Writes what a pose does not move for every visible entry the batch does not hold as it is:
 * texture coordinates, colors, the tint and the flags. An entry is written when its slot showed
 * another one, and when its colors or its texture coordinates changed.
 *
 * `words` and `bytes` are the static buffer of the batch, as 32-bit floats and as 32-bit
 * integers. `base` is the word of that buffer the first vertex of the skeleton starts at.
 * Returns how many entries were written.
 *
 * @example
 * const written = writeEntries(source, home.statics, home.staticBytes, firstVertex * STATIC_WORDS, count);
 */
export function writeEntries(
    source: PackSource,
    words: Float32Array,
    bytes: Uint32Array,
    base: number,
    count: number,
): number {
    const { template, visible, state, changedAt, tint } = source;
    const { slots, first, counts, statics, light, dark, hasDark } = template;
    const slotAt = source.layout.at;
    const stride = source.staticWords;
    let written = 0;

    for (let i = 0; i < count; i++) {
        const entry = Number(visible[i]);
        const slot = Number(slots[entry]);

        if (state[slot] === entry && state[changedAt + entry] === 0) continue;
        state[slot] = entry;
        state[changedAt + entry] = 0;
        written++;
        const lightColor = colorWord(light, entry);
        // black with an alpha of 1 tints nothing: what a skeleton without dark colors is in a batch that has them
        const darkColor = hasDark ? colorWord(dark, entry) : NO_DARK;
        const flags = flagWord(source, entry, slot);
        let from = Number(first[entry]) * STATIC_STRIDE;
        let to = base + Number(slotAt[slot]) * stride;
        const end = from + Number(counts[entry]) * STATIC_STRIDE;

        for (; from < end; from += STATIC_STRIDE, to += stride) {
            words[to] = Number(statics[from]);
            words[to + 1] = Number(statics[from + 1]);
            bytes[to + 2] = lightColor;
            bytes[to + 3] = tint;
            bytes[to + 4] = flags;
            if (stride > STATIC_WORDS) bytes[to + 5] = darkColor;
        }
    }

    return written;
}

/**
 * Places the vertices of every visible entry: the positions of the pose, moved by the transform
 * of the display object inside its render group. The arithmetic is that of Pixi's batcher, which
 * the official runtime draws through: 64-bit products and sums of 32-bit positions.
 *
 * @param words The position buffer of the batch.
 * @param base The word of that buffer the first vertex of the skeleton starts at.
 *
 * @example
 * placeEntries(source, batcher.attributeBuffer.float32View, element._attributeStart, count, body.groupTransform);
 */
export function placeEntries(
    source: PackSource,
    words: Float32Array,
    base: number,
    count: number,
    transform: Matrix,
): void {
    const { template, visible } = source;
    const { slots, first, counts, positions } = template;
    const slotAt = source.layout.at;
    const { a, b, c, d, tx, ty } = transform;

    for (let i = 0; i < count; i++) {
        const entry = Number(visible[i]);
        let from = Number(first[entry]) * 2;
        let to = base + Number(slotAt[Number(slots[entry])]) * POSITION_WORDS;
        const end = from + Number(counts[entry]) * 2;

        for (; from < end; from += 2, to += POSITION_WORDS) {
            const x = Number(positions[from]);
            const y = Number(positions[from + 1]);

            words[to] = a * x + c * y + tx;
            words[to + 1] = d * y + b * x + ty;
        }
    }
}

/**
 * Moves vertices that a batch holds in the space of the skeleton to where the display object is,
 * in place. The cut triangles of a clip are written that way, since they are cut before Pixi
 * knows the transform of the frame. The arithmetic is that of {@link placeEntries}.
 *
 * @param words The position buffer of the batch.
 * @param at The word of that buffer the first of the vertices starts at.
 *
 * @example
 * placeMoved(batcher.attributeBuffer.float32View, firstWord, element.clipUsed, body.groupTransform);
 */
export function placeMoved(words: Float32Array, at: number, count: number, transform: Matrix): void {
    const { a, b, c, d, tx, ty } = transform;

    for (let to = at, end = at + count * POSITION_WORDS; to < end; to += POSITION_WORDS) {
        const x = Number(words[to]);
        const y = Number(words[to + 1]);

        words[to] = a * x + c * y + tx;
        words[to + 1] = d * y + b * x + ty;
    }
}

/**
 * Lists the runs of the visible entries: a run ends where the blend state or the group of 16
 * pages changes. A covered entry keeps its place, so the runs are the same with and without it.
 *
 * @param keys Gets the key of every run it has room for: the blend state and the page group.
 * @returns How many runs there are, 1 at least.
 *
 * @example
 * const runs = planRuns(source, count, keys);
 * if (runs > keys.length) console.log('the keys need more room');
 */
export function planRuns(source: PackSource, count: number, keys: Uint8Array): number {
    const { visible, blendModes } = source;
    const { slots, pages } = source.template;
    let runs = 0;
    let key = -1;

    for (let i = 0; i < count; i++) {
        const entry = Number(visible[i]);
        const next = runKey(Number(blendModes[Number(slots[entry])]), Number(pages[entry]));

        if (next === key) continue;
        key = next;
        if (runs < keys.length) keys[runs] = next;
        runs++;
    }
    if (runs === 0 && keys.length > 0) keys[0] = 0;

    return Math.max(runs, 1);
}

/**
 * Writes the triangles of the visible entries, run after run. Every run ends with a triangle
 * without area, and the last one fills the room of the skeleton with them. So a skeleton has
 * the same number of indices whatever it shows, and no run is empty.
 *
 * The runs must be those {@link planRuns} listed, and `size` must have room for them.
 *
 * `out` is the index buffer of the batch, `at` the first index of the skeleton and `size` the
 * indices it has room for. `vertex` is the number of its first vertex in the batch. Returns the
 * indices that draw a triangle with area.
 *
 * @example
 * const drawn = writeIndices(source, batcher.indexBuffer, element._indexStart, element.indexSize, firstVertex, count);
 */
export function writeIndices(
    source: PackSource,
    out: Uint16Array | Uint32Array,
    at: number,
    size: number,
    vertex: number,
    count: number,
): number {
    const { template, visible, skipped, blendModes, runSizes } = source;
    const { slots, triangles, pages } = template;
    const slotAt = source.layout.at;
    const end = at + size;
    let cursor = at;
    let start = at;
    let run = 0;
    let key = -1;
    let drawn = 0;

    for (let i = 0; i < count; i++) {
        const entry = Number(visible[i]);
        const slot = Number(slots[entry]);
        const next = runKey(Number(blendModes[slot]), Number(pages[entry]));

        if (next !== key && i > 0) {
            for (let pad = 0; pad < RUN_PAD; pad++) out[cursor++] = vertex;
            runSizes[run++] = cursor - start;
            start = cursor;
        }
        key = next;
        if (skipped[i] === 1) continue;
        const list = triangles[entry];
        const offset = vertex + Number(slotAt[slot]);

        if (list === undefined) continue;
        for (let t = 0; t < list.length; t++) out[cursor + t] = offset + Number(list[t]);
        cursor += list.length;
        drawn += list.length;
    }
    while (cursor < end) out[cursor++] = vertex;
    runSizes[run] = end - start;

    return drawn;
}
