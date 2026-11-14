import { BufferImageSource, Texture } from 'pixi.js';
import { buildAtlasOutlines, type PagePixels } from '../../src/geometry/outlines';
import { type AtlasOutlines, MarrowAsset } from '../../src/index';
import type { AtlasModel } from '../../src/model/atlas';
import { listAtlasFixtures, loadAtlasFixture } from '../geometry/outline-checks';
import { importRig } from './helpers';

/** The atlas of a fixture with its pages as textures made from the decoded pixels, which Node can read back. */
export async function pixelPages(id: string): Promise<{ atlas: AtlasModel; pages: PagePixels[]; textures: Texture[] }> {
    const fixture = listAtlasFixtures().find((candidate) => candidate.id === id);

    if (fixture === undefined) throw new Error(`no fixture ${id}. Run: pnpm fixtures`);
    const { atlas, pages } = await loadAtlasFixture(fixture);
    // a copy per texture: the decoded pages are shared by the tests of a file
    const textures = pages.map(
        ({ data, width, height }) =>
            new Texture({
                source: new BufferImageSource({ resource: new Uint8Array(data), width, height, format: 'rgba8unorm' }),
            }),
    );

    return { atlas, pages, textures };
}

/** An asset of spineboy with pages that can be read, and the outlines a scan of those pages gives. */
export async function boyAsset(options: { outlines?: 'auto' | 'off' | AtlasOutlines } = {}): Promise<{
    asset: MarrowAsset;
    built: AtlasOutlines;
    textures: Texture[];
}> {
    const { model } = await importRig('4.2/spineboy-pro.skel');
    const { atlas, pages, textures } = await pixelPages('4.2/spineboy.atlas');
    // a scan of the page images, which is what the tests of outlines look at, unless they say otherwise
    const asset = await MarrowAsset.from({ model, atlas, textures, outlines: 'auto', ...options });

    return { asset, built: buildAtlasOutlines(atlas, pages), textures };
}
