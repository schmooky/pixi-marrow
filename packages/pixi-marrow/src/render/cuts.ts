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
 *
 * The code that makes the cuts loads with the outlines, see `cut-code.ts`. This file holds what a
 * layout without cuts needs: the types, and the cut of an attachment that keeps its quad.
 */

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
