import { type AtlasRegion, readRegion } from '../geometry/atlas-regions';
import { computeOutlineVertices } from '../geometry/outline-vertices';
import type { FloatArray } from '../geometry/read';
import { computeRegionUVs } from '../geometry/region';
import type { AtlasModel } from '../model/atlas';
import type { RegionAttachmentData } from '../model/attachments';
import type { AtlasOutlines, PageRect } from '../model/outlines';
import { CoverSearch } from './cover-search';
import type { CutCode } from './cut-code';
import { type Cuts, NO_CUT, type RegionCut } from './cuts';
import { FILTER_MARGIN } from './page-block';
import { STATIC_STRIDE, type Template, type TemplateCursor } from './template';

/*
 * The code that cuts overdraw: what the outline of its region allows an attachment, the
 * polygon and the opaque rectangle of an entry of the vertex layout, and the search for covered
 * slots. It is a chunk of its own that loads with the outlines, see `cut-code.ts`. What the cuts
 * are and which of them are exact is said in `cuts.ts`.
 */

/** The triangles of each outline as the index type of a template. All views of an atlas share them. */
const triangleCache = new WeakMap<number[], Uint16Array>();

function trianglesOf(list: number[]): Uint16Array {
    let triangles = triangleCache.get(list);

    if (triangles === undefined) {
        triangles = Uint16Array.from(list);
        triangleCache.set(list, triangles);
    }

    return triangles;
}

/**
 * The bytes of the triangle arrays that the views of an atlas share for its outlines at the moment.
 * An outline gets its array when a view first lays its polygon out.
 *
 * @example
 * console.log(sharedTriangleBytes(asset.outlines));
 */
export function sharedTriangleBytes(outlines: AtlasOutlines): number {
    let bytes = 0;

    for (const region of outlines.regions) {
        if (region !== null) bytes += triangleCache.get(region.triangles)?.byteLength ?? 0;
    }

    return bytes;
}

/**
 * What the outlines allow a region attachment that shows one atlas region. The quad stays for
 * an attachment with a sequence, for a region without an outline and on a page that fails
 * `pageAllowsCuts`. An opaque rectangle is given to a slot with normal blending only.
 * An empty polygon stands for a region without a visible pixel.
 *
 * @example
 * const cut = regionCut(cuts, atlas, attachment, attachmentRegions(atlas, attachment), true);
 * if (cut.polygon !== null) console.log(cut.polygon.length / 2, cut.triangles.length);
 */
export function regionCut(
    cuts: Cuts | undefined,
    atlas: AtlasModel,
    attachment: RegionAttachmentData,
    regions: Int32Array,
    normalBlend: boolean,
): RegionCut {
    const index = regions[0];

    if (cuts === undefined || attachment.sequence !== null || regions.length !== 1 || index === undefined) {
        return NO_CUT;
    }
    const outline = cuts.outlines.regions[index];

    if (outline == null || cuts.pages[readRegion(atlas, index).page] !== 1) return NO_CUT;
    const { polygon } = outline;
    const wanted = polygon !== null && (polygon.length === 0 ? cuts.hollow : cuts.tight);
    const tight = wanted && cuts.outlines.margin >= FILTER_MARGIN;
    const opaque = cuts.opaque && cuts.outlines.opaqueMargin >= FILTER_MARGIN && normalBlend;

    return {
        polygon: tight ? polygon : null,
        triangles: tight ? trianglesOf(outline.triangles) : NO_CUT.triangles,
        opaque: opaque ? outline.opaque : null,
    };
}

/** The texture coordinates of the quad of the region that is being laid out. */
const quadUVs = new Float64Array(8);
/** The corners of an opaque rectangle, around the rectangle. */
const corners = new Float64Array(8);
/** Texture coordinates nobody reads: an opaque rectangle is never drawn. */
const unused = new Float64Array(8);

/**
 * Writes the vertices of a polygon for a region attachment. The offsets from the bone go to
 * `outOffsets` from `offsetsAt` on. The texture coordinates go to `outUVs`, one pair every
 * `uvStride` numbers from `uvsAt` on. `quadOffsets` holds the 8 offsets of the quad.
 *
 * @example
 * writePolygon(cut.polygon, region, template.offsets.subarray(at, at + 8), tightOffsets, 0, statics, 0, 3);
 */
