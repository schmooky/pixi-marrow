import type {
    Batch,
    BatchableElement,
    Batcher,
    BLEND_MODES,
    Container,
    IndexBufferArray,
    Texture,
    TextureSource,
    Topology,
    ViewableBuffer,
} from 'pixi.js';
import type { SkeletonModel } from '../model/model';
import type { PoseState } from '../pose/state';
import {
    GROUP_PAGES,
    holdsLayout,
    PAGE_SHIFT,
    POSITION_WORDS,
    RUN_PAD,
    type SlotLayout,
    STATIC_WORDS,
} from './batch-layout';
import { type PackSource, placeEntries, placeMoved, planRuns, writeEntries, writeIndices } from './batch-pack';
import { batchClipper } from './clip-code';
import type { CoverTest } from './cover';
import type { DrawGate } from './gate';
import type { ViewStats } from './stats';
import type { Template } from './template';
import type { VisibleList } from './visible';

/*
 * One skeleton instance inside a batch of Pixi. The batcher gives it a stretch of its vertex
 * buffers and a stretch of the index buffer when the instructions of its render group are built.
 * The stretches keep their size while the skeleton plays. A pose writes positions into them, and
 * a change of the draw order, of an attachment or of the visible slots writes indices. Pixi does
 * not build the instructions again for any of it.
 *
 * A skeleton draws in one batch, which it shares with the skeletons before and after it. Slots
 * that blend with multiply or screen split it into runs, and so do slots on a page outside the
 * 16 pages of the slots before them. Every run is a batch of its own.
 * The instructions are built again when the runs change, when the vertex ranges need more room,
 * and when Pixi itself asks, for example when a display object is added or hidden.
 *
 * A clipping attachment cuts triangles, and what is left of them has other vertices in every
 * pose. A skeleton that clips keeps room for them behind the room of its slots, see
 * `batch-clip.ts`. The instructions are built again when a pose needs more of it.
 */

/** The names the two batchers are registered with. An element asks for one by `batcherName`. */
export const BATCHER = 'marrow';
export const DARK_BATCHER = 'marrow-dark';

/** The Pixi blend mode of a run for its blend state. 0 is normal and additive: the mode of the display object. */
const RUN_BLEND: readonly (BLEND_MODES | undefined)[] = [undefined, undefined, 'multiply', 'screen'];

/** The blend keys of the runs a plan found. All elements share it: a plan is read before the next one. */
let planned = new Uint8Array(4);

/** What an element reads and marks of the batcher that holds it. */
export interface BatchHome {
    /** Counts the builds of the instructions. An element that carries the number is in the batch. */
    readonly serial: number;
    /** True when the positions changed since their last upload. Pixi uploads them and clears it. */
    dirty: boolean;
    /** Says that a stretch of the static vertex data changed: `words` words from word `from` on. */
    touchStatics(from: number, words: number): void;
    /** Says that a stretch of the index data changed: `count` indices from index `from` on. */
    touchIndices(from: number, count: number): void;
    /** The positions of all vertices: x, y. Pixi keeps this buffer for every batcher. */
    readonly attributeBuffer: ViewableBuffer;
    /** What a pose does not move of all vertices, as 32-bit floats and as 32-bit integers. */
    readonly statics: Float32Array;
    readonly staticBytes: Uint32Array;
    readonly indexBuffer: IndexBufferArray;
}

/** What an element is created with. */
export interface BatchElementOptions {
    /** The display object of the skeleton: its transform, tint and blend mode inside the render group. */
    readonly place: Container;
    /** The view of the skeleton, which is asked before every draw. */
    readonly gate: DrawGate;
    /** The texture source of every atlas page, in page order. */
    readonly pages: readonly TextureSource[];
    /** A texture of the skeleton. Pixi asks every batch element for one. */
    readonly texture: Texture;
    /** The visible slots of the skeleton, which the view keeps up to date. */
    readonly seen: VisibleList;
    /** The covered slots of the skeleton, which the view keeps up to date. */
    readonly cover: CoverTest;
    /** The skeleton: its version, the blend modes and the bones of its slots. */
    readonly model: SkeletonModel;
    /** The counters of the view. The element keeps the count of drawn indices of a clipped skeleton. */
    readonly stats: ViewStats;
    readonly template: Template;
    /** Where the slots of the template keep their vertices in a batch. */
    readonly layout: SlotLayout;
}

