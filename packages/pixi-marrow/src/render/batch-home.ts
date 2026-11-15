import type { BLEND_MODES, IndexBufferArray, Matrix, Texture, TextureSource, ViewableBuffer } from 'pixi.js';
import type { SkeletonModel } from '../model/model';
import type { BatchElement } from './batch-element';
import type { SlotLayout } from './batch-layout';
import type { CoverTest } from './cover';
import type { DrawGate } from './gate';
import type { ViewStats } from './stats';
import type { Template } from './template';
import type { VisibleList } from './visible';

/*
 * What a batch element is made of and what it talks to: the batcher that holds it, the display
 * object it draws for, and the parts behind attached containers. Types only.
 */

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
 * The runs of a skeleton behind a container that is attached between two slots. Pixi collects
 * the container between the skeleton and this part, so the part is added to the batcher on its
 * own, after the skeleton. It has no room of its own: its runs are in the room of the skeleton.
 */
export interface BatchPart {
    /** The element of the skeleton. */
    readonly owner: BatchElement;
    /** Which attached container the part follows: an index into {@link BatchElement.partRuns}. */
    readonly index: number;
}
