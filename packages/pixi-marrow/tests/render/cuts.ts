import { Texture, TextureSource } from 'pixi.js';
import { readRegion } from '../../src/geometry/atlas-regions';
import { regionPageRect } from '../../src/geometry/tight';
import type { AtlasModel, AtlasPage } from '../../src/model/atlas';
import type { AtlasOutlines, PageRect, RegionOutline } from '../../src/model/outlines';
import type { SkeletonViewOptions } from '../../src/render/skeleton-view';
import { type Drawable, meshes, type Rig, type RigView, visibleSlots } from './rig';

/*
 * What the tests of the cuts of overdraw share: page textures that allow cuts, outlines made by
 * hand, and a reader of the index buffers that knows about polygons and skipped slots.
 */

/** A texture with the pixel size of its atlas page and no mipmaps: one that allows cuts. */
export const pageTexture = (page: AtlasPage): Texture =>
    new Texture({ source: new TextureSource({ width: page.width, height: page.height }) });

/** One texture per atlas page that allows cuts. */
export const pageTextures = (atlas: AtlasModel): Texture[] => atlas.pages.map(pageTexture);

/** Outlines in which every region keeps its quad and hides nothing. */
export function plainOutlines(atlas: AtlasModel): AtlasOutlines {
    return {
        version: 1,
        margin: 1,
        opaqueMargin: 1,
        regions: atlas.regionNames.map((name, index) => ({
            name,
            rect: regionPageRect(readRegion(atlas, index)),
            polygon: null,
            triangles: [],
            coverage: 1,
            opaque: null,
        })),
    };
}

/** The outline of the first region with a name. Throws when the outlines have none. */
export function outlineOf(outlines: AtlasOutlines, name: string): RegionOutline {
    const region = outlines.regions.find((candidate) => candidate?.name === name);

    if (region == null) throw new Error(`no outline for the region ${name}`);

    return region;
}

/** Points inside a rectangle, given as fractions of its width and height, as x, y pairs in page pixels. */
export function pointsIn(rect: PageRect, fractions: readonly number[]): number[] {
    return fractions.map((fraction, i) =>
        i % 2 === 0 ? rect.x + fraction * rect.width : rect.y + fraction * rect.height,
    );
}

/** The triangles of a convex polygon as a fan around its first vertex. */
function fan(vertices: number): number[] {
    const triangles: number[] = [];

    for (let i = 1; i < vertices - 1; i++) triangles.push(0, i, i + 1);

    return triangles;
}

/** A pentagon that touches no corner of its rectangle, as fractions of the rectangle. */
export const PENTAGON: readonly number[] = [0.125, 0, 0.875, 0.125, 1, 0.75, 0.375, 1, 0, 0.5];

/** Gives a region the polygon of some fractions of its rectangle. */
export function setPolygon(outlines: AtlasOutlines, name: string, fractions: readonly number[]): void {
    const region = outlineOf(outlines, name);

    region.polygon = pointsIn(region.rect, fractions);
    region.triangles = fan(fractions.length / 2);
}

/** Gives a region an opaque rectangle, as fractions x0, y0, x1, y1 of its own rectangle. */
export function setOpaque(outlines: AtlasOutlines, name: string, fractions: readonly number[]): void {
    const region = outlineOf(outlines, name);
    const [x0 = 0, y0 = 0, x1 = 1, y1 = 1] = pointsIn(region.rect, fractions);

    region.opaque = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** What a rig with cuts is drawn with: textures of the page sizes, and outlines that a function fills in. */
export function cutView(
    fill: (outlines: AtlasOutlines, atlas: AtlasModel) => void,
    options: Omit<SkeletonViewOptions, 'outlines'> = {},
): RigView {
    return {
        textures: pageTextures,
        options: (atlas) => {
            const outlines = plainOutlines(atlas);

            fill(outlines, atlas);

            return { ...options, outlines };
        },
    };
}

/** A visible slot in the index buffers of a view with cuts. */
export interface CutSlot {
    slot: number;
    attachment: Drawable;
    /** The first vertex of its range, or -1 when it has no index. */
    first: number;
    /** Its indices, relative to the first vertex. Empty when the slot is skipped. */
    triangles: number[];
}

/** The indices the meshes of a view draw, range by range. */
export function drawnIndices(rig: Rig): number[][] {
    return meshes(rig.view).map((mesh) =>
        Array.from(mesh.geometry.indexBuffer.data.subarray(0, mesh.geometry.indexCount)),
    );
}

/**
 * Reads the index buffer of a view that draws one range. `sizes` says how many indices each
 * visible slot has: 0 for a slot that is skipped. Every index of the buffer must be used.
 */
export function readCutSlots(rig: Rig, sizes: (slot: number, attachment: Drawable) => number): CutSlot[] {
    const [indices = [], ...more] = drawnIndices(rig);
    const out: CutSlot[] = [];
    let at = 0;

    if (more.length > 0) throw new Error('the view draws more than one range');
    for (const { slot, attachment } of visibleSlots(rig)) {
        const size = sizes(slot, attachment);
        const own = indices.slice(at, at + size);
        const first = size === 0 ? -1 : Math.min(...own);

        out.push({ slot, attachment, first, triangles: own.map((index) => index - first) });
        at += size;
    }
    if (at !== indices.length && !(at === 0 && indices.every((index) => index === 0))) {
        throw new Error(`the view draws ${indices.length} indices and the slots account for ${at}`);
    }

    return out;
}
