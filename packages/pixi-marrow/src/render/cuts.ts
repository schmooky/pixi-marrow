import type { TextureSource } from 'pixi.js';
import { type AtlasRegion, readRegion } from '../geometry/atlas-regions';
import { computeOutlineVertices } from '../geometry/outline-vertices';
import type { FloatArray } from '../geometry/read';
import { computeRegionUVs } from '../geometry/region';
import type { AtlasModel, AtlasPage } from '../model/atlas';
import type { RegionAttachmentData } from '../model/attachments';
import type { AtlasOutlines, PageRect } from '../model/outlines';

/*
 * The cuts of overdraw, as far as the vertex layout knows them. A region attachment whose atlas
 * region has an outline is laid out as that polygon. A region with an opaque rectangle gets the
 * corners of the rectangle next to its bone, for the test of covered slots.
 *
 * Both rest on the pixels of the page. The margins of an outline hold for bilinear filtering of
 * the page at its own size, so a page that is sampled in another way keeps its quads.
 *
 * What is exact and what is not:
 *
 * - A region without a visible pixel is laid out with no vertex. Exact: its quad shows nothing.
 * - A covered slot is left out. Exact: the triangles that stay are the same triangles.
 * - A polygon in place of a quad is not exact. It holds every pixel the quad shows, but a GPU
 *   interpolates texture coordinates from the corners of each triangle after it has moved them
 *   to its subpixel grid. Other triangles give other last bits, and a filtered texel can round
 *   to the next of 255 steps. A pixel whose center lies on the edge of the region can also fall
 *   to the other side of that edge. Measured with the render check: the same quads split along
 *   the other diagonal change up to 12 percent of the pixels by 1. Polygons are therefore asked
 *   for by name and are never the default.
 */

/** The pixels around a visible pixel that bilinear filtering can mix into a sample. */
export const FILTER_MARGIN = 0.5;

/** What a view cuts with: the outlines of its atlas and where they may be used. */
export interface Cuts {
    /** The outlines of the regions of the atlas, in region order. */
    readonly outlines: AtlasOutlines;
    /** Per atlas page: 1 when the texture of the page is sampled the way the outlines assume. */
    readonly pages: Uint8Array;
    /** Whether a region with a polygon is drawn as that polygon. Not exact, see the note above. */
    readonly tight: boolean;
    /** Whether a region without a visible pixel is laid out with no vertex. */
    readonly hollow: boolean;
    /** Whether opaque rectangles are laid out, for the test of covered slots. */
    readonly opaque: boolean;
}

/** What the outline of its region allows one region attachment. */
export interface RegionCut {
    /** The polygon as x, y pairs in page pixels. Empty when the region shows no pixel. Null when the quad stays. */
    readonly polygon: readonly number[] | null;
    /** Three vertex numbers of the polygon per triangle. */
    readonly triangles: Uint16Array;
    /** The rectangle in page pixels that hides what is drawn behind it, or null. */
    readonly opaque: PageRect | null;
}

/** An attachment that keeps its quad and hides nothing. */
export const NO_CUT: RegionCut = { polygon: null, triangles: new Uint16Array(0), opaque: null };

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
 * Why the texture of an atlas page keeps the quads of its regions. `size`: it has another pixel
 * size than the atlas states. `mipmaps` and `anisotropy`: it is filtered across pixels that are
 * further apart. `repeat`: it repeats where the atlas page does not. `premultiplied`: it holds a
 * premultiplied image for a page the atlas calls straight.
 */
export type PageBlock = 'size' | 'mipmaps' | 'anisotropy' | 'repeat' | 'premultiplied';

/**
 * Why the texture of an atlas page is not sampled the way outlines assume, or null when it is:
 * bilinear or nearest, from the pixels the outlines were built from. A page with a block keeps
 * its quads, and none of its regions hides a slot.
 *
 * The texture must have the pixel size the atlas states: on a scaled texture the margin of an
 * outline is less than a texel. It must have no mipmaps and no anisotropic filtering, which
 * both mix pixels that are further apart. It must not repeat where the atlas page does not, and
 * it must not hold a premultiplied image for a page the atlas calls straight.
 *
 * @example
 * const blocks = atlas.pages.map((page, i) => pageBlock(textures[i]?.source ?? Texture.WHITE.source, page));
 */
export function pageBlock(source: TextureSource, page: AtlasPage): PageBlock | null {
    const { style } = source;

    if (source.pixelWidth !== page.width || source.pixelHeight !== page.height) return 'size';
    if (source.autoGenerateMipmaps || source.mipLevelCount !== 1) return 'mipmaps';
    if (style.maxAnisotropy !== 1) return 'anisotropy';
    if ((!page.repeatX && style.addressModeU === 'repeat') || (!page.repeatY && style.addressModeV === 'repeat')) {
        return 'repeat';
    }

    return !page.pma && source.alphaMode === 'premultiplied-alpha' ? 'premultiplied' : null;
}

/**
 * Whether the texture of an atlas page is sampled the way outlines assume. See {@link pageBlock}.
 *
 * @example
 * const allowed = atlas.pages.map((page, i) => pageAllowsCuts(textures[i]?.source ?? Texture.WHITE.source, page));
 */
export function pageAllowsCuts(source: TextureSource, page: AtlasPage): boolean {
    return pageBlock(source, page) === null;
}

/**
 * What the outlines allow a region attachment that shows one atlas region. The quad stays for
 * an attachment with a sequence, for a region without an outline and on a page that fails
 * {@link pageAllowsCuts}. An opaque rectangle is given to a slot with normal blending only.
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
export function writePolygon(
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
export function writeOpaque(
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