/**
 * A skeleton instance as an element of a Pixi batch. The view marks what a pose changed, and
 * {@link sync} writes it into the buffers of the batch.
 *
 * @example
 * const element = new BatchElement({ place: body, gate: view, pages, texture, seen, cover, model, stats, template, layout });
 * element.prepare(false, template.hasDark);
 * renderer.renderPipes.batch.addToBatch(element, instructionSet);
 */
export class BatchElement implements BatchableElement, PackSource {
    /**
     * The batcher that draws the element. It is the one with dark colors for a skeleton that
     * has them. A skeleton without them that follows such a skeleton takes it too, so that both
     * share a batch.
     */
    batcherName: string;
    readonly texture: Texture;
    /** The blend mode of the display object inside its render group. Slots that multiply or screen have their own. */
    blendMode: BLEND_MODES = 'normal';
    /** The indices the batch keeps for the skeleton: the room of its slots and the end of every run. */
    indexSize = 0;
    /** The vertices the batch keeps for the skeleton: the room of its slots. */
    attributeSize = 0;
    readonly topology: Topology = 'triangle-list';
    readonly packAsQuad = false;
    _textureId = 0;
    /** The word of the position buffer the skeleton starts at. The batcher sets it. */
    _attributeStart = 0;
    /** The index of the index buffer the skeleton starts at. The batcher sets it. */
    _indexStart = 0;
    /** The batcher that holds the element, by the name Pixi reads. Our code reads {@link home}. */
    declare _batcher: Batcher;
    /** The batch the first run draws in, by the name Pixi reads. Our code reads {@link batches}. */
    declare _batch: Batch;

    template: Template;
    layout: SlotLayout;
    readonly visible: Int32Array;
    readonly skipped: Uint8Array;
    readonly blendModes: Uint8Array;
    state: Int32Array;
    changedAt: number;
    pagesAt: number;
    /**
     * Per run: its key, which is the blend state of its slots in the two low bits and their page
     * group above. Plain arrays: nearly every skeleton has one run.
     */
    readonly runKeys: number[] = [0];
    readonly runSizes: number[] = [0];
    staticWords: number = STATIC_WORDS;
    tint = 0xffffffff;
    round = false;

    /** The texture source of every atlas page, in page order. */
    readonly pages: readonly TextureSource[];
    /** The view of the skeleton, which is asked before every draw. */
    readonly gate: DrawGate;
    /** True when the skeleton changed since the batch was written: a pose, an entry, the list or the layout. */
    dirty = true;
    /** The batcher that holds the element, or null before the first build. */
    home: BatchHome | null = null;
    /** The build of {@link home} that gave the element its place. */
    serial = -1;
    /** How many runs the batch was built for. */
    runs = 1;
    /** Per run: the batch that draws it. */
    readonly batches: Batch[] = [];
    /**
     * True when the batch has no room for the skeleton as it is now: the vertex ranges need more
     * room, or the runs changed. Pixi must build the instructions again. Nothing is written
     * until then, and the batch draws what it held.
     */
    resized = true;
    /** True when the visible slots, their order or the covered ones changed since the indices were written. */
    listDirty = true;
    /** The indices of the skeleton that draw a triangle with area at the moment. */
    drawn = 0;
    readonly model: SkeletonModel;
    /** The visible slots of the skeleton, and the clip that cuts each one. */
    readonly seen: VisibleList;
    /** The pose of the last update. A clip is shaped from it. */
    pose: PoseState | undefined;
    /** The room for the vertices and the indices of cut triangles. 0 for a skeleton that never clipped. */
    clipVertices = 0;
    clipIndices = 0;
    /** The vertices of cut triangles the batch holds at the moment. */
    clipUsed = 0;
    /** True while the batch holds the cut triangles of the last pose, in the space of the skeleton. */
    private clipFresh = false;
    private readonly stats: ViewStats;
    private readonly place: Container;
    /** True when the batch holds nothing of the vertex ranges as they are: everything is written again. */
    private stale = true;
    /** True when an entry was marked since the batch got the entries. */
    private marked = false;

    constructor(options: BatchElementOptions) {
        const { blendModes } = options.model.slots;
        const slots = blendModes.length;

        this.model = options.model;
        this.stats = options.stats;
        this.place = options.place;
        this.gate = options.gate;
        this.batcherName = options.template.hasDark ? DARK_BATCHER : BATCHER;
        this.staticWords = options.template.hasDark ? STATIC_WORDS + 1 : STATIC_WORDS;
        this.pages = options.pages;
        this.texture = options.texture;
        this.seen = options.seen;
        this.visible = options.seen.list;
        this.skipped = options.cover.skipped;
        this.blendModes = blendModes;
        this.template = options.template;
        this.layout = options.layout;
        this.changedAt = slots;
        this.pagesAt = slots + options.template.slots.length;
        this.state = new Int32Array(this.pagesAt + options.pages.length).fill(-1, 0, slots);
    }

