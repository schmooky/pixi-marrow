/** A rectangle on an atlas page, in pixels. `x` and `y` are the top left corner. */
export interface PageRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * What the pixels of one atlas region allow: a polygon that is smaller than the quad, and a
 * rectangle that hides everything behind it. All positions are in pixels of the page, with y down.
 */
export interface RegionOutline {
    /** The name of the region in the atlas. A reader compares it, to refuse a file of another atlas. */
    name: string;
    /** The rectangle of the region on its page. A region rotated by 90 degrees has its sides swapped. */
    rect: PageRect;
    /**
     * The outline as x, y pairs: a convex polygon inside {@link rect} that holds every visible
     * pixel and a margin around it. Empty when the region has no visible pixel, so nothing is
     * drawn. Null when the polygon saves too little: the quad stays.
     */
    polygon: number[] | null;
    /** Three vertex numbers of the polygon per triangle, as a fan around vertex 0. Empty without a polygon. */
    triangles: number[];
    /** The share of {@link rect} that the outline covers, from 0 to 1. Stated for a quad that stays as well. */
    coverage: number;
    /**
     * The largest rectangle in which every pixel has alpha 255, made smaller by the margin on
     * every side. Null when it is smaller than the least useful area.
     */
    opaque: PageRect | null;
}

/**
 * The outlines of every region of one atlas. Plain data: it survives `JSON.stringify` and
 * `JSON.parse` unchanged. The `pixi-marrow outlines` command writes it next to the atlas.
 */
export interface AtlasOutlines {
    /** The format version. A reader refuses every other number. */
    version: 1;
    /** The pixels around every visible pixel that the outlines keep. */
    margin: number;
    /** The pixels every opaque rectangle stays away from a pixel that is not opaque. */
    opaqueMargin: number;
    /** One item per region of the atlas, in region order. Null for a region on a page that was not read. */
    regions: (RegionOutline | null)[];
}
