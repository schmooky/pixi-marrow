import { afterEach, describe, expect, it, vi } from 'vitest';
import { importAtlas, importSkeleton } from '../../src/core';
import { MarrowAsset, MarrowSpine } from '../../src/index';
import { loadMeshCode, meshCodeState } from '../../src/render/mesh-code';
import { AUTO_BATCH_VERTICES } from '../../src/render/mode';
import { coverFiles } from '../render/cover-rig';
import { pageTextures } from '../render/cuts';
import { coverAsset } from './cover-asset';
import { FRAME, fixtureAsset } from './helpers';

/** The row of the report about the render mode. The row of the perf settings comes before it. */
const isModeRow = (entry: { feature: string }): boolean => entry.feature === 'renderMode';

/*
 * The code of the mesh mode loads on demand. Here its chunk waits until a test lets it in, so
 * that the time before it arrives can be looked at. The tests run in order.
 */

const chunk = vi.hoisted(() => {
    let arrive: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
        arrive = resolve;
    });

    return { arrived, arrive: (): void => arrive() };
});

vi.mock('../../src/render/mesh-paint', async (original) => {
    await chunk.arrived;

    return original();
});

const SHARES = 'It shares draw calls with the skeletons next to it, and the CPU places its vertices';
const OWNS = 'It has draw calls of its own, and the GPU places its vertices';

/** Enough quads for `auto` to pick the mesh mode. */
const MANY = Array.from({ length: AUTO_BATCH_VERTICES / 4 + 1 }, (_, i) => ({
    name: `quad-${i}`,
    shows: 'small' as const,
    at: [i * 24, 0] as [number, number],
}));

/** True once a promise has settled, without waiting for it longer than a few turns of the event loop. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
    let done = false;

    promise.then(
        () => {
            done = true;
        },
        () => {
            done = true;
        },
    );
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setTimeout(resolve, 0));

    return done;
}

describe('the code of the mesh mode', () => {
    const made: MarrowSpine[] = [];

    function create(asset: MarrowAsset, options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine {
        const spine = new MarrowSpine(asset, { ...options, autoUpdate: false });

        made.push(spine);

        return spine;
    }

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it('is not asked for by an asset whose skeleton auto batches, or by its display objects', async () => {
        const asset = await fixtureAsset('4.2/speedy-ess.skel');
        const spine = create(asset);

        spine.update(FRAME);
        expect(spine.stats.renderMode).toBe('batched');
        expect((await spine.perf.report()).find(isModeRow)?.reason).toBe(
            `the option renderMode is "auto": the skeleton has 44 vertices in a batch, which is at most 1024. ${SHARES}`,
        );
        expect(meshCodeState()).toBe('idle');
    });

    it('is waited for by the load of an asset that auto draws with meshes, while a display object that asks for it draws in a batch', async () => {
        const files = coverFiles(MANY);
        const model = await importSkeleton(files.skeleton);
        const atlas = importAtlas(files.atlas);
        const loading = MarrowAsset.from({ model, atlas, textures: pageTextures(atlas), outlines: 'off' });
        const small = await fixtureAsset('4.2/speedy-ess.skel');
        const spine = create(small, { renderMode: 'mesh' });

        expect(await settled(loading)).toBe(false);
        expect(meshCodeState()).toBe('loading');
        const run = spine.play('run', { loop: true });

        spine.update(FRAME);
        expect(spine.stats).toMatchObject({ renderMode: 'batched', drawCalls: 1 });
        expect((await spine.perf.report()).find(isModeRow)).toEqual({
            feature: 'renderMode',
            value: 'batched',
            reason: 'the option renderMode is "mesh". The code of the mesh mode is loading, and until it is there the skeleton draws in a batch',
        });
        chunk.arrive();
        const asset = await loading;

        expect(meshCodeState()).toBe('loaded');
        // the instance that waited changes over with its next update, in the middle of its animation
        expect(spine.stats.renderMode).toBe('batched');
        expect((await spine.perf.report()).find(isModeRow)?.reason).toBe(
            'the option renderMode is "mesh". The code of the mesh mode has loaded, and the skeleton changes over with its next update. Until then it draws in a batch',
        );
        const { time } = run;

        spine.update(FRAME);
        expect(spine.stats).toMatchObject({ renderMode: 'mesh', drawCalls: 1 });
        expect(run.time).toBeCloseTo(time + FRAME, 10);
        expect((await spine.perf.report()).find(isModeRow)).toEqual({
            feature: 'renderMode',
            value: 'mesh',
            reason: `the option renderMode is "mesh". ${OWNS}`,
        });
        // an instance of the asset that waited for the code draws with meshes from its first frame
        const large = create(asset);

        expect(large.stats.renderMode).toBe('mesh');
        expect((await large.perf.report()).find(isModeRow)?.reason).toBe(
            `the option renderMode is "auto": the skeleton has ${MANY.length * 4} vertices in a batch, which is more than 1024. ${OWNS}`,
        );
    });

    it('is there for every display object once it has loaded, with the option and with the property', async () => {
        const asset = await coverAsset([{ name: 'a', shows: 'small' }]);
        const mesh = create(asset, { renderMode: 'mesh' });
        const later = create(asset);

        expect(mesh.stats.renderMode).toBe('mesh');
        expect(later.stats.renderMode).toBe('batched');
        later.renderMode = 'mesh';
        later.update(FRAME);
        expect(later.stats.renderMode).toBe('mesh');
        await expect(loadMeshCode()).resolves.toBeUndefined();
    });
});
