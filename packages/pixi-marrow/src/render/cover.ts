import { pointsInsideQuad } from '../geometry/occlusion';
import { f32, f64, i16, i32 } from '../geometry/read';
import { transformPoints } from '../geometry/vertices';
import { NO_CLIP } from './ranges';
import { u8 } from './read';
import type { Template } from './template';

/*
 * Covered slots. A slot whose vertices all lie inside the opaque rectangle of a slot drawn
 * later shows no pixel, so its triangles are left out of the index buffer.
 *
 * What makes it exact:
 *
 * - The rectangle holds texels with alpha 255 only, and stays a texel away from every other
 *   texel. Bilinear filtering of the page at its own size then samples alpha 1 inside it.
 * - The slot that hides blends normally and its vertices carry the alpha byte 255. The color
 *   it writes then replaces what is below: `source + destination * (1 - 1)`.
 * - It is drawn itself in that frame, and no clip cuts it.
 * - The vertices of the hidden slot are the ones that are uploaded, as 32-bit floats. The
 *   rectangle in world space is convex, so the triangles between them lie inside it too.
 * - A slot that is skipped is tested again in every frame, before anything is drawn.
 *
 * The caller must know two things the pose does not say. Pixi multiplies no alpha below 1 into
 * the skeleton, and the blend mode it draws with is normal. See `drawsPlain`.
 *
 * What bounds the cost. Most frames of most skeletons cover nothing, and a slot that is drawn
 * although it is covered changes no pixel, so the search for covered slots can wait:
 *
 * - While no slot is skipped, a frame that is not the turn of a search does nothing: no
 *   rectangle is chosen, none is moved to world space.
 * - A search that finds nothing new doubles the wait for the next one, from
 *   {@link SEARCH_FIRST} frames up to {@link SEARCH_LAST}. The wait starts again when the
 *   visible slots, their order, their clips or the alpha of a slot that can hide changed.
 * - A search tests against at most {@link MAX_OCCLUDERS} rectangles, the ones with the largest
 *   area next to their bone. A rectangle below {@link MIN_OCCLUDER_AREA} in world space hides
 *   nothing. A slot is tested with its first vertex against the box of a rectangle before all
 *   of its vertices are.
 * - A frame with skipped slots tests those slots only, against the rectangles above them.
 */

/** The most slots that can hide other slots in one frame. */
export const MAX_OCCLUDERS = 4;

/** The least area in world units an opaque rectangle must have in a frame to hide a slot. */
export const MIN_OCCLUDER_AREA = 1024;

/** The frames between two searches for newly covered slots, right after something changed. */
export const SEARCH_FIRST = 4;

/** The most frames between two searches, after searches that found nothing new. */
export const SEARCH_LAST = 64;

/** The alpha byte of a vertex that lets nothing through. */
const OPAQUE = 255;

/** What a slot gets that no kept rectangle covers. */
const NONE = -1;

/** The arrays of a test that has not searched yet. A view without an opaque rectangle never does. */
const NO_INTS = new Int32Array(0);
const NO_BYTES = new Uint8Array(0);
const NO_FLOATS = new Float64Array(0);

/**
 * Finds the slots that a later slot covers. One instance belongs to one view. It allocates its
 * scratch arrays with the first run and nothing after that. A view that never has an opaque
 * rectangle to test with holds one flag per slot and no more.
 *
 * @example
 * const cover = new CoverTest(model.slots.count);
 * const changed = cover.begin(listChanged) && cover.run(template, visible, clips, count, state.world, bones);
 * if (changed) ranges.build(template, visible, clips, cover.skipped, count);
 */
export class CoverTest {
    /** Per visible entry: 1 when a later slot covers it. */
    readonly skipped: Uint8Array;
    /** Slots that are covered at the moment. */
    covered = 0;
    /** The places of the covered entries in the visible list, from the top of the draw order down. */
    private marks: Int32Array = NO_INTS;
    /** Per covered entry: the kept rectangle that covered it last. It is asked first in the next frame. */
    private coveredBy: Uint8Array = NO_BYTES;
    /** Per kept rectangle: its entry. */
    private entries: Int32Array = NO_INTS;
    /** Per kept rectangle: the place of its slot in the visible list. */
    private places: Int32Array = NO_INTS;
    /** Per kept rectangle: the run its corners were computed in. */
    private placed: Int32Array = NO_INTS;
    /** Per kept rectangle: 1 while it hides in that run. 0 when it is too small or covered itself. */
    private live: Uint8Array = NO_BYTES;
    /** Per kept rectangle: its four corners in world space. */
    private quads: Float64Array = NO_FLOATS;
    /** Per kept rectangle: the box around the corners as minX, minY, maxX, maxY. */
    private boxes: Float64Array = NO_FLOATS;
    /** How many rectangles are kept. */
    private kept = 0;
    /** True when the kept rectangles are those of another list of slots. */
    private stale = true;
    /** Counts the runs. A rectangle is moved to world space once per run, when a slot asks for it. */
    private turn = 0;
    /** The frames to wait between two searches at the moment. */
    private wait = SEARCH_FIRST;
    /** The frames since the last search. The first frame searches. */
    private since = SEARCH_FIRST;
    /** Whether this frame searches for newly covered slots. */
    private due = false;