    /** Whether the element has a place in the batch of the last build. */
    get placed(): boolean {
        return this.home !== null && this.home.serial === this.serial;
    }

    /** The bytes the skeleton takes in the vertex buffers and the index buffer of a batch. */
    get bytes(): number {
        const words = POSITION_WORDS + this.staticWords;
        const vertices = this.layout.vertices + this.clipVertices;
        const indices = this.layout.indices + this.clipIndices + this.runs * RUN_PAD;

        return vertices * words * 4 + indices * (this.home?.indexBuffer.BYTES_PER_ELEMENT ?? 2);
    }

    /** The bytes of the typed arrays the element keeps for itself. */
    get arrayBytes(): number {
        return this.state.byteLength + this.layout.at.byteLength;
    }

    /** The Pixi blend mode a run draws with. */
    blendOf(run: number): BLEND_MODES {
        return RUN_BLEND[(this.runKeys[run] ?? 0) & 3] ?? this.blendMode;
    }

    /** The first atlas page of the group of 16 pages a run samples. */
    firstPage(run: number): number {
        return ((this.runKeys[run] ?? 0) >> 2) << PAGE_SHIFT;
    }

    /**
     * Takes the vertex ranges of a new layout. They are written into the room the element has
     * when they fit. Otherwise the instructions must be built again, see {@link resized}.
     */
    relayout(template: Template, wanted: SlotLayout): void {
        if (!holdsLayout(this.layout, wanted)) {
            this.layout = wanted;
            this.resized = true;
        }
        const pagesAt = this.changedAt + template.slots.length;

        // another count of entries: the flags are new, and the texture numbers of the pages stay
        if (pagesAt !== this.pagesAt) {
            const state = new Int32Array(pagesAt + this.pages.length);

            state.set(this.state.subarray(this.pagesAt), pagesAt);
            this.state = state;
            this.pagesAt = pagesAt;
        }
        this.template = template;
        this.stale = true;
        this.clipFresh = false;
        this.listDirty = true;
        this.dirty = true;
    }

    /**
     * Takes the pose of an update. While a clipping attachment cuts a visible slot, the slots
     * are clipped now and written into the batch. Their positions are in the space of the
     * skeleton, and {@link sync} moves them once Pixi knows where the skeleton is. Whether a
     * pose needs more room than the batch has is then known before Pixi looks at its instructions.
     */
    clip(pose: PoseState): void {
        const { home } = this;
        const clipper = this.seen.clipped > 0 ? batchClipper() : undefined;

        this.pose = pose;
        this.clipFresh = false;
        // an element without a place is measured and written when the instructions are built
        if (clipper === undefined || home === null || !this.placed || this.resized) return;
        if (clipper.fill(this, home, true)) this.clipFresh = true;
        else this.resized = true;
        this.stats.indices = this.drawn;
    }

    /** Notes the texture of an atlas page in the batch that draws it. The batcher calls it. */
    bindPage(page: number, texture: number): void {
        this.state[this.pagesAt + page] = texture;
    }

    /**
     * Gives every atlas page the texture number it has in the batches of a skeleton with more
     * than one run: its place in its group of 16 pages. The batcher calls it before the skeleton
     * writes itself, and then puts the pages of every run into a batch in that order.
     */
    alignPages(): void {
        for (let page = 0; page < this.pages.length; page++) this.bindPage(page, page & (GROUP_PAGES - 1));
    }

    /** Marks an entry whose colors or texture coordinates changed. The next {@link sync} writes them. */
    mark(entry: number): void {
        this.state[this.changedAt + entry] = 1;
        this.marked = true;
    }

    /**
     * Looks at the runs of the visible slots after the list changed. Sets {@link resized} when
     * they are not the runs the batch was built for. Returns how many runs there are.
     */
    plan(): number {
        const runs = this.findRuns();

        this.listDirty = true;
        this.dirty = true;
        if (runs !== this.runs) this.resized = true;
        else {
            for (let run = 0; run < runs; run++) {
                if (planned[run] !== this.runKeys[run]) this.resized = true;
            }
        }

        return runs;
    }

