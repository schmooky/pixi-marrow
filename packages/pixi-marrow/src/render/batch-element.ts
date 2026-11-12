import type {
    Batch,
    BatchableElement,
    Batcher,
    BLEND_MODES,
    IndexBufferArray,
    Matrix,
    Texture,
    TextureSource,
    Topology,
    ViewableBuffer,
} from 'pixi.js';
import type { SkeletonModel } from '../model/model';
import type { PoseState } from '../pose/state';
import { noteTransform, spreadRuns } from './batch-cut';
import {
    GROUP_PAGES,
    holdsLayout,
    PAGE_SHIFT,
    POSITION_WORDS,
    RUN_PAD,
    type SlotLayout,
    STATIC_WORDS,
} from './batch-layout';
import { type PackSource, placeEntries, planRuns, STATICS_CHANGED, writeEntries, writeIndices } from './batch-pack';
import { clipCode } from './clip-code';
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
    /** Says that a stretch of the positions changed: `words` words from word `from` on. */
    touchPositions(from: number, words: number): void;
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

/** The display object of a skeleton in a batch, as its element reads it. */
export interface BatchPlace {
    /** The transform, the tint and the blend mode inside the render group, as Pixi computed them last. */
    readonly groupTransform: Matrix;
    readonly groupColorAlpha: number;
    readonly groupBlendMode: BLEND_MODES;
    /** Tells Pixi that the skeleton changed, so that it asks the pipe about it in the next frame. */
    touch(): void;
}

/** What an element is created with. */
export interface BatchElementOptions {
    /** The display object of the skeleton: its transform, tint and blend mode inside the render group. */
    readonly place: BatchPlace;
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
    packedFrom = 0;
    packedTo = 0;

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
    clipFresh = false;
    /** True while the batch holds them where the display object is: nothing moved or changed since. */
    clipPlaced = false;
    readonly stats: ViewStats;
    readonly place: BatchPlace;
    /** True when the batch holds nothing of the vertex ranges as they are: everything is written again. */
    private stale = true;
    /** True when an entry was marked since the batch got the entries. */
    private marked = false;
    /** The transform of the display object that the positions in the batch were placed with. */
    private readonly placedWith = new Float64Array(6);

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
        this.clipPlaced = false;
        this.listDirty = true;
        this.dirty = true;
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
        this.state[this.changedAt + entry] = Number(this.state[this.changedAt + entry]) | STATICS_CHANGED;
        this.marked = true;
        this.dirty = true;
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

        clipCode()?.size(this);
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
        this.clipPlaced = false;
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
        spreadRuns(this.batches, this.runSizes, this.runs, this._indexStart);
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
        // every vertex carries the tint of the display object
        const fresh = this.stale || tint !== this.tint;
        // an entry shows other colors, another frame or another attachment only now and then
        const statics = fresh || this.marked || this.listDirty;

        // a new place in the batch holds no entry of any slot
        if (this.stale) this.state.fill(-1, 0, this.changedAt);
        this.tint = tint;
        if (statics) {
            const written = writeEntries(this, home.statics, home.staticBytes, vertex * words, count, fresh);

            this.marked = false;
            if (written > 0 && mark) home.touchStatics(vertex * words, this.attributeSize * words);
        }
        const positions = home.attributeBuffer.float32View;
        const transform = this.place.groupTransform;
        // every vertex is placed again where the batch holds none of them, and after a move of the display object
        const all = noteTransform(this.placedWith, transform) || this.stale;

        placeEntries(this, positions, this._attributeStart, count, transform, all);
        if (mark && all) home.touchPositions(this._attributeStart, this.attributeSize * POSITION_WORDS);
        else if (mark) home.touchPositions(this.packedFrom, this.packedTo - this.packedFrom);
        if (this.seen.clipped > 0) clipCode()?.write(this, home, mark, all, statics);
        else if (this.listDirty || this.stale) {
            this.drawn = writeIndices(this, home.indexBuffer, this._indexStart, this.indexSize, vertex, count);
            if (mark) home.touchIndices(this._indexStart, this.indexSize);
        }
        this.stale = false;
        this.listDirty = false;
        this.dirty = false;
    }
}