    /** @param slots The slot count of the model: the most entries that can be visible. */
    constructor(slots: number) {
        this.skipped = new Uint8Array(slots);
    }

    /** The bytes of the typed arrays of the test. */
    get bytes(): number {
        const { skipped, marks, coveredBy, entries, places, placed, live, quads, boxes } = this;

        return [skipped, marks, coveredBy, entries, places, placed, live, quads, boxes].reduce(
            (sum, array) => sum + array.byteLength,
            0,
        );
    }

    /**
     * Starts a frame. Returns whether {@link run} has work to do in it: a slot is skipped and
     * must be tested again, or it is the turn of a search. Most frames get false and are done.
     *
     * `moved` says that the visible entries, their order, their clips or the alpha of a slot
     * with an opaque rectangle changed since the frame before.
     */
    begin(moved: boolean): boolean {
        this.since++;
        if (moved) {
            this.stale = true;
            this.wait = SEARCH_FIRST;
        }
        this.due = this.since >= this.wait;

        return this.due || this.covered > 0;
    }

    /**
     * Brings the marks in line with a pose, after {@link begin} said there is work. Every entry
     * that is marked is tested again. On the turn of a search every other entry is tested too.
     * The positions of the template must be those of the pose. Returns whether a mark changed,
     * which asks for new index buffers.
     *
     * `visible` holds the visible entries in draw order and `clips` the clip of each one. `world`
     * is that of the pose and `bones` holds the bone of each slot.
     */
    run(
        template: Template,
        visible: Int32Array,
        clips: Int16Array,
        count: number,
        world: Float64Array,
        bones: Int16Array,
    ): boolean {
        if (this.marks === NO_INTS) this.allocate();
        if (this.stale) this.pick(template, visible, clips, count);
        this.turn++;
        if (!this.due) return this.verify(template, visible, count, world, bones);
        const before = this.covered;
        const changed = this.search(template, visible, count, world, bones);

        this.rest(this.covered > before);

        return changed;
    }

    /**
     * Ends a search and sets the wait for the next one: short after a search that found a slot,
     * twice as long as before after one that found none. Call it with false for a search that
     * could not run, because Pixi does not draw the skeleton as its vertices say.
     */
    rest(found: boolean): void {
        this.since = 0;
        this.wait = found ? SEARCH_FIRST : Math.min(this.wait * 2, SEARCH_LAST);
    }

    /**
     * Marks no entry as covered, and forgets the rectangles: the next run chooses them again.
     * Returns whether a mark changed.
     */
    clear(): boolean {
        const { skipped, marks } = this;
        const changed = this.covered > 0;

        for (let m = 0; m < this.covered; m++) skipped[i32(marks, m)] = 0;
        this.covered = 0;
        this.stale = true;

        return changed;
    }

    /** Creates the scratch arrays, when the first run needs them. */
    private allocate(): void {
        const slots = this.skipped.length;

        this.marks = new Int32Array(slots);
        this.coveredBy = new Uint8Array(slots);
        this.entries = new Int32Array(MAX_OCCLUDERS);
        this.places = new Int32Array(MAX_OCCLUDERS);
        this.placed = new Int32Array(MAX_OCCLUDERS);
        this.live = new Uint8Array(MAX_OCCLUDERS);
        this.quads = new Float64Array(MAX_OCCLUDERS * 8);
        this.boxes = new Float64Array(MAX_OCCLUDERS * 4);
    }

    /** Tests the marked entries again, from the top of the draw order down. Returns whether a mark was taken back. */
    private verify(
        template: Template,
        visible: Int32Array,
        count: number,
        world: Float64Array,
        bones: Int16Array,
    ): boolean {
        const { skipped, marks, coveredBy } = this;
        let still = 0;

        for (let m = 0; m < this.covered; m++) {
            const place = i32(marks, m);
            // a place past the end of the list holds no slot any more
            const by =
                place < count ? this.hides(template, i32(visible, place), place, world, bones, u8(coveredBy, m)) : NONE;

            if (by === NONE) skipped[place] = 0;
            else {
                coveredBy[still] = by;
                marks[still++] = place;
                this.retire(place);
            }
        }
        const changed = still !== this.covered;

        this.covered = still;

        return changed;
    }

    /**
     * Tests every visible entry, from the top of the draw order down: a slot that is covered
     * itself hides nothing. Returns whether a mark changed.
     */
    private search(
        template: Template,
        visible: Int32Array,
        count: number,
        world: Float64Array,
        bones: Int16Array,
    ): boolean {
        const { skipped, marks, coveredBy } = this;
        let changed = false;
        let covered = 0;

        // the marks of places past the end of the list
        for (let m = 0; m < this.covered; m++) {
            if (i32(marks, m) >= count) {
                skipped[i32(marks, m)] = 0;
                changed = true;
            }
        }
        for (let i = count - 1; i >= 0; i--) {
            const by = this.hides(template, i32(visible, i), i, world, bones, 0);
            const hidden = by === NONE ? 0 : 1;

            if (by !== NONE) {
                coveredBy[covered] = by;
                marks[covered++] = i;
                this.retire(i);
            }
            if (u8(skipped, i) !== hidden) {
                skipped[i] = hidden;
                changed = true;
            }
        }
        this.covered = covered;

        return changed;
    }

