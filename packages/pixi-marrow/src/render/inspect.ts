import { type Buffer, type Container, Mesh } from 'pixi.js';
import { i16, i32 } from '../geometry/read';
import { GROUP_PAGES, layoutSlots } from './batch-layout';
import type { CoverTest } from './cover';
import type { CutState } from './cut-state';
import { FILTER_MARGIN, type PageBlock, pageBlock } from './cuts';
import { drawsPlain, type EdgeBend } from './gate';
import { ownsStatics } from './layouts';
import { AUTO_BATCH_VERTICES, type ModeReason, type RenderMode } from './mode';
import type { ViewPaints } from './paints';
import { u8 } from './read';
import { MAX_PAGES } from './shader';
import type { SkeletonView } from './skeleton-view';
import type { DrawMode } from './stats';
import type { Template } from './template';
import type { VisibleList } from './visible';

/*
 * What a view draws, what it decided and what it holds, as plain data for the perf report. The
 * view hands out its state and this module describes it. Nothing of the view imports it, so an
 * app loads it with the report, on demand, and an update pays nothing for it.
 */

/** What a visible slot is laid out as. A hollow region shows no pixel and has no vertex. */
type SlotShape = 'quad' | 'polygon' | 'hollow' | 'mesh';

/** One slot of the visible list of a view. */
interface VisibleSlot {
    /** The index of the slot. */
    slot: number;
    /** The slot whose clipping attachment cuts it, or -1. */
    clip: number;
    /** The group of atlas pages its draw samples: 8 pages in the mesh mode, 16 in a batch. */
    pageGroup: number;
    /** True when a later opaque slot covers it. It keeps its place and adds no index. */
    covered: boolean;
    /** What its attachment is laid out as. */
    shape: SlotShape;
    /** The vertices of its attachment. */
    vertices: number;
}

/** What a view cuts and what stops it, as plain data. */
export interface CutReport {
    /** The `tightMesh` option of the view. */
    tightMesh: 'auto' | 'on' | 'off';
    /** The `occlusion` option of the view. */
    occlusion: 'auto' | 'off';
    /** Whether the view has outlines. */
    outlines: boolean;
    /** Whether a draw that moves edges inside a pixel turned both cuts off for good. */
    hostile: boolean;
    /** What that draw did, or null when the caller did not say or no draw did it. */
    bend: EdgeBend | null;
    /** Per atlas page: why its regions keep their quads at the moment, or null. */
    pages: (PageBlock | null)[];
    /** Whether the margin of the outlines holds for bilinear filtering, so that polygons can be laid out. */
    polygonMargin: boolean;
    /** Whether the margin of the opaque rectangles holds for bilinear filtering, so that slots can be covered. */
    opaqueMargin: boolean;
}

/** How a view draws and why, as plain data. */
interface ModeReport {
    /** The `renderMode` option of the view. */
    option: RenderMode;
    /** The mode the view draws in at the moment. */
    mode: DrawMode;
    /** Why it draws in that mode. */
    reason: ModeReason;
    /** The vertices the skeleton has in a batch when every region is a quad. `auto` decides by this number. */
    vertices: number;
    /** The most of those vertices a skeleton can have for `auto` to batch it. */
    limit: number;
    /** The batches the view draws in. 0 in the mesh mode and before Pixi built the instructions. */
    batches: number;
    /** How many skeletons draw in the first of those batches, this one included. */
    sharedBy: number;
    /** The bytes of the batch buffers that belong to the view: its vertices and its indices. 0 in the mesh mode. */
    batchBytes: number;
    /** The vertices and the indices of cut triangles the batch has room for. 0 for a view that never clipped in a batch. */
    clipVertices: number;
    clipIndices: number;
}

/** A view as plain data. See {@link inspectView}. */
export interface ViewReport {
    /** The visible slots in draw order. */
    visible: VisibleSlot[];
    /** The render mode of the view and what decided it. */
    mode: ModeReport;
    /** The options of the cuts of overdraw and what stops them at the moment. */
    cuts: CutReport;
    /** How many attachments of the layout have an opaque rectangle, which can cover other slots. */
    opaqueRects: number;
    /** Whether Pixi draws the meshes as their vertices say. See `drawsPlain`. */
    plain: boolean;
    /**
     * The bytes of the typed arrays the view holds for its instance. These are the vertex data
     * of its pose, the visible list, the test of covered slots, and the index and mask data of
     * the mesh mode. In the batched mode the share of the batch buffers counts in place of index
     * data: the vertices and indices of the skeleton as the batcher keeps them. What the
     * instances of a model share is not counted, see {@link layoutBytes}.
     */
    arrayBytes: number;
    /**
     * The bytes of the typed arrays of the vertex layout, which the view shares with the other
     * instances of its model that show the same skin with the same cuts.
     */
    layoutBytes: number;
    /**
     * The bytes of the vertex, index and mask buffers on the GPU. In the batched mode the view
     * has no buffer of its own, and its share of the buffers of the batch counts. A view that
     * changed its mode keeps the buffers of the mesh mode. 0 for a view that was destroyed.
     */
    gpuBytes: number;
}

/** The state a view hands out to be described. */
export interface ViewParts {
    template: Template;
    seen: VisibleList;
    cover: CoverTest;
    cutState: CutState;
    /** What the view draws with in each mode, and the mode that draws now. */
    paints: ViewPaints;
    /** Why the view draws in its mode. */
    reason: ModeReason;
    /** The `renderMode` option of the view. */
    renderMode: RenderMode;
}

const sumBytes = (arrays: readonly ArrayBufferView[]): number =>
    arrays.reduce((sum, array) => sum + array.byteLength, 0);

