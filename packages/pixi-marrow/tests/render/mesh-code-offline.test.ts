import { describe, expect, it, vi } from 'vitest';
import { inspectView } from '../../src/render/inspect';
import { loadMeshCode, meshCode, meshCodeState } from '../../src/render/mesh-code';
import { createBare, expectBatch, loadFamily, populate } from './batch-check';
import { bodyOf, createStage } from './batch-stage';
import { play, step } from './rig';

/*
 * The code of the mesh mode is a chunk of its own, and a chunk can fail to load. A view that
 * asked for the mesh mode then stays in a batch. In this file the chunk never loads.
 */

vi.mock('../../src/render/mesh-paint', () => {
    throw new Error('the chunk did not load');
});

describe('a view whose code for the mesh mode does not load', () => {
    it('stays in a batch, says so, and asks again with a command and not with every update', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rig = await createBare(family, { renderMode: 'mesh' });

        expect(meshCodeState()).toBe('loading');
        stage.root.addChild(rig.view.container);
        play(rig, 'run');
        // a load that fails never rejects
        await expect(loadMeshCode()).resolves.toBeUndefined();
        expect(meshCodeState()).toBe('failed');
        expect(meshCode()).toBeUndefined();
        for (let frame = 0; frame < 5; frame++) {
            step(rig, 0.05);
            stage.render();
            expect(meshCodeState()).toBe('failed');
        }
        expect(rig.view.stats).toMatchObject({ renderMode: 'batched', drawCalls: 1 });
        expect(inspectView(rig.view).mode).toMatchObject({
            option: 'mesh',
            mode: 'batched',
            wanted: 'mesh',
            reason: 'option',
            meshCode: 'failed',
            drawn: true,
        });
        expect(stage.counts.builds).toBe(1);
        expectBatch(rig);
        // the property is a command: it asks for the code again
        rig.view.renderMode = 'mesh';
        expect(meshCodeState()).toBe('loading');
        await loadMeshCode();
        expect(meshCodeState()).toBe('failed');
        step(rig, 0.05);
        expect(rig.view.stats.renderMode).toBe('batched');
        // and so does a new view that is made for the mesh mode
        const other = await createBare(family, { renderMode: 'mesh' });

        expect(meshCodeState()).toBe('loading');
        await loadMeshCode();
        expect(other.view.stats.renderMode).toBe('batched');
    });

    it('draws nothing where no renderer can batch it, and breaks no batch of the skeletons next to it', async () => {
        const stage = createStage({ maxTextures: 2 });
        const small = await loadFamily('4.2/speedy-ess.skel');
        const family = await loadFamily('4.2/dragon-ess.skel');
        const before = await populate(stage, small, 1);
        const [rig] = await populate(stage, family, 1);
        const after = await populate(stage, small, 1);

        if (rig === undefined) throw new Error('no rig');
        expect(family.textures.length).toBeGreaterThan(2);
        // the view learns of the renderer when Pixi is about to draw it, and hides before it is collected
        stage.render();
        await loadMeshCode();
        expect(meshCodeState()).toBe('failed');
        for (let frame = 0; frame < 3; frame++) {
            for (const item of [...before, rig, ...after]) step(item, 0.05);
            stage.render();
        }
        expect(rig.view.stats).toMatchObject({ renderMode: 'batched', drawCalls: 0 });
        expect(bodyOf(rig.view)?.visible).toBe(false);
        expect(inspectView(rig.view).mode).toMatchObject({
            option: 'batched',
            mode: 'batched',
            wanted: 'mesh',
            reason: 'limit',
            meshCode: 'failed',
            drawn: false,
        });
        // the two small skeletons around it share one batch
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['batch']);
        for (const item of [...before, ...after]) expectBatch(item);
    });
});
