import { describe, expect, it } from 'vitest';
import { inspectView } from '../../src/render/inspect';
import { loadMeshCode, meshCode, meshCodeState } from '../../src/render/mesh-code';
import { createBare, expectBatch, loadFamily, populate } from './batch-check';
import { bodyOf, createStage } from './batch-stage';
import { expectKernel, meshes, play, step } from './rig';

/*
 * The code of the mesh mode loads on demand. This file never loads it before a view asks for
 * it, and its tests run in order: the code stays once it is there.
 */

describe('a view before the code of the mesh mode is loaded', () => {
    it('does not ask for the code while it draws in a batch', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const [rig] = await populate(stage, family, 1, { renderMode: 'auto' });

        if (rig === undefined) throw new Error('no rig');
        play(rig, 'run');
        for (let frame = 0; frame < 5; frame++) {
            step(rig, 0.05);
            stage.render();
        }
        expect(meshCodeState()).toBe('idle');
        expect(meshCode()).toBeUndefined();
        expect(inspectView(rig.view).mode).toMatchObject({ mode: 'batched', wanted: 'batched', meshCode: 'idle' });
    });

    it('asks for the code when it is made for the mesh mode, draws in a batch until then, and changes over in the middle of play', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const others = await populate(stage, family, 2);
        const rig = await createBare(family, { renderMode: 'mesh' });
        const resting = await createBare(family, { renderMode: 'mesh' });

        // the constructor asked, and nothing was awaited since
        expect(meshCodeState()).toBe('loading');
        // a view whose pose rests finds nothing to do while the code loads
        resting.engine.update(0);
        resting.view.update(resting.engine.state);
        resting.view.update(resting.engine.state);
        expect(resting.view.stats).toMatchObject({ renderMode: 'batched', skips: 1 });
        expect(rig.view.stats.renderMode).toBe('batched');
        stage.root.addChild(rig.view.container);
        for (const item of [...others, rig]) play(item, 'run');
        for (const item of [...others, rig]) step(item, 0.05);
        stage.render();
        expect(inspectView(rig.view).mode).toMatchObject({
            option: 'mesh',
            mode: 'batched',
            wanted: 'mesh',
            reason: 'option',
            meshCode: 'loading',
            drawn: true,
        });
        // it shares the batch of the others meanwhile, with the picture of its pose
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['batch']);
        expectBatch(rig);
        expect(rig.view.parts.paints.mesh).toBeUndefined();
        await loadMeshCode();
        expect(meshCodeState()).toBe('loaded');
        // the code that arrived is work for the resting view: it changes over although its pose is the same
        resting.view.update(resting.engine.state);
        expect(resting.view.stats).toMatchObject({ renderMode: 'mesh', skips: 1 });
        expectKernel(resting);
        resting.view.update(resting.engine.state);
        expect(resting.view.stats).toMatchObject({ renderMode: 'mesh', skips: 2 });
        // the code is there: the view changes over with its next update, not before
        stage.render();
        expect(rig.view.stats.renderMode).toBe('batched');
        const { builds } = stage.counts;

        for (const item of [...others, rig]) step(item, 0.05);
        expect(rig.view.stats.renderMode).toBe('mesh');
        stage.render();
        expect(inspectView(rig.view).mode).toMatchObject({ mode: 'mesh', wanted: 'mesh', meshCode: 'loaded' });
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['batch', 'mesh']);
        expectKernel(rig);
        expect(bodyOf(rig.view)?.visible).toBe(false);
        // one build for the change of mode, and none after it
        expect(stage.counts.builds).toBe(builds + 1);
        for (let frame = 0; frame < 10; frame++) {
            for (const item of [...others, rig]) step(item, 0.05);
            stage.render();
        }
        expect(stage.counts.builds).toBe(builds + 1);
        expectKernel(rig);
        for (const item of others) expectBatch(item);
    });

    it('changes over with the property once the code is there, with one build', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const [rig] = await populate(stage, family, 1);

        if (rig === undefined) throw new Error('no rig');
        play(rig, 'run');
        step(rig, 0.05);
        stage.render();
        rig.view.renderMode = 'mesh';
        expect(rig.view.stats.renderMode).toBe('batched');
        step(rig, 0.05);
        stage.render();
        expect(rig.view.stats.renderMode).toBe('mesh');
        expect(stage.counts.builds).toBe(2);
        expect(meshes(rig.view)).toHaveLength(1);
        expectKernel(rig);
    });
});

describe('a view that no renderer can batch', () => {
    it('draws with meshes at once when their code is loaded', async () => {
        const stage = createStage({ maxTextures: 2 });
        const family = await loadFamily('4.2/dragon-ess.skel');
        const [rig] = await populate(stage, family, 1);

        stage.render();
        expect(rig?.view.stats.renderMode).toBe('mesh');
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['mesh']);
    });
});
