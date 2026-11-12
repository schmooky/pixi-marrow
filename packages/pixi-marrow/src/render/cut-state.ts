import type { TextureSource } from 'pixi.js';
import type { AtlasModel } from '../model/atlas';
import type { AtlasOutlines } from '../model/outlines';
import { type Cuts, pageAllowsCuts } from './cuts';

/** Which cuts a view was asked for. */
export interface CutChoice {
    /** The outlines of the atlas regions, or undefined when there are none. */
    outlines?: AtlasOutlines | undefined;
    /**
     * What a region attachment is laid out as. `auto` (the default) keeps its quad, and gives a
     * region without a visible pixel no vertex at all. `on` lays a region out as the polygon
     * around its visible pixels: fewer pixels are shaded, and edge pixels can differ in the last
     * bit from the picture of the quads. `off` keeps every quad.
     */
    tightMesh?: 'auto' | 'on' | 'off' | undefined;
    /** `off` draws every slot. */
    occlusion?: 'auto' | 'off' | undefined;
}

/**
 * What one view knows about its cuts of overdraw: the outlines and the options. It also keeps
 * how each page texture was sampled at the last layout, and what Pixi did to the last draw.
 *
 * @example
 * const state = new CutState(atlas, sources, { outlines });
 * const template = buildTemplate(model, atlas, lookup, -1, null, false, state.take());
 * if (state.changed || state.pagesMoved()) console.log('lay the vertex ranges out again');
 */
export class CutState {
    /**
     * True once a renderer drew the view in a way that moves edges inside a pixel: it rounds
     * positions, or its target is multisampled. Both cuts stay off from then on, so that a view
     * that is drawn to two kinds of targets is not laid out again in every frame.
     */
    hostile = false;
    private outlines: AtlasOutlines | undefined;
    /** Polygons in place of quads. */
    private readonly tight: boolean;
    /** No vertex for a region without a visible pixel. */
    private readonly hollow: boolean;
    private readonly occlusion: boolean;
    private readonly atlas: AtlasModel;
    private readonly sources: readonly TextureSource[];
    /** Per atlas page: 1 when the page allowed cuts at the last layout. */
    private readonly allowed: Uint8Array;
    /** True when the outlines or the renderer changed since the last layout. */
    private stale = false;

    /** @param sources The texture source of every atlas page, in page order. */
    constructor(atlas: AtlasModel, sources: readonly TextureSource[], choice: CutChoice) {
        this.atlas = atlas;
        this.sources = sources;
        this.outlines = choice.outlines;
        this.tight = choice.tightMesh === 'on';
        this.hollow = choice.tightMesh !== 'off';
        this.occlusion = choice.occlusion !== 'off';
        this.allowed = new Uint8Array(sources.length);
    }

    /** Whether the view cuts at all: it has outlines, an option that is on, and no draw forbade it. */
    get wanted(): boolean {
        return this.outlines !== undefined && !this.hostile && (this.hollow || this.occlusion);
    }

    /** Gives the view other outlines, or none. The next layout uses them. */
    setOutlines(outlines: AtlasOutlines | undefined): void {
        if (outlines === this.outlines) return;
        // a view that cuts nothing has no polygon to take back and none to add
        if (!this.hostile && (this.hollow || this.occlusion)) this.stale = true;
        this.outlines = outlines;
    }

    /** Turns both cuts off for good, after a draw that moves edges inside a pixel. */
    forbid(): void {
        if (this.hostile) return;
        if (this.wanted) this.stale = true;
        this.hostile = true;
    }

    /** True when the outlines changed or a draw forbade the cuts since the last layout. It must be made again. */
    get changed(): boolean {
        return this.stale;
    }

    /**
     * Whether a page texture is sampled in another way than at the last layout, which must then
     * be made again. Reads a few properties of every page texture, so a view asks when the answer
     * matters: before a draw that leaves something out, and now and then.
     */
    pagesMoved(): boolean {
        if (!this.wanted) return false;
        const { sources, allowed } = this;
        const { pages } = this.atlas;

        for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            const page = pages[i];

            if (source === undefined || page === undefined) continue;
            if ((pageAllowsCuts(source, page) ? 1 : 0) !== allowed[i]) return true;
        }

        return false;
    }

    /** The cuts for a layout that is made now, or undefined for none. Remembers how the pages are sampled. */
    take(): Cuts | undefined {
        const { outlines, sources, allowed } = this;
        const { pages } = this.atlas;

        this.stale = false;
        if (outlines === undefined || !this.wanted) return undefined;
        for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            const page = pages[i];

            allowed[i] = source !== undefined && page !== undefined && pageAllowsCuts(source, page) ? 1 : 0;
        }

        return { outlines, pages: allowed, tight: this.tight, hollow: this.hollow, opaque: this.occlusion };
    }
}
