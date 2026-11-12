import { RenderContainer, type Renderer, type Texture } from 'pixi.js';
import { importAtlas, importSkeleton } from '../../src/core';
import { type AtlasOutlines, MarrowAsset, type MarrowSpine } from '../../src/index';
import type { AtlasModel } from '../../src/model/atlas';
import type { RigFiles } from '../parity/official';
import { type CoverSlot, coverFiles, opaqueSquares } from '../render/cover-rig';
import { pageTextures, plainOutlines } from '../render/cuts';

/*
 * Assets of rigs that are made by hand, with page textures that allow cuts and outlines the
 * test writes. They show what the display object does with outlines, without a GPU.
 */

/** What {@link filesAsset} makes an asset with. */
export interface AssetParts {
    /** Changes the outlines before the asset gets them. They start with a quad for every region. */
    fill?: (outlines: AtlasOutlines, atlas: AtlasModel) => void;
    /** `off` loads the asset without outlines. */
    outlines?: 'given' | 'off';
    /** The page textures. Default: one per page with the size of the page, which allows cuts. */
    textures?: (atlas: AtlasModel) => Texture[];
}

/** An asset from the files of a skeleton, with outlines made by hand. */
export async function filesAsset(files: RigFiles, parts: AssetParts = {}): Promise<MarrowAsset> {
    const model = await importSkeleton(files.skeleton);
    const atlas = importAtlas(files.atlas);
    const outlines = plainOutlines(atlas);

    parts.fill?.(outlines, atlas);

    return MarrowAsset.from({
        model,
        atlas,
        textures: (parts.textures ?? pageTextures)(atlas),
        outlines: parts.outlines === 'off' ? 'off' : outlines,
    });
}

/** An asset of a cover rig. Every region has its opaque rectangle before `fill` runs. */
export function coverAsset(slots: readonly CoverSlot[], parts: AssetParts = {}): Promise<MarrowAsset> {
    return filesAsset(coverFiles(slots), {
        ...parts,
        fill: (outlines, atlas) => {
            opaqueSquares(outlines);
            parts.fill?.(outlines, atlas);
        },
    });
}

/** A renderer as far as a view looks at it before a draw. */
export function fakeRenderer(roundPixels: boolean, antialias: boolean): Renderer {
    return { roundPixels, renderTarget: { renderTarget: { colorTextures: [{ antialias }] } } } as unknown as Renderer;
}

/** Tells the view of a display object that a renderer is about to draw it, as Pixi does. */
export function drawWith(spine: MarrowSpine, renderer: Renderer): void {
    const probe = spine.children[0]?.children.find((child) => child.label === 'marrow-probe');

    if (!(probe instanceof RenderContainer)) throw new Error('the view has no child that watches its draws');
    probe.render(renderer);
}