    /**
     * Sets the sizes the batcher reads, before the element is added to a batch.
     *
     * @param round Whether the renderer rounds positions to pixels.
     * @param dark Whether the batch has dark colors. It must for a skeleton that has them.
     */
    prepare(round: boolean, dark: boolean): void {
        const runs = this.findRuns();
        const clipper = batchClipper();

        // a skeleton that clipped once keeps the room: a clip that comes and goes builds nothing again
        if (clipper !== undefined && (this.clipVertices > 0 || this.seen.clipped > 0)) {
            if (this.seen.clipped > 0) clipper.measure(this);
            const room = clipper.room(this.model);

            this.clipVertices = room.vertices;
            this.clipIndices = room.indices;
        }
        this.batcherName = dark ? DARK_BATCHER : BATCHER;
        this.staticWords = dark ? STATIC_WORDS + 1 : STATIC_WORDS;
        for (let run = 0; run < runs; run++) this.runKeys[run] = Number(planned[run]);
        this.runKeys.length = runs;
        this.runSizes.length = runs;
        this.runs = runs;
        this.round = round;
        this.blendMode = this.place.groupBlendMode;
        this.attributeSize = this.layout.vertices + this.clipVertices;
        this.indexSize = this.layout.indices + this.clipIndices + runs * RUN_PAD;
        this.resized = false;
    }

    /**
     * Writes the whole skeleton into its place, which the batcher has set a moment ago. The
     * batcher uploads its buffers whole after a build, so nothing is marked here.
     */
    pack(home: BatchHome): void {
        this.home = home;
        this.serial = home.serial;
        this.stale = true;
        this.clipFresh = false;
        this.write(home, false);
    }

    /**
     * Brings the batch in line with the skeleton: the positions of the pose under the transform
     * of the display object, the entries that changed, and the indices when the list changed.
     * Does nothing for an element that is not in the batch of the last build.
     */
    sync(): void {
        const { home } = this;

        if (home === null || !this.placed || this.resized) return;
        this.write(home, true);
        this.spread();
    }

    /** Moves the borders of the batches of the runs to where the runs end now. */
    private spread(): void {
        const { batches, runSizes, runs } = this;
        let at = this._indexStart;

        if (runs === 1) return;
        for (let run = 0; run < runs; run++) {
            const batch = batches[run];

            if (batch === undefined) return;
            if (run > 0) {
                batch.size += batch.start - at;
                batch.start = at;
            }
            at += Number(runSizes[run]);
            if (run < runs - 1) batch.size = at - batch.start;
        }
    }

    /** The runs of the visible slots, into the shared plan. Returns how many there are. */
    private findRuns(): number {
        let runs = planRuns(this, this.seen.count, planned);

        if (runs > planned.length) {
            planned = new Uint8Array(runs * 2);
            runs = planRuns(this, this.seen.count, planned);
        }

        return runs;
    }

    /**
     * Writes what the batch does not hold as it is: the entries that changed, the positions, and
     * the indices when the list changed.
     *
     * @param mark Whether to tell the batcher which stretches to upload.
     */
    private write(home: BatchHome, mark: boolean): void {
        const count = this.seen.count;
        const tint = this.place.groupColorAlpha;
        const vertex = this._attributeStart / POSITION_WORDS;
        const words = this.staticWords;

        const fresh = this.stale || tint !== this.tint;

        if (fresh) this.state.fill(-1, 0, this.changedAt);
        this.tint = tint;
        // most frames move vertices and nothing else: a slot shows another entry only when the list changed
        if (fresh || this.marked || this.listDirty) {
            const written = writeEntries(this, home.statics, home.staticBytes, vertex * words, count);

            this.marked = false;
            if (written > 0 && mark) home.touchStatics(vertex * words, this.attributeSize * words);
        }
        const positions = home.attributeBuffer.float32View;
        const transform = this.place.groupTransform;
        const clipper = this.seen.clipped > 0 ? batchClipper() : undefined;

        placeEntries(this, positions, this._attributeStart, count, transform);
        home.dirty = true;
        if (clipper !== undefined) {
            // cut triangles are written with the indices of all slots, in the space of the skeleton
            if (!this.clipFresh && !clipper.fill(this, home, mark)) this.resized = true;
            this.stats.indices = this.drawn;
            placeMoved(
                positions,
                this._attributeStart + this.layout.vertices * POSITION_WORDS,
                this.clipUsed,
                transform,
            );
            // they are where the display object is now, and cannot be moved again
            this.clipFresh = false;
        } else if (this.listDirty || this.stale) {
            this.drawn = writeIndices(this, home.indexBuffer, this._indexStart, this.indexSize, vertex, count);
            if (mark) home.touchIndices(this._indexStart, this.indexSize);
        }
        this.stale = false;
        this.listDirty = false;
        this.dirty = false;
    }
}