    /**
     * Keeps the visible entries that can hide others: an opaque rectangle, no clip, alpha byte
     * 255. Of more than {@link MAX_OCCLUDERS} the largest stay.
     */
    private pick(template: Template, visible: Int32Array, clips: Int16Array, count: number): void {
        const { opaqueAt, light } = template;
        let kept = 0;

        for (let i = 0; i < count; i++) {
            const entry = i32(visible, i);

            if (i32(opaqueAt, entry) < 0) continue;
            if (i16(clips, i) !== NO_CLIP || u8(light, entry * 4 + 3) !== OPAQUE) continue;
            kept = this.keep(template, kept, entry, i);
        }
        this.kept = kept;
        this.stale = false;
    }

    /** Takes one more rectangle in, in place of the smallest when there is no room. Returns how many are kept. */
    private keep(template: Template, kept: number, entry: number, place: number): number {
        const { entries, places } = this;
        const areas = template.opaqueAreas;
        let at = kept;

        if (kept === MAX_OCCLUDERS) {
            at = 0;
            for (let k = 1; k < kept; k++) {
                if (f64(areas, i32(entries, k)) < f64(areas, i32(entries, at))) at = k;
            }
            if (f64(areas, entry) <= f64(areas, i32(entries, at))) return kept;
        }
        entries[at] = entry;
        places[at] = place;

        return kept === MAX_OCCLUDERS ? kept : kept + 1;
    }

    /**
     * The kept rectangle of a slot drawn after the entry at `place` that holds all vertices of
     * the entry, or {@link NONE}. The rectangles are asked in turn, from `first` on.
     */
    private hides(
        template: Template,
        entry: number,
        place: number,
        world: Float64Array,
        bones: Int16Array,
        first: number,
    ): number {
        const { positions } = template;
        const { kept } = this;
        const count = i32(template.counts, entry);
        const at = i32(template.first, entry) * 2;

        // a hollow entry draws nothing as it is
        if (count === 0) return NONE;
        const x = f32(positions, at);
        const y = f32(positions, at + 1);

        // the rectangle of the frame before can be gone: the kept ones were chosen again since
        const start = first < kept ? first : 0;

        for (let n = 0; n < kept; n++) {
            const k = start + n < kept ? start + n : start + n - kept;
            const b = k * 4;

            if (i32(this.places, k) <= place || !this.ready(template, k, world, bones)) continue;
            if (x < f64(this.boxes, b) || y < f64(this.boxes, b + 1)) continue;
            if (x > f64(this.boxes, b + 2) || y > f64(this.boxes, b + 3)) continue;
            if (pointsInsideQuad(this.quads, k * 8, positions, at, count)) return k;
        }

        return NONE;
    }

    /**
     * Whether a kept rectangle hides in this run. Moves it to world space, with its box, the
     * first time a run asks. One that is too small does not hide.
     */
    private ready(template: Template, k: number, world: Float64Array, bones: Int16Array): boolean {
        const { quads, boxes } = this;

        if (i32(this.placed, k) === this.turn) return u8(this.live, k) === 1;
        const entry = i32(this.entries, k);
        const bone = i16(bones, i32(template.slots, entry));
        const q = k * 8;
        const b = k * 4;

        transformPoints(template.opaqueOffsets, i32(template.opaqueAt, entry), world, bone, quads, q, q + 8, 2);
        boxes[b] = Math.min(f64(quads, q), f64(quads, q + 2), f64(quads, q + 4), f64(quads, q + 6));
        boxes[b + 1] = Math.min(f64(quads, q + 1), f64(quads, q + 3), f64(quads, q + 5), f64(quads, q + 7));
        boxes[b + 2] = Math.max(f64(quads, q), f64(quads, q + 2), f64(quads, q + 4), f64(quads, q + 6));
        boxes[b + 3] = Math.max(f64(quads, q + 1), f64(quads, q + 3), f64(quads, q + 5), f64(quads, q + 7));
        // a rectangle stays a parallelogram: two sides from one corner span it
        const area =
            (f64(quads, q + 2) - f64(quads, q)) * (f64(quads, q + 7) - f64(quads, q + 1)) -
            (f64(quads, q + 3) - f64(quads, q + 1)) * (f64(quads, q + 6) - f64(quads, q));
        // false for an area that is not a number as well
        const hides = Math.abs(area) >= MIN_OCCLUDER_AREA;

        this.placed[k] = this.turn;
        this.live[k] = hides ? 1 : 0;

        return hides;
    }

    /** A covered slot is not drawn, so its own rectangle hides nothing in this run. */
    private retire(place: number): void {
        for (let k = 0; k < this.kept; k++) {
            if (i32(this.places, k) !== place) continue;
            this.placed[k] = this.turn;
            this.live[k] = 0;
        }
    }
}