function writePolygon(
    polygon: ArrayLike<number>,
    region: AtlasRegion,
    quadOffsets: FloatArray,
    outOffsets: FloatArray,
    offsetsAt: number,
    outUVs: FloatArray,
    uvsAt: number,
    uvStride: number,
): void {
    computeRegionUVs(region, quadUVs);
    computeOutlineVertices(
        polygon,
        region.pageWidth,
        region.pageHeight,
        quadOffsets,
        quadUVs,
        outOffsets,
        outUVs,
        offsetsAt,
        uvsAt,
        uvStride,
    );
}

/**
 * Writes the four corners of an opaque rectangle as offsets from the bone, 8 numbers from
 * `offsetsAt` on, in the order around the rectangle. Returns the area between them.
 *
 * @example
 * const area = writeOpaque(cut.opaque, region, template.offsets.subarray(at, at + 8), opaqueOffsets, 0);
 */
function writeOpaque(
    rect: PageRect,
    region: AtlasRegion,
    quadOffsets: FloatArray,
    outOffsets: Float64Array,
    offsetsAt: number,
): number {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;

    corners[0] = rect.x;
    corners[1] = rect.y;
    corners[2] = right;
    corners[3] = rect.y;
    corners[4] = right;
    corners[5] = bottom;
    corners[6] = rect.x;
    corners[7] = bottom;
    writePolygon(corners, region, quadOffsets, outOffsets, offsetsAt, unused, 0, 2);
    const ax = (outOffsets[offsetsAt + 2] ?? 0) - (outOffsets[offsetsAt] ?? 0);
    const ay = (outOffsets[offsetsAt + 3] ?? 0) - (outOffsets[offsetsAt + 1] ?? 0);
    const bx = (outOffsets[offsetsAt + 6] ?? 0) - (outOffsets[offsetsAt] ?? 0);
    const by = (outOffsets[offsetsAt + 7] ?? 0) - (outOffsets[offsetsAt + 1] ?? 0);

    return Math.abs(ax * by - ay * bx);
}

/**
 * Writes what the outline of its region gives a region entry: the vertices of the polygon in
 * place of the corners of the quad, and the corners of the opaque rectangle. The offsets of
 * the quad are in place before it runs. Without a polygon the entry gets the quad.
 *
 * @example
 * if (cut !== NO_CUT) fillCut(template, entry, readRegion(atlas, index), cut, cursor);
 */
export function fillCut(
    template: Template,
    entry: number,
    region: AtlasRegion,
    cut: RegionCut,
    cursor: TemplateCursor,
): void {
    const { polygon, opaque } = cut;
    const quad = template.offsets.subarray(cursor.offset, cursor.offset + 8);
    const at = cursor.vertex * STATIC_STRIDE;

    if (polygon === null) computeRegionUVs(region, template.statics, at, STATIC_STRIDE);
    else if (polygon.length > 0) {
        template.tightAt[entry] = cursor.tight;
        writePolygon(polygon, region, quad, template.tightOffsets, cursor.tight, template.statics, at, STATIC_STRIDE);
        cursor.tight += polygon.length;
    }
    if (opaque !== null) {
        template.opaqueAt[entry] = cursor.opaque;
        template.opaqueAreas[entry] = writeOpaque(opaque, region, quad, template.opaqueOffsets, cursor.opaque);
        cursor.opaque += 8;
    }
}

/**
 * The code that cuts overdraw. `cut-code.ts` hands it out once this module is loaded.
 *
 * @example
 * const { cutWork } = await import('./cut-work');
 * const cut = cutWork.regionCut(cuts, atlas, attachment, attachmentRegions(atlas, attachment), true);
 */
export const cutWork: CutCode = {
    regionCut,
    fillCut,
    triangleBytes: sharedTriangleBytes,
    createSearch: (skipped: Uint8Array): CoverSearch => new CoverSearch(skipped),
};
