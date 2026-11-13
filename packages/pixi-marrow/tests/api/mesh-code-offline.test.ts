import { afterEach, describe, expect, it, vi } from 'vitest';
import { importAtlas, importSkeleton } from '../../src/core';
import { MarrowAsset, MarrowSpine } from '../../src/index';
import { loadMeshCode, meshCodeState } from '../../src/render/mesh-code';
import { blankTexture, FRAME, fixtureFiles } from './helpers';

/** The row of the report about the render mode. The row of the perf settings comes before it. */
const isModeRow = (entry: { feature: string }): boolean => entry.feature === 'renderMode';

/*
 * The code of the mesh mode is a chunk of its own, and a chunk can fail to load. An asset still
 * loads then, and its display objects draw in a batch. In this file the chunk never loads.
 */

vi.mock('../../src/render/mesh-paint', () => {
    throw new Error('the chunk did not load');
});

const SPEEDY = fixtureFiles('4.2/speedy-ess.skel');

describe('an asset whose code for the mesh mode does not load', () => {
    const made: MarrowSpine[] = [];

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.unstubAllGlobals();
    });

    it('loads all the same when it was asked for the mesh mode, and its display objects stay in a batch and say so', async () => {
        const model = await importSkeleton(SPEEDY.skeleton);
        const atlas = importAtlas(SPEEDY.atlas);
        const textures = atlas.pages.map(() => blankTexture());

        expect(meshCodeState()).toBe('idle');
        const asset = await MarrowAsset.from({ model, atlas, textures, renderMode: 'mesh' });

        // the load waited for the chunk, which then did not come
        expect(meshCodeState()).toBe('failed');
        const spine = new MarrowSpine(asset, { autoUpdate: false, renderMode: 'mesh' });

        made.push(spine);
        spine.play('run', { loop: true });
        for (let frame = 0; frame < 5; frame++) spine.update(FRAME);
        expect(spine.stats).toMatchObject({ renderMode: 'batched', drawCalls: 1 });
        expect((await spine.perf.report()).find(isModeRow)).toEqual({
            feature: 'renderMode',
            value: 'batched',
            reason: 'the option renderMode is "mesh". The code of the mesh mode did not load, so the skeleton stays in a batch',
        });
    });

    it('refuses a render mode that is none, before anything loads', async () => {
        const model = await importSkeleton(SPEEDY.skeleton);
        const atlas = importAtlas(SPEEDY.atlas);
        const textures = atlas.pages.map(() => blankTexture());

        await expect(MarrowAsset.from({ model, atlas, textures, renderMode: 'meshes' as never })).rejects.toMatchObject(
            {
                code: 'invalid-data',
                validNames: ['auto', 'mesh', 'batched'],
            },
        );
    });

    it('asks for the code again when a load of the same files names the mesh mode, and shares the asset', async () => {
        const files = new Map<string, string | Uint8Array>([
            ['speedy.skel', SPEEDY.skeleton],
            ['speedy.atlas', SPEEDY.atlas],
        ]);

        vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
            const body = files.get(url);

            return body === undefined
                ? new Response('', { status: 404 })
                : new Response(typeof body === 'string' ? body : body.slice());
        });
        const textures = Object.fromEntries(importAtlas(SPEEDY.atlas).pages.map((page) => [page.name, blankTexture()]));
        const options = { skeleton: 'speedy.skel', atlas: 'speedy.atlas', textures, outlines: 'off' as const };
        const first = await MarrowAsset.load(options);
        const spine = await MarrowSpine.load({ ...options, renderMode: 'mesh', autoUpdate: false });

        made.push(spine);
        expect(spine.asset).toBe(first);
        // the load asked and waited, and the display object, which is made for the mesh mode, asked once more
        expect(meshCodeState()).toBe('loading');
        await loadMeshCode();
        expect(meshCodeState()).toBe('failed');
        spine.update(FRAME);
        expect(spine.stats.renderMode).toBe('batched');
        first.destroy();
    });
});