/**
 * The bytes of the typed arrays a template has for its instance alone: the positions, the
 * colors, and the frame and the page each entry shows. With a sequence in the layout the texture
 * coordinates count too, since the instance then has its own.
 *
 * @example
 * console.log(templateArrayBytes(template), layoutArrayBytes(template));
 */
export function templateArrayBytes(template: Template): number {
    const { frames, pages, light, dark, positions, colors, statics } = template;

    // the flags are bytes of the texture coordinates
    return sumBytes([frames, pages, light, dark, positions, colors]) + (ownsStatics(template) ? statics.byteLength : 0);
}

/**
 * The bytes of the typed arrays a template shares with the other instances of its layout: what
 * the layout knows per entry, and the texture coordinates unless an entry has a sequence. The
 * triangles of the entries are left out. They belong to the model, to the outlines or to the one
 * quad all region attachments share.
 *
 * @example
 * console.log(layoutArrayBytes(template)); // once for all instances that show this skin
 */
export function layoutArrayBytes(template: Template): number {
    const arrays = [
        template.slotEntries,
        template.slots,
        template.first,
        template.counts,
        template.hollow,
        template.tightAt,
        template.opaqueAt,
        template.opaqueAreas,
        template.tints,
        template.frameCounts,
        template.pageAt,
        template.uvAt,
        template.offsetAt,
        template.framePages,
        template.frameUVs,
        template.offsets,
        template.tightOffsets,
        template.opaqueOffsets,
    ];

    return sumBytes(arrays) + (ownsStatics(template) ? 0 : template.statics.byteLength);
}

/**
 * The options of the cuts of a view and what stops them at the moment. It looks at every page
 * texture.
 *
 * @example
 * const { hostile, pages } = describeCuts(view.parts.cutState);
 * console.log(hostile, pages.filter((block) => block !== null));
 */
export function describeCuts(state: CutState): CutReport {
    const outlines = state.held;
    let tightMesh: CutReport['tightMesh'] = state.hollow ? 'auto' : 'off';

    if (state.tight) tightMesh = 'on';

    return {
        tightMesh,
        occlusion: state.occlusion ? 'auto' : 'off',
        outlines: outlines !== undefined,
        hostile: state.hostile,
        bend: state.bend,
        pages: state.atlas.pages.map((page, i) => {
            const source = state.sources[i];

            return source === undefined ? null : pageBlock(source, page);
        }),
        polygonMargin: outlines !== undefined && outlines.margin >= FILTER_MARGIN,
        opaqueMargin: outlines !== undefined && outlines.opaqueMargin >= FILTER_MARGIN,
    };
}

/**
 * The bytes the buffers of every mesh below a container take on the GPU. A buffer that meshes
 * share counts once. A buffer keeps its size when its data shrinks.
 */
function meshBufferBytes(container: Container): number {
    const buffers = new Set<Buffer>();
    const visit = (node: Container): void => {
        // the index buffer of a geometry is one of its buffers
        if (node instanceof Mesh) for (const buffer of node.geometry.buffers) buffers.add(buffer);
        for (const child of node.children) visit(child);
    };
    let bytes = 0;

    visit(container);
    for (const buffer of buffers) bytes += buffer.descriptor.size;

    return bytes;
}

function shapeOf(template: Template, entry: number): SlotShape {
    if (template.sources[entry] != null) return 'mesh';
    if (u8(template.hollow, entry) === 1) return 'hollow';

    return i32(template.tightAt, entry) >= 0 ? 'polygon' : 'quad';
}

/**
 * Reads a view into plain data: its visible slots, its cuts and its bytes. The GPU bytes are
 * those of the buffers of its meshes, which a view that was destroyed no longer has.
 *
 * @example
 * const report = inspectView(view);
 * console.log(report.visible.filter((slot) => slot.covered).length, report.arrayBytes, report.gpuBytes);
 */
export function inspectView(view: SkeletonView): ViewReport {
    const { template, seen, cover, cutState, paints, reason, renderMode } = view.parts;
    const { element } = paints;
    const visible: VisibleSlot[] = [];
    // the batch buffers hold the data of a skeleton once Pixi has built the instructions with it
    const batchBytes = element?.placed ? element.bytes : 0;
    const layout = element?.layout ?? layoutSlots(template, cover.skipped.length);

    for (let i = 0; i < seen.count; i++) {
        const entry = i32(seen.list, i);

        visible.push({
            slot: i32(template.slots, entry),
            clip: i16(seen.clips, i),
            pageGroup: Math.floor(i32(template.pages, entry) / (element === undefined ? MAX_PAGES : GROUP_PAGES)),
            covered: u8(cover.skipped, i) === 1,
            shape: shapeOf(template, entry),
            vertices: i32(template.counts, entry),
        });
    }

    return {
        visible,
        mode: {
            option: renderMode,
            mode: paints.mode,
            reason,
            vertices: layout.plain,
            limit: AUTO_BATCH_VERTICES,
            batches: element?.placed ? element.runs : 0,
            sharedBy: element?.placed ? (element.batches[0]?.elements.length ?? 0) : 0,
            batchBytes,
            clipVertices: element?.clipVertices ?? 0,
            clipIndices: element?.clipIndices ?? 0,
        },
        cuts: describeCuts(cutState),
        opaqueRects: template.opaqueCount,
        plain: drawsPlain(view.container),
        arrayBytes:
            templateArrayBytes(template) +
            seen.bytes +
            cover.bytes +
            cutState.allowed.byteLength +
            (paints.mesh?.ranges.bytes ?? 0) +
            (paints.body?.element.arrayBytes ?? 0) +
            batchBytes,
        layoutBytes: layoutArrayBytes(template),
        gpuBytes: meshBufferBytes(view.container) + batchBytes,
    };
}
