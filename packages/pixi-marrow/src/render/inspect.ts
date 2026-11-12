import { type Buffer, type Container, Mesh } from 'pixi.js';
import { i16, i32 } from '../geometry/read';
import type { CoverTest } from './cover';
import type { CutState } from './cut-state';
import { FILTER_MARGIN, type PageBlock, pageBlock } from './cuts';
import { drawsPlain, type EdgeBend } from './gate';
import type { DrawRanges } from './ranges';
import { u8 } from './read';
import { MAX_PAGES } from './shader';
import type { SkeletonView } from './skeleton-view';
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
    /** The group of 8 atlas pages its draw range samples. */
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

/** A view as plain data. See {@link inspectView}. */
export interface ViewReport {
    /** The visible slots in draw order. */
    visible: VisibleSlot[];
    /** The options of the cuts of overdraw and what stops them at the moment. */
    cuts: CutReport;
    /** How many attachments of the layout have an opaque rectangle, which can cover other slots. */
    opaqueRects: number;
    /** Whether Pixi draws the meshes as their vertices say. See `drawsPlain`. */
    plain: boolean;
    /**
     * The bytes of the typed arrays the view holds for its instance. These are the vertex layout
     * with its vertex data, the visible list, the test of covered slots, and the index and mask
     * data. Triangles that entries share with the model or with the outlines are not counted.
     */
    arrayBytes: number;
    /** The bytes of the vertex, index and mask buffers on the GPU. 0 for a view that was destroyed. */
    gpuBytes: number;
}

/** The state a view hands out to be described. */
export interface ViewParts {
    template: Template;
    seen: VisibleList;
    cover: CoverTest;
    cutState: CutState;
    ranges: DrawRanges;
}

/**
 * The bytes of the typed arrays of a template: what the layout knows per entry, and the vertex
 * data. The triangles of the entries are left out. They belong to the model, to the outlines or
 * to the one quad all region attachments share.
 *
 * @example
 * console.log(templateArrayBytes(template) - templateBytes(template)); // the layout without vertex data
 */
export function templateArrayBytes(template: Template): number {
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
        template.frames,
        template.pages,
        template.light,
        template.dark,
        template.framePages,
        template.frameUVs,
        template.offsets,
        template.tightOffsets,
        template.opaqueOffsets,
        template.positions,
        // the flags are bytes of this array
        template.statics,
        template.colors,
    ];

    return arrays.reduce((sum, array) => sum + array.byteLength, 0);
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
    const { template, seen, cover, cutState, ranges } = view.parts;
    const visible: VisibleSlot[] = [];

    for (let i = 0; i < seen.count; i++) {
        const entry = i32(seen.list, i);

        visible.push({
            slot: i32(template.slots, entry),
            clip: i16(seen.clips, i),
            pageGroup: Math.floor(i32(template.pages, entry) / MAX_PAGES),
            covered: u8(cover.skipped, i) === 1,
            shape: shapeOf(template, entry),
            vertices: i32(template.counts, entry),
        });
    }

    return {
        visible,
        cuts: describeCuts(cutState),
        opaqueRects: template.opaqueCount,
        plain: drawsPlain(view.container),
        arrayBytes:
            templateArrayBytes(template) + seen.bytes + cover.bytes + cutState.allowed.byteLength + ranges.bytes,
        gpuBytes: meshBufferBytes(view.container),
    };
}
